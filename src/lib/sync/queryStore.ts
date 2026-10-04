/**
 * IndexedDB persistence for the read-through query cache.
 *
 * Separate store from the delta-sync table cache (different shape, different
 * lifecycle): this holds whole query RESULTS keyed by (user, query, args).
 * All operations are best-effort — private mode or a full quota degrades to
 * "no local cache" without ever breaking the UI.
 */
import { get, set, del, createStore } from "idb-keyval";
import type { CacheEntry } from "./queryCache";

const store = typeof indexedDB !== "undefined" ? createStore("roboshelf-query", "results") : undefined;

function keyOf(key: string): string {
  return `q:${key}`;
}

/** Load one cached query result (defensive: corrupt/missing → undefined). */
export async function loadQueryEntry<T>(key: string): Promise<CacheEntry<T> | undefined> {
  try {
    if (!store) return undefined;
    const raw = await get(keyOf(key), store);
    if (!raw || typeof raw !== "object") return undefined;
    const entry = raw as CacheEntry<T>;
    if (typeof entry.storedAt !== "number") return undefined;
    return entry;
  } catch {
    return undefined;
  }
}

/** Persist one query result (fire-and-forget; failures are non-fatal). */
export async function saveQueryEntry<T>(key: string, value: T, storedAt: number): Promise<void> {
  try {
    if (!store) return;
    await set(keyOf(key), { value, storedAt } satisfies CacheEntry<T>, store);
  } catch {
    /* quota / private mode — the cache simply won't survive the session */
  }
}

/** Drop every cached result for one user (sign-out, account switch). */
export async function clearUserScope(userId: string | null): Promise<void> {
  try {
    if (!store) return;
    // Keys are prefixed with the scope, so a targeted scan is cheap and
    // avoids nuking another account's cache on a shared device.
    const prefix = `q:${userId || "anon"}|`;
    const all = (await import("idb-keyval")).keys(store);
    for (const k of await all) {
      if (typeof k === "string" && k.startsWith(prefix)) await del(k, store);
    }
  } catch {
    /* ignore */
  }
}

/** Drop the whole query cache ("clear local data"). */
export async function clearAllQueryEntries(): Promise<void> {
  try {
    if (!store) return;
    const { keys } = await import("idb-keyval");
    for (const k of await keys(store)) {
      if (typeof k === "string" && k.startsWith("q:")) await del(k, store);
    }
  } catch {
    /* ignore */
  }
}