/**
 * Shared Turso change-head store (client side).
 *
 * `useTursoHeads` is the single writer: it keeps one subscription to the
 * reactive `head:tursoHeads` query and publishes each snapshot here. Readers —
 * the query cache and any hook that wants to know "did anything change since I
 * last read this?" — pull the latest snapshot synchronously and can subscribe
 * to updates.
 *
 * Module-level on purpose: the head map is tiny (one small object per table)
 * and shared by every mounted query hook, so there is exactly ONE place that
 * mutates it and no per-hook duplication.
 */
import type { ChangeHead } from "@/lib/turso-data";

export type HeadMap = Record<string, ChangeHead>;

let current: HeadMap = {};
const listeners = new Set<(heads: HeadMap) => void>();

/** The latest known heads (empty until the first snapshot arrives). */
export function getHeads(): HeadMap {
  return current;
}

/** Publish a new snapshot. No-op when nothing is listening and nothing moved. */
export function setHeads(next: HeadMap): void {
  current = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      /* a broken listener never breaks the publisher */
    }
  }
}

export function subscribeHeads(fn: (heads: HeadMap) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
