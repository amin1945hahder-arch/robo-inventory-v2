/**
 * Pure delta-sync logic (no React, no IndexedDB) — unit-testable.
 *
 * The client cache is a map of table -> rows keyed by _id. `applyDelta`
 * merges one `getUpdatedRecords` page into that map: changed rows are
 * upserted, tombstoned ids are dropped. `latestUpdatedAt` is the max stamp
 * ever seen and only ever moves FORWARD (a page arriving out of order must
 * never rewind the cursor, or the same rows would be re-downloaded forever).
 */

export type SyncedRow = { _id: string; updatedAt?: number } & Record<string, unknown>;

export type TableCache = {
  rows: Map<string, SyncedRow>;
  /** Max updatedAt merged so far — the `since` cursor for the next delta. */
  latestUpdatedAt: number;
};

export const emptyTableCache = (): TableCache => ({ rows: new Map(), latestUpdatedAt: 0 });

/**
 * Merge one delta page (and the delete list) into a table cache, returning a
 * NEW cache (immutability keeps React state updates predictable). O(n) over
 * the page; existing rows not in the page are kept by reference.
 */
export function applyDelta(
  cache: TableCache,
  deltaRows: SyncedRow[],
  deletedIds: string[],
): TableCache {
  const rows = new Map(cache.rows);
  let latest = cache.latestUpdatedAt;

  for (const id of deletedIds) rows.delete(id);

  for (const row of deltaRows) {
    if (!row?._id) continue;
    const prev = rows.get(row._id);
    // Keep the newer of the two stamps — a stale page never rewinds it.
    const stamp = typeof row.updatedAt === "number" ? row.updatedAt : (prev?.updatedAt ?? 0);
    if (prev && stamp && prev.updatedAt && prev.updatedAt > stamp) continue; // stale row
    rows.set(row._id, { ...prev, ...row, updatedAt: stamp });
    if (stamp > latest) latest = stamp;
  }

  return { rows, latestUpdatedAt: latest };
}

/**
 * Should the client discard its cache and re-pull from scratch?
 *
 * Two independent triggers:
 *  - the cursor predates the oldest surviving tombstone, so deletes between
 *    the cursor and that floor may already have been pruned; or
 *  - the cursor is older than the retention window itself (long offline).
 * A cursor of 0 means nothing is cached — a normal pull is already a full
 * resync, so no special handling is needed.
 */
export function needsFullResync(opts: {
  since: number;
  oldestTombstoneAt: number | null;
  now: number;
  retentionMs: number;
}): boolean {
  const { since, oldestTombstoneAt, now, retentionMs } = opts;
  if (!(since > 0)) return false;
  if (oldestTombstoneAt != null && since < oldestTombstoneAt) return true;
  return since < now - retentionMs;
}

/** Hydrate from whatever IndexedDB returned (defensive against bad shapes). */
export function reviveCache(raw: unknown): TableCache {
  if (!raw || typeof raw !== "object") return emptyTableCache();
  const { rows, latestUpdatedAt } = raw as { rows?: [string, SyncedRow][]; latestUpdatedAt?: number };
  if (!Array.isArray(rows)) return emptyTableCache();
  return {
    rows: new Map(
      rows.filter(([id, r]) => typeof id === "string" && r && typeof r === "object" && r._id === id),
    ),
    latestUpdatedAt: typeof latestUpdatedAt === "number" ? latestUpdatedAt : 0,
  };
}

/** Serialize for IndexedDB (Maps are structured-cloneable, but be explicit). */
export function persistCache(cache: TableCache): { rows: [string, SyncedRow][]; latestUpdatedAt: number } {
  return { rows: [...cache.rows.entries()], latestUpdatedAt: cache.latestUpdatedAt };
}

/** Plain-row array view for consumers (sorted by _id for stable renders). */
export function cacheRows(cache: TableCache, opts?: { includeDeleted?: boolean }): SyncedRow[] {
  const out = [...cache.rows.values()];
  if (!opts?.includeDeleted) {
    // Soft-deleted rows (deleted: true) are kept in the cache (the tombstone
    // table only records HARD deletes) — consumers filter them per view.
  }
  return out.sort((a, b) => String(a._id).localeCompare(String(b._id)));
}
