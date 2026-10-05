/**
 * Dynamic read plan — the read-reduction brain of the Turso cutover.
 *
 * Turso bills ROW READS on the free plan, so the cheapest read is the one we
 * never make. A fixed "refetch every 10 minutes" TTL throws that away: it
 * refetches even when NOTHING changed. This module replaces the timer with a
 * data-driven decision: a cached result stays valid as long as no table it saw
 * has moved its change head. Only a real change (or a very old entry) costs a
 * read.
 *
 * Two independent mechanisms, both pure and unit-testable:
 *
 *  1. {@link planRead} — decide whether to serve cache, refetch, or both, by
 *     diffing the change heads a result was fetched at against the heads now
 *     (`shouldRefetch` from turso-data). This is the whole budget policy: no
 *     head movement → zero data reads.
 *
 *  2. {@link createFetchGate} — collapse concurrent reads of the same key into
 *     ONE in-flight request, so N components mounting together cost one read
 *     instead of N.
 */

import { shouldRefetch, type ChangeHead } from "@/lib/turso-data";
import type { CacheEntry } from "./queryCache";

export type ReadReason = "miss" | "offline" | "heads-unchanged" | "head-moved" | "aged-out";

export type ReadDecision = {
  /** May we render the cached value right now? */
  showCached: boolean;
  /** Should we hit the database? */
  fetch: boolean;
  reason: ReadReason;
  /** The tables whose head moved since the result was fetched. */
  tablesMoved: string[];
};

/**
 * Hard safety net. Even when heads say "nothing changed", an entry older than
 * this is refetched — it caps the damage of a missed head publish (a write that
 * failed to notify, or a head row that was pruned) without reopening the
 * read flood a short TTL caused. Long on purpose: heads are the primary signal.
 */
export const DEFAULT_SAFETY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type PlanReadInput = {
  entry: CacheEntry | undefined | null;
  /** Heads observed the last time this entry was fetched. */
  headsAtFetch: Record<string, ChangeHead> | undefined;
  /** Heads right now (from the shared head store). */
  headsNow: Record<string, ChangeHead>;
  now: number;
  online: boolean;
  /** Override the safety net (defaults to {@link DEFAULT_SAFETY_MAX_AGE_MS}). */
  maxAgeMs?: number;
};

/**
 * Decide how to serve one cache key.
 *
 * Order matters:
 *  - no entry            → miss: show nothing, fetch when online.
 *  - offline             → show whatever we have, never fetch.
 *  - head moved          → show the cached value AND refetch (stale-while-
 *                          revalidate: the user sees data instantly).
 *  - heads unchanged     → serve cache, NO read at all.
 *  - aged past the net   → refetch even though heads look unchanged.
 */
export function planRead(input: PlanReadInput): ReadDecision {
  const { entry, headsAtFetch, headsNow, now, online } = input;

  if (!entry || typeof entry.storedAt !== "number") {
    return { showCached: false, fetch: online, reason: "miss", tablesMoved: [] };
  }

  if (!online) {
    return { showCached: true, fetch: false, reason: "offline", tablesMoved: [] };
  }

  const tablesMoved = shouldRefetch(headsAtFetch ?? {}, headsNow);
  if (tablesMoved.length > 0) {
    return { showCached: true, fetch: true, reason: "head-moved", tablesMoved };
  }

  const maxAge = input.maxAgeMs ?? DEFAULT_SAFETY_MAX_AGE_MS;
  const ageMs = Math.max(0, now - entry.storedAt);
  if (ageMs > maxAge) {
    return { showCached: true, fetch: true, reason: "aged-out", tablesMoved: [] };
  }

  return { showCached: true, fetch: false, reason: "heads-unchanged", tablesMoved: [] };
}

// ===== Fetch coalescing ====================================================

export type FetchGate = {
  /** Run `fn` for `key`, or join the in-flight run already started for it. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Is a fetch currently in flight for this key? */
  inFlight(key: string): boolean;
};

/**
 * One shared gate per process: mounting ten components that read the same key
 * at once issues ONE underlying request and hands every caller the same result.
 */
export function createFetchGate(): FetchGate {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing as Promise<T>;
      const started = fn().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },
    inFlight(key: string): boolean {
      return inFlight.has(key);
    },
  };
}

/** The process-wide gate used by the query hooks. */
export const queryFetchGate = createFetchGate();
