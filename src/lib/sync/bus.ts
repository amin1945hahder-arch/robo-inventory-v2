/**
 * Tiny invalidation bus: `bumpDataSync()` forces every mounted useCachedData
 * hook to pull a delta immediately (used after CSV imports, backfills,
 * restores — server-side bulk writes that the reactive head may batch).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function bumpDataSync(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener never breaks the bumper */
    }
  });
}

export function bumpDataSyncListen(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
