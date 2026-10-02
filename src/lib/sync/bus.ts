/**
 * Tiny invalidation bus: `bumpDataSync()` forces every mounted useCachedData
 * hook to pull a delta immediately (used after CSV imports, backfills,
 * restores — server-side bulk writes that the reactive head may batch).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

// A burst of writes (bulk import, restore, backfill) used to fan out one delta
// pull per bump. Coalesce everything landing inside this window into a single
// notification so the bus costs at most one pull per burst.
const COALESCE_MS = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener never breaks the bumper */
    }
  });
}

export function bumpDataSync(): void {
  if (timer) return; // a flush is already scheduled — coalesce into it
  timer = setTimeout(flush, COALESCE_MS);
}

export function bumpDataSyncListen(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
