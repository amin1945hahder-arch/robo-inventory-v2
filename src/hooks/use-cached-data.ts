import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { applyDelta, cacheRows, emptyTableCache, type SyncedRow, type TableCache } from "@/lib/sync/delta";
import { loadTable, saveTable } from "@/lib/sync/store";
import { SYNC_TABLES } from "@/lib/sync/tables";
import { bumpDataSyncListen } from "@/lib/sync/bus";

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
        const res = await convex.query(api.sync.getUpdatedRecords, {
          table,
          since: sinceRef.current,
        });
        const tombstones = await convex.query(api.sync.listTombstonesSince, {
          since: lastDeleteRef.current,
        });
        const deletedIds = (tombstones as { recordId: string; deletedAt: number }[])
          .filter((t) => t.deletedAt > lastDeleteRef.current)
          .map((t) => t.recordId);
        if (tombstones.length > 0) {
          lastDeleteRef.current = Math.max(
            lastDeleteRef.current,
            ...tombstones.map((t) => t.deletedAt),
          );
        }
        setCache((prev) => {
          const next = applyDelta(prev, res.rows as SyncedRow[], deletedIds);
          sinceRef.current = Math.max(sinceRef.current, next.latestUpdatedAt);
          void saveTable(table, next);
          return next;
        });
        if (!res.hasMore) {
          fetchedUpToRef.current = res.serverNow;
          break;
        }
      }
    } catch {
      /* offline / transient — the reactive head will re-trigger us */
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
  const head = useConvexHead(table);
  useEffect(() => {
    if (status !== "hydrated" && status !== "ready") return;
    if (head === undefined) return; // first query round-trip
    void pullDelta();
  }, [head, status, pullDelta]);

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

  return { data, status: data === undefined ? "loading" : status };
}

// One shared reactive head subscription per table (module-level cache so N
// components using the same table share a single subscription).
const headListeners = new Map<string, Set<(v: unknown) => void>>();
const headValues = new Map<string, unknown>();

function useConvexHead(table: string) {
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
  }, [convex, table]);

  return value;
}

/** Tables wired for delta sync (kept in sync with convex/sync.ts SYNC_TABLES). */
export const DELTA_SYNC_TABLES = SYNC_TABLES;
