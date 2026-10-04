"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { tursoSql } from "./tursoClient";
import { decodeRow } from "../lib/turso-migrate";
import { MIGRATION_TABLES } from "../lib/turso-schema.generated";
import {
  buildClosetListSql,
  buildGroupListSql,
  type Bind,
} from "../lib/turso-sql";

/**
 * Turso-backed catalog reads — the Convex replacements for catalog.ts's list
 * queries. Node runtime (see tursoClient.ts for why that is mandatory).
 *
 * Rows come back in Convex document shape so the pages consuming them keep
 * working unchanged while the store underneath moves.
 */

async function run(sql: string, args: Bind[]): Promise<unknown[]> {
  const { sql: db, problem } = tursoSql();
  if (!db) throw new Error(problem ?? "Turso is not configured");
  const res = await db.execute(sql, args);
  return res.rows;
}

function decode(table: string, rows: unknown[]): Record<string, unknown>[] {
  const columns = MIGRATION_TABLES[table];
  return rows.map((row) =>
    decodeRow(row as Record<string, unknown>, columns),
  );
}

async function requireAdmin(ctx: ActionCtx) {
  const me = (await ctx.runQuery(internal.users.currentInternalUser, {})) as {
    role?: string;
  } | null;
  if (!me || me.role !== "admin") throw new Error("Admin access required");
}

/** Non-students may browse the catalog; admins may also edit it. */
async function requireMember(ctx: ActionCtx) {
  const me = (await ctx.runQuery(internal.users.currentInternalUser, {})) as {
    role?: string;
  } | null;
  if (!me) throw new Error("Please sign in first");
  if (me.role === "student") throw new Error("Students are blocked from the catalog");
}

export const listClosets = action({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    const { sql } = buildClosetListSql();
    return decode("closets", await run(sql, []));
  },
});

export const listGroups = action({
  args: {
    categoryId: v.optional(v.string()),
    closetId: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    const { sql, args: params } = buildGroupListSql(args);
    return decode("groups", await run(sql, params));
  },
});

/** Sanity check for an admin: is the catalog actually being served from Turso. */
export const catalogCounts = action({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const counts: Record<string, number> = {};
    for (const table of ["closets", "categories", "groups", "parts"]) {
      const rows = await run(`SELECT COUNT(*) AS n FROM "${table}"`, []);
      counts[table] = Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
    }
    return counts;
  },
});