/**
 * Offline read-through query cache — pure logic (no React, no IndexedDB), so
 * every rule here is unit-testable.
 *
 * The problem it solves: pages read through Convex's `useQuery`. Offline, the
 * websocket cannot deliver a result, so the hook stays `undefined` and the
 * page renders as "empty". This module defines the layer that makes those
 * reads survive a disconnect:
 *
 *  - `cacheKey` derives a stable, deterministic key per (query, args) pair.
 *    Args are sorted so `{a:1,b:2}` and `{b:2,a:1}` share one entry.
 *  - `decideFreshness` decides whether a cached entry may be shown, and
 *    whether it still needs a background revalidation once we're back online.
 *  - Entries are partitioned per user id, so two people sharing a device
 *    never read each other's cached data (an offline sign-in still lands on
 *    the right snapshot).
 *
 * Freshness model — deliberately simple and predictable:
 *  - no entry            → miss (render the loading state, fetch)
 *  - offline             → stale (serve it; never claim it's current)
 *  - within maxAgeMs     → fresh (serve it, no refetch needed)
 *  - older than maxAgeMs → stale (serve it AND revalidate when connected)
 */

export type CacheEntry<T = unknown> = {
  /** The query result exactly as Convex returned it. */
  value: T;
  /** Epoch ms when this entry was written. */
  storedAt: number;
};

export type Freshness = "miss" | "fresh" | "stale";

/** Default revalidation window: results are trusted this long. */
export const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Stable serialization of the args object. Keys are sorted recursively so
 * argument ORDER never creates a second cache entry for the same query.
 * `undefined` and `"skip"` both mean "no args" — they must not fork the key,
 * because `"skip"` is just Convex's sentinel for "don't run this yet".
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Cache key for one query invocation.
 * `api.parts.listMyRentals` reads as "parts/listMyRentals".
 */
export function cacheKey(queryName: string, args: unknown, userId: string | null): string {
  const scope = userId || "anon";
  return `${scope}|${queryName}|${stableStringify(args)}`;
}

/**
 * Is this cache entry good to show, and does it need revalidating?
 *
 * `stale` is the important case: an entry that is older than maxAge is still
 * BETTER than an empty page, so we serve it — but `needsRevalidate` is true so
 * the hook refetches the moment there's a connection.
 */
export function decideFreshness(
  entry: CacheEntry | undefined | null,
  opts: { now: number; online: boolean; maxAgeMs?: number },
): { freshness: Freshness; needsRevalidate: boolean; ageMs: number } {
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!entry || typeof entry.storedAt !== "number") {
    return { freshness: "miss", needsRevalidate: true, ageMs: Infinity };
  }
  const ageMs = Math.max(0, opts.now - entry.storedAt);

  // Offline: always serve what we have; revalidation is impossible anyway.
  if (!opts.online) return { freshness: "stale", needsRevalidate: false, ageMs };

  const fresh = ageMs <= maxAge;
  return { freshness: fresh ? "fresh" : "stale", needsRevalidate: !fresh, ageMs };
}

/** Rows whose payloads we must never leave on disk (defense in depth). */
export function shouldSkipPersist(key: string): boolean {
  return key.startsWith("anon|");
}