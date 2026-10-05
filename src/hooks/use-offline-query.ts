/**
 * useOfflineQuery — a drop-in replacement for Convex's `useQuery` that keeps
 * showing real data when the device is offline.
 *
 * Why this exists: `useQuery` returns `undefined` until the websocket
 * delivers a result. Offline it never delivers, so every page rendered its
 * empty state even though the device had the data cached. This hook layers a
 * read-through cache underneath the live subscription:
 *
 *  1. On mount it reads the last cached result for this (user, query, args)
 *     from IndexedDB and returns it IMMEDIATELY — no network wait, no empty
 *     flash, and the very first paint while offline is already full.
 *  2. The live `useQuery` runs in parallel; whenever it yields a result we
 *     render it and write it back to the cache.
 *  3. Reconnects are an INTERRUPT: coming back online (or the shared
 *     `bumpDataSync` bus firing after a write) re-runs the query. Nothing
 *     polls; the cache is refreshed when something actually changed or the
 *     cached entry aged out.
 *
 * Semantics kept identical to `useQuery` so pages can swap it in unchanged:
 * same call signature, same return type, `undefined` still means "genuinely
 * nothing to show yet" (cold cache + never fetched).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAction as useConvexAction, useQuery as useConvexQuery } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { isOffline, onConnectivityChange } from "@/lib/offline";
import {
  cacheKey,
  decideFreshness,
  shouldSkipPersist,
  DEFAULT_MAX_AGE_MS,
  type CacheEntry,
} from "@/lib/sync/queryCache";
import { loadQueryEntry, saveQueryEntry } from "@/lib/sync/queryStore";
import { bumpDataSyncListen } from "@/lib/sync/bus";
import { getAuthUserSync, subscribeAuthUser } from "@/hooks/use-auth";
import { isTursoFunction } from "@/lib/sync/tursoFunctions";
import { getHeads } from "@/lib/sync/heads";
import { planRead, queryFetchGate } from "@/lib/sync/readPlan";

/** Resolve the "parts/listMyRentals" identifier from a query reference. */
function queryNameOf(query: unknown): string {
  const url = (query as { url?: string } | undefined)?.url;
  if (typeof url !== "string") return "unknown";
  const parts = url.split("/");
  // apiUrl: "https://host/api/v1", then module, then function name.
  return `${parts[parts.length - 2] ?? "?"}/${parts[parts.length - 1] ?? "?"}`;
}

/**
 * Drop-in `useQuery` replacement with an IndexedDB read-through cache.
 *
 * Dispatches on the STATIC registry (`TURSO_FUNCTIONS`): a Turso-backed
 * function is an action now and is fetched through {@link useOfflineTursoQuery};
 * everything else stays on the Convex subscription below. While the registry is
 * empty this is exactly the old Convex-only behavior.
 */
/** A function reference this hook accepts: still a Convex query, or already
 *  a converted Turso action. */
type QueryOrActionRef = FunctionReference<"query"> | FunctionReference<"action">;

export function useOfflineQuery<Query extends QueryOrActionRef>(
  query: Query,
  ...args: [args?: FunctionArgs<Query> | "skip"]
): FunctionReturnType<Query> | undefined {
  // The branch is stable for a given call site (the registry is a build-time
  // constant and pages pass literal refs), so hook order never changes.
  if (isTursoFunction(queryNameOf(query))) {
    return useOfflineTursoQuery(
      query as FunctionReference<"action">,
      args[0] as never,
    ) as FunctionReturnType<Query>;
  }
  return useOfflineConvexQuery(
    query as FunctionReference<"query">,
    ...args,
  ) as FunctionReturnType<Query>;
}

function useOfflineConvexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: [args?: FunctionArgs<Query> | "skip"]
): FunctionReturnType<Query> | undefined {
  // Scope the cache key to the signed-in member. This is read from the shared
  // identity store rather than `useAuth()` on purpose: pages open ~100 of these
  // hooks, and each one subscribing to auth would mean ~100 duplicate
  // `currentUser` subscriptions. `subscribeAuthUser` re-scopes the key on
  // sign-in / sign-out without a re-query.
  const [userId, setUserId] = useState<string | null>(() => getAuthUserSync()?._id ?? null);
  useEffect(
    () => subscribeAuthUser((user) => setUserId(user?._id ?? null)),
    [],
  );

  const passedArgs = args[0];
  const skip = passedArgs === "skip";

  // `bypass` momentarily flips the subscription to "skip" to force a
  // re-subscribe (and therefore a fresh server read) on interrupt.
  const [bypass, setBypass] = useState(false);

  // The live subscription.
  const live = useConvexQuery(
    query as never,
    (skip || bypass ? "skip" : passedArgs ?? {}) as never,
  );

  const [cached, setCached] = useState<{ value: unknown; storedAt: number } | undefined>(undefined);
  const [online, setOnline] = useState(() => !isOffline());
  const keyRef = useRef<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);

  // Cache key for this exact invocation. "skip" collapses to the same key as
  // no args so switching a page on doesn't fork the cache.
  const key = skip ? null : cacheKey(queryNameOf(query), passedArgs ?? {}, userId);

  // 1) Hydrate from IndexedDB on mount / whenever the key changes.
  useEffect(() => {
    if (!key) return;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    let alive = true;
    (async () => {
      const entry = await loadQueryEntry(key);
      if (!alive) return;
      keyRef.current = key;
      // Always assign: a key change (new args, new member) with no stored entry
      // must CLEAR the previous snapshot rather than keep showing it.
      setCached(entry ? (entry as { value: unknown; storedAt: number }) : undefined);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  // 2) Write every fresh live result back to the cache.
  useEffect(() => {
    if (!key || live === undefined) return;
    if (shouldSkipPersist(key)) return;
    const storedAt = Date.now();
    setCached({ value: live, storedAt });
    void saveQueryEntry(key, live, storedAt);
  }, [key, live]);

  // 3) Connectivity flips: re-evaluate freshness so a reconnect can refetch.
  useEffect(() => {
    const sync = () => setOnline(!isOffline());
    sync();
    return onConnectivityChange(sync);
  }, []);

  // 4) The interrupt path: a write anywhere (bus) or a reconnect triggers a
  //    revalidation when the cached entry has aged out. Nothing polls.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsub = bumpDataSyncListen(bump);
    const unsubNet = onConnectivityChange(bump);
    return () => {
      unsub();
      unsubNet();
    };
  }, []);

  // Decide what to render: live always wins; otherwise the cached snapshot.
  const decision = decideFreshness(cached as CacheEntry | undefined, {
    now: Date.now(),
    online,
    maxAgeMs: DEFAULT_MAX_AGE_MS,
  });

  // Revalidation on interrupt. Convex re-runs a query when it (re)subscribes,
  // so the reliable way to ask for a fresh result is to flip the subscription
  // off for one tick ("skip") and back on. That genuinely re-issues the query —
  // bumping unrelated state would not.
  const bypassRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (bypassRef.current) clearTimeout(bypassRef.current);
    setBypass(true);
    bypassRef.current = setTimeout(() => {
      bypassRef.current = null;
      setBypass(false);
    }, 0);
  }, []);

  // Clear any pending timer on unmount so we never set state after unmount.
  useEffect(
    () => () => {
      if (bypassRef.current) clearTimeout(bypassRef.current);
    },
    [],
  );

  useEffect(() => {
    if (tick === 0) return;
    if (isOffline()) return; // nothing to do without a connection
    const d = decideFreshness(cached as CacheEntry | undefined, {
      now: Date.now(),
      online: true,
      maxAgeMs: DEFAULT_MAX_AGE_MS,
    });
    if (d.needsRevalidate || decision.freshness === "miss") refresh();
  }, [tick, cached, decision.freshness, refresh]);

  if (live !== undefined) return live as FunctionReturnType<Query>;
  if (decision.freshness === "fresh" || decision.freshness === "stale") {
    return cached!.value as FunctionReturnType<Query>;
  }
  return undefined;
}

/**
 * The Turso-backed branch.
 *
 * Actions are NOT reactive, so instead of a subscription this does a one-shot
 * call: hydrate from the same IndexedDB cache, fetch, and write back. It
 * re-fetches only when the cache key changes or an interrupt fires — a write
 * elsewhere (`bumpDataSync`) or a reconnect. `useTursoHeads` only bumps when a
 * Turso head actually moved, so an idle client costs zero Turso reads.
 */
function useOfflineTursoQuery<Query extends FunctionReference<"action">>(
  action: Query,
  passedArgs: FunctionArgs<Query> | "skip" | undefined,
): FunctionReturnType<Query> | undefined {
  const run = useConvexAction(action);
  const skip = passedArgs === "skip";

  const [userId, setUserId] = useState<string | null>(() => getAuthUserSync()?._id ?? null);
  useEffect(() => subscribeAuthUser((user) => setUserId(user?._id ?? null)), []);

  const key = skip ? null : cacheKey(queryNameOf(action), passedArgs ?? {}, userId);

  // Callers pass a fresh args object each render; keep it in a ref so the fetch
  // effect depends on the stable cache key rather than the object identity.
  const argsRef = useRef<unknown>(passedArgs);
  argsRef.current = passedArgs;

  const [result, setResult] = useState<CacheEntry | undefined>(undefined);
  // Read the current entry inside effects without making it a dependency.
  const resultRef = useRef<CacheEntry | undefined>(result);
  resultRef.current = result;

  // 1) Hydrate from IndexedDB on mount / key change.
  useEffect(() => {
    if (!key) return;
    let alive = true;
    (async () => {
      const entry = await loadQueryEntry(key);
      if (!alive) return;
      setResult(entry ?? undefined);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  // 2) Interrupts: the write bus and reconnects.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsub = bumpDataSyncListen(bump);
    const unsubNet = onConnectivityChange(bump);
    return () => {
      unsub();
      unsubNet();
    };
  }, []);

  // 3) Fetch — but ONLY when the change heads say something actually moved
  //    (or there is no usable entry yet). This is the read-reduction rule: no
  //    head movement → no read at all. Concurrent mounts of the same key share
  //    one request through the fetch gate.
  useEffect(() => {
    if (skip || !key) return;
    const entry = resultRef.current;
    const decision = planRead({
      entry,
      headsAtFetch: entry?.heads,
      headsNow: getHeads(),
      now: Date.now(),
      online: !isOffline(),
    });
    if (!decision.fetch) return;
    let alive = true;
    (async () => {
      try {
        const res = await queryFetchGate.run(key, () => run((argsRef.current ?? {}) as never));
        if (!alive) return;
        const storedAt = Date.now();
        const heads = getHeads();
        setResult({ value: res, storedAt, heads });
        if (!shouldSkipPersist(key)) await saveQueryEntry(key, res, storedAt, heads);
      } catch {
        /* transient (offline / action error) — keep the cached value */
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, skip, run, tick]);

  return result ? (result.value as FunctionReturnType<Query>) : undefined;
}