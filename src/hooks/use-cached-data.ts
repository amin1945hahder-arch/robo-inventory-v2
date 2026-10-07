import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  applyDelta,
  cacheRows,
  emptyTableCache,
  needsFullResync,
  type SyncedRow,
  type TableCache,
} from "@/lib/sync/delta";
import { loadTable, saveTable } from "@/lib/sync/store";
import { SYNC_TABLES, TOMBSTONE_RETENTION_MS } from "@/lib/sync/tables";
import { bumpDataSyncListen } from "@/lib/sync/bus";
import { writeSyncListen } from "@/lib/sync/write-sync";
import { isOffline } from "@/lib/offline";

// Dev-only instrumentation: one line per sync cycle so the read pattern is
// observable without dragging a profiler into production bundles.
const DEV = import.meta.env?.DEV === true;

// Failed-pull recovery: how long a burst of failures counts as ONE episode,
// how many re-arm attempts we allow per episode, and the pause between them.
// The reactive head re-fires on ANY write, so this only matters for the
// broken-watch case (auth expiry, mid-pagination failure) — it must retry
// hard for a few seconds, then stand down and wait for the next interrupt.
const RESYNC_WINDOW_MS = 15_000;
const HEAD_RESYNC_MAX_ATTEMPTS = 3;
const HEAD_RESYNC_DELAY_MS = 2_500;

function logSyncCycle(table: string, info: { docs: number; bytes: number; more: boolean }) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.debug(
    `[sync] ${table}: ${info.docs} doc(s), ~${info.bytes}B${info.more ? " (hasMore)" : ""}`,
  );
}

type Status = "loading" | "hydrated" | "ready";

/**
 * Cache-first data hook (delta sync).
 *
 * 1. On mount it renders immediately from the IndexedDB snapshot (no network
 *    wait), then pulls pages of changed rows via sync.getUpdatedRecords — a
 *    strict by_updatedAt index scan that returns only changed rows, only the
 *    projected fields.
 * 2. It keeps ONE reactive subscription to sync.syncHead per table (a single
 *    indexed read). Any write anywhere stamps the touched rows' updatedAt,
 *    the head flips, and the push channel acts as the INTERRUPT: the hook
 *    wakes, fetches the small delta, merges, and persists — no polling.
 * 3. Rows are also visible changes: syncTombstones (hard deletes) ride the
 *    same head and are applied before rows, so a deleted row can't linger.
 *
 * Consumers just read `data` (plain rows array) and `status`.
 */
