import { action } from "./_generated/server";
import { loadTurso } from "./tursoDb";

/**
 * Turso health probe.
 *
 * This file is deliberately NOT `"use node"`: the point is to prove the libsql
 * HTTP client works in Convex's DEFAULT runtime, which is what allows converted
 * reads to stay in their original module instead of moving to a separate
 * `"use node"` file (and changing their `api.` path).
 *
 * It performs the smallest possible real read (one row) and returns no data —
 * just whether the connection, the budget gate and the bridge all work.
 */
export const ping = action({
  args: {},
  handler: async () => {
    const { db, problem, budget } = loadTurso();
    if (!db) return { ok: false as const, problem };
    const rows = await db.query("closets").take(1);
    const usage = budget.usage();
    return {
      ok: true as const,
      problem: null,
      reachable: rows.length >= 0,
      reads: usage.reads,
    };
  },
});
