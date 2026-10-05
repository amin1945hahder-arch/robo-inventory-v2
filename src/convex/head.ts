import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireUser } from "./lib";

/**
 * Turso change-head mirror — the reactivity bridge.
 *
 * Turso owns the data, but (a) Convex queries cannot read Turso and (b) Turso
 * is not reactive. So the converted ACTIONS, after writing to Turso, publish
 * the touched table names here through `publishHeads`. Clients subscribe to
 * the reactive `tursoHeads` query, diff the heads against what they last saw
 * (`shouldRefetch` from turso-data.ts) and pull from Turso ONLY for tables that
 * moved — which is the free-plan guarantee: no head movement means zero data
 * reads.
 *
 * This is deliberately tiny: one row per data table (≤36 rows), so the query
 * is one bounded, index-free-but-small read on a subscription that fires only
 * when a Turso write actually happens.
 */

/**
 * Bump one head row per touched table. Idempotent per table name and cheap:
 * called at the tail of each converted write action.
 */
export const publishHeads = internalMutation({
  args: { tables: v.array(v.string()) },
  handler: async (ctx, { tables }) => {
    const now = Date.now();
    for (const table of new Set(tables)) {
      const existing = await ctx.db
        .query("tursoHeads")
        .withIndex("by_table", (q) => q.eq("table", table))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { at: now, seq: existing.seq + 1 });
      } else {
        await ctx.db.insert("tursoHeads", { table, at: now, seq: 0 });
      }
    }
  },
});

/**
 * Reactive head map: `{ [table]: { at, seq } }`. Re-runs only when a Turso
 * write publishes a head, so an idle client costs nothing and costs one small
 * read when something actually changed.
 */
export const tursoHeads = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("tursoHeads").collect();
    const out: Record<string, { at: number; seq: number }> = {};
    for (const row of rows) out[row.table] = { at: row.at, seq: row.seq };
    return out;
  },
});
