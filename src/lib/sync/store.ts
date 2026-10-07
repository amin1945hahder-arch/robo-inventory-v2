/**
 * IndexedDB persistence for the delta-sync cache (idb-keyval).
 *
 * One key per table, so loading the parts cache never deserializes the
 * rentals cache and vice versa. All operations are best-effort: private-mode
 * browsers or full quotas degrade to "no local cache" (the hook falls back
 * to a normal pull) without ever breaking the UI.
 */
import { get, set, del, createStore } from "idb-keyval";
import { emptyTableCache, persistCache, reviveCache, type TableCache } from "./delta";

const store = typeof indexedDB !== "undefined" ? createStore("rc-sync", "cache") : undefined;

const key = (table: string) => `table:${table}`;

/** Load one table's cache (defensive: corrupt/missing → empty). */
export async function loadTable(table: string): Promise<TableCache> {
  try {
    const raw = store ? await get(key(table), store) : undefined;
    return reviveCache(raw);
  } catch {
    return emptyTableCache();
  }
}

/** Persist one table's cache (fire-and-forget; failures are non-fatal). */
export async function saveTable(table: string, cache: TableCache): Promise<void> {
  try {
    if (!store) return;
    await set(key(table), persistCache(cache), store);
  } catch {
    /* quota / private mode — cache simply won't survive the session */
  }
}

/** Drop one table (cache invalidation). */
export async function clearTable(table: string): Promise<void> {
  try {
    if (store) await del(key(table), store);
  } catch {
    /* ignore */
  }
}

/** Drop the whole sync cache (used by "clear local data"). */
export async function clearAllTables(tables: string[]): Promise<void> {
  for (const t of tables) await clearTable(t);
}
