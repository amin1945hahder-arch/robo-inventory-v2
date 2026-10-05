import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { MIGRATION_TABLES } from "../lib/turso-schema.generated";

/**
 * The READ side of the Convex → Turso migration.
 *
 * It lives in its own (non-"use node") module because a node runtime module
 * may only define actions, and this has to be a query to reach ctx.db.
 *
 * Full fidelity on purpose: the existing appBackup dumps everything in one
 * execution and strips base64 avatars / redacts secrets to stay under Convex's
 * per-run read limit. A migration must not silently lose data, so this reads
 * exactly one table per execution and strips nothing.
 */
export const dumpTable = internalQuery({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    if (!MIGRATION_TABLES[table]) {
      throw new Error(`Unknown table "${table}"`);
    }
    // Dynamic table name — the same `as any` escape appBackup.ts uses, because
    // the spec is generated and the compiler cannot know it at build time.
    const rows = (await (ctx.db.query(table as any) as any).collect()) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => ({ ...row, _table: table }));
  },
});

/**
 * One page of rows whose `updatedAt` moved past `since`, using ONLY the
 * `by_updatedAt` index (the delta-sync contract: never a table scan). Feed it
 * the mirror cursor and it returns just what still needs copying to Turso.
 */
export const mirrorPage = internalQuery({
  args: { table: v.string(), since: v.number(), limit: v.number() },
  handler: async (ctx, { table, since, limit }) => {
    if (!MIGRATION_TABLES[table]) throw new Error(`Unknown table "${table}"`);
    const rows = (await (ctx.db.query(table as any) as any)
      .withIndex("by_updatedAt", (q: any) => q.gt("updatedAt", since))
      .take(Math.max(1, Math.min(limit, 1000)))) as Record<string, unknown>[];
    return rows;
  },
});

/** Hard-delete tombstones past `since`, so the mirror can delete them in Turso. */
export const mirrorTombstones = internalQuery({
  args: { since: v.number(), limit: v.number() },
  handler: async (ctx, { since, limit }) => {
    return await ctx.db
      .query("syncTombstones")
      .withIndex("by_deletedAt", (q) => q.gt("deletedAt", since))
      .take(Math.max(1, Math.min(limit, 1000)));
  },
});