export function useCachedData(table: string) {
  const convex = useConvex();
  const [cache, setCache] = useState<TableCache>(emptyTableCache);
  const [status, setStatus] = useState<Status>("loading");

  // The `since` cursor lives in a ref: it drives fetches without re-rendering.
  const sinceRef = useRef(0);
  const lastDeleteRef = useRef(0);
  const fetchedUpToRef = useRef(0); // latest serverNow we've fully pulled
  const pullingRef = useRef(false);
  const pendingRef = useRef(false);
  const headFailureRef = useRef<{ attempts: number[]; reattach: () => void }>({
    attempts: [],
    reattach: () => undefined,
  });

  // 1) Hydrate from IndexedDB first.
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      const cached = await loadTable(table);
      if (!alive) return;
      setCache(cached);
      sinceRef.current = cached.latestUpdatedAt;
      lastDeleteRef.current = 0;
      setStatus("hydrated");
    })();
    return () => {
      alive = false;
    };
  }, [table]);

  const pullDelta = useCallback(async () => {
    if (pullingRef.current) {
      pendingRef.current = true; // coalesce: one more pass after this one
      return;
    }
    pullingRef.current = true;
    try {
      // Loop until the server says we're caught up (paginated deltas).
      for (;;) {
        // Deletes first: table-scoped (a delete in another table no longer
        // costs this table a round-trip), and we need the surviving-tombstone
        // floor to decide whether our cursor is still trustworthy.
        let dels = await convex.query(api.sync.listTombstonesSince, {
          table,
          since: lastDeleteRef.current,
        });

        // Escape hatch: if our cursor predates the oldest surviving tombstone
        // (or the whole retention window), deletes may have been pruned while
        // we were offline. Drop the local copy and rebuild from scratch rather
        // than silently keeping rows the server deleted.
        if (
          needsFullResync({
            since: sinceRef.current,
            oldestTombstoneAt: dels.oldestTombstoneAt,
            now: Date.now(),
            retentionMs: TOMBSTONE_RETENTION_MS,
          })
        ) {
          if (DEV) {
            // eslint-disable-next-line no-console
            console.warn(`[sync] full resync (${table}) — cursor predates tombstone retention`);
          }
          sinceRef.current = 0;
          lastDeleteRef.current = 0;
          const cleared = emptyTableCache();
          setCache(cleared);
          await saveTable(table, cleared);
          dels = await convex.query(api.sync.listTombstonesSince, { table, since: 0 });
        }

        const res = await convex.query(api.sync.getUpdatedRecords, {
          table,
          since: sinceRef.current,
        });
        const deletedIds = dels.tombstones
          .filter((t) => t.deletedAt > lastDeleteRef.current)
          .map((t) => t.recordId);
        if (dels.tombstones.length > 0) {
          lastDeleteRef.current = Math.max(
            lastDeleteRef.current,
            ...dels.tombstones.map((t) => t.deletedAt),
          );
        }
        logSyncCycle(table, {
          docs: res.rows.length,
          bytes: DEV ? JSON.stringify(res.rows).length : 0,
          more: res.hasMore,
        });
        setCache((prev) => {
          const next = applyDelta(prev, res.rows as SyncedRow[], deletedIds);
          // The delta cursor comes from the SERVER stamps, not the merged
          // map. If a page contains no rows the merged cache has nothing
          // newer to offer — deriving the cursor from it would wedge the
          // table at 0 until the first row write. serverNow must NOT be
          // used either: server clocks can sit slightly ahead and skipping
          // rows stamped in that gap would drop real changes forever.
          const pageMax = (res.rows as SyncedRow[]).reduce(
            (m, r) => Math.max(m, typeof r.updatedAt === "number" ? r.updatedAt : 0),
            0,
          );
          sinceRef.current = Math.max(sinceRef.current, next.latestUpdatedAt, pageMax);
          void saveTable(table, next);
          return next;
        });
        if (!res.hasMore) {
          fetchedUpToRef.current = res.serverNow;
          break;
        }
      }
    } catch (err) {
      // A FAILED pull used to be swallowed as "offline/transient" — but a
      // page that fails mid-pagination leaves sinceRef advanced past rows
      // the client never merged, so retrying from the same cursor could
      // never recover them. And an expired/invalidated auth token errors
      // EVERY query: after sign-in the head watch stays broken until the
      // next write. Detect query failures (server error vs. genuine
      // offline) and force the head watch to re-subscribe — one retry
      // window, capped so a permanently failing table can't loop.
      if (isOffline()) return;
      const now = Date.now();
      const failures = headFailureRef.current;
      const last =
        failures.attempts.length > 0
          ? failures.attempts[failures.attempts.length - 1]
          : undefined;
      if (last === undefined || now - last > RESYNC_WINDOW_MS) {
        failures.attempts = [now];
      } else {
        failures.attempts.push(now);
      }
      if (failures.attempts.length > HEAD_RESYNC_MAX_ATTEMPTS) return;
      if (DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[sync] ${table}: pull failed (${String(err)}) — re-arming the head watch`);
      }
      setTimeout(() => {
        if (headFailureRef.current.reattach) headFailureRef.current.reattach();
      }, HEAD_RESYNC_DELAY_MS);
    } finally {
      pullingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void pullDelta();
      }
    }
    // convex.query is stable; table is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convex, table]);

  // 2) The interrupt: one tiny reactive read that flips on every write.
  //    `rearmKey` re-subscribes the watch after a failed pull (see above).
  const [rearmKey, setRearmKey] = useState(0);
  const head = useConvexHead(table, rearmKey);
  useEffect(() => {
    if (status !== "hydrated" && status !== "ready") return;
    if (head === undefined) return; // first query round-trip
    void pullDelta();
  }, [head, status, pullDelta]);
  // Failed-pull recovery wiring: pullDelta registers its reattach callback
  // here (setRearmKey bumps the watch's key so it re-subscribes).
  headFailureRef.current.reattach = () => setRearmKey((k) => k + 1);

  // Expose the same status contract as a normal useQuery.
  useEffect(() => {
    if (status === "hydrated") setStatus("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache.rows.size]);

  const data = useMemo(() => (status === "loading" ? undefined : cacheRows(cache)), [cache, status]);

  // 3) Manual invalidation (after imports/backfills).
  useEffect(() => {
    return bumpDataSyncListen(() => {
      void pullDelta();
    });
  }, [pullDelta]);

  // 4) WRITE-driven interrupt: this device's own mutations invalidate the
  //    touched tables immediately, so a second device (or another browser
  //    window) sees the change on its next wake even if its head watch
  //    hiccups. Bumped from src/lib/sync/write-sync.ts (patched mutations).
  useEffect(() => {
    return writeSyncListen(table, () => {
      void pullDelta();
    });
  }, [table, pullDelta]);

  return { data, status: data === undefined ? "loading" : status };
}

// One shared reactive head subscription per table (module-level cache so N
// components using the same table share a single subscription). `rearmKey`
// in the key bumps the subscription: after a failed pull the watch is
// re-created, which re-issues the query — the only reliable way to recover
// a watch that died from an auth/session error.
const headListeners = new Map<string, Set<(v: unknown) => void>>();
const headValues = new Map<string, unknown>();

function useConvexHead(table: string, rearmKey = 0) {
  const convex = useConvex();
  const [value, setValue] = useState<unknown>(() => headValues.get(table));

  useEffect(() => {
    let alive = true;
    let set = headListeners.get(table);
    if (!set) {
      set = new Set();
      headListeners.set(table, set);
    }
    const listener = (v: unknown) => {
      if (alive) setValue(v);
    };
    set.add(listener);
    // One shared reactive subscription per table: watchQuery re-runs the
    // single indexed read whenever any row's updatedAt changes.
    const watch = convex.watchQuery(api.sync.syncHead, { table });
    const unsub = watch.onUpdate(() => {
      // The Watch callback fires on every transition; read the fresh value
      // from the watch itself (typed, and correct even for local results).
      const res = watch.localQueryResult();
      headValues.set(table, res);
      const listeners = headListeners.get(table);
      listeners?.forEach((fn) => fn(res));
    });
    return () => {
      alive = false;
      set!.delete(listener);
      unsub();
      if (headListeners.get(table)?.size === 0) {
        headListeners.delete(table);
        headValues.delete(table);
      }
    };
  }, [convex, table, rearmKey]);

  return value;
}

/** Tables wired for delta sync (kept in sync with convex/sync.ts SYNC_TABLES). */
export const DELTA_SYNC_TABLES = SYNC_TABLES;
