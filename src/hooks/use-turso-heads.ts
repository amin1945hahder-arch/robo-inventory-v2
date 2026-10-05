/**
 * useTursoHeads — the Turso reactivity bridge, client side.
 *
 * Turso owns the data and is not reactive; Convex is reactive but cannot read
 * Turso. The converted write actions publish a tiny head row per touched table
 * into the Convex `tursoHeads` table (see src/convex/head.ts), and this hook
 * keeps ONE subscription to the reactive `head:tursoHeads` query. When a head
 * actually MOVES it bumps the shared data-sync bus, which revalidates the
 * offline query caches.
 *
 * The budget guarantee lives in `shouldRefetch`: a head that did not move
 * triggers no bump, so an idle client costs zero Turso data reads.
 */
import { useEffect, useRef } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import { shouldRefetch, type ChangeHead } from "@/lib/turso-data";
import { bumpDataSync } from "@/lib/sync/bus";
import { setHeads } from "@/lib/sync/heads";

type HeadMap = Record<string, { at: number; seq: number }>;

export function useTursoHeads(): void {
  const convex = useConvex();
  const last = useRef<Record<string, ChangeHead>>({});
  // The first snapshot PRIMES the ref (a fresh page must not bump on mount —
  // its queries are already fetching); only later movement wakes the bus.
  const primed = useRef(false);

  useEffect(() => {
    const watch = convex.watchQuery(api.head.tursoHeads, {});
    const unsub = watch.onUpdate(() => {
      const res = watch.localQueryResult() as HeadMap | undefined;
      if (!res) return;
      const next: Record<string, ChangeHead> = {};
      for (const [table, h] of Object.entries(res)) {
        next[table] = { table, at: h.at, seq: h.seq };
      }
      // Publish for the read planner: a query can then skip its read entirely
      // while none of the tables it saw has moved.
      setHeads(next);
      if (!primed.current) {
        primed.current = true;
        last.current = next;
        return;
      }
      const moved = shouldRefetch(last.current, next);
      last.current = next;
      if (moved.length > 0) bumpDataSync();
    });
    return () => unsub();
  }, [convex]);
}
