"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { tursoSql } from "./tursoClient";
import { MIGRATION_TABLES } from "../lib/turso-schema.generated";
import { decodeRow } from "../lib/turso-migrate";

/**
 * Turso as the data store — the read/write layer the app will use once it stops
 * treating Convex as its database.
 *
 * Everything here runs in the node runtime (see tursoClient.ts for why that
 * is not optional). Rows are returned in the SAME shape Convex documents had
 * (`_id`, `_creationTime`, typed fields), so callers can swap a store without
 * every call site changing at once.
 *
 * Internal actions are server/CLI only; the public `count` action is admin
 * gated and exists so an admin can sanity-check the store from the UI.
 */

/** Only tables the migration spec knows about are addressable. */
function assertTable(table: string): Record<string, never> {
  const columns = MIGRATION_TABLES[table];
  if (!columns) throw new Error(`Unknown table "${table}"`);
  return columns as Record<string, never>;
}

const q = (name: string) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * A tiny equality filter. Deliberately narrow: every column name is validated
 * against the generated spec and every value becomes a bound parameter, so a
 * caller can never inject SQL through a column or value.
 */
export type Filter = Record<string, string | number | boolean>;

function whereClause(
  table: string,
  filter?: Filter,
): { sql: string; args: unknown[] } {
  if (!filter || Object.keys(filter).length === 0) {
    return { sql: "", args: [] };
  }
  const columns = MIGRATION_TABLES[table];
  const parts: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (!(key in columns)) {
      throw new Error(`Unknown column "${table}.${key}"`);
    }
    parts.push(`${q(key)} = ?`);
    args.push(value);
  }
  return { sql: ` WHERE ${parts.join(" AND ")}`, args };
}

/** SELECT from a migrated table, decoded back into Convex-style documents. */
export async function selectRows<T = Record<string, unknown>>(
  table: string,
  opts: { filter?: Filter; orderBy?: string; limit?: number } = {},
): Promise<T[]> {
  assertTable(table);
  const { sql, problem } = tursoSql();
  if (!sql) throw new Error(problem ?? "Turso is not configured");

  const columns = MIGRATION_TABLES[table];
  const names = Object.keys(columns);
  const { sql: where, args } = whereClause(table, opts.filter);

  // Order by a real SQLite column: the spec columns plus the two system ones,
  // which are stored as _ts / _id (NOT the Convex document names).
  const orderable =
    opts.orderBy !== undefined && (opts.orderBy in columns || opts.orderBy === "_ts" || opts.orderBy === "_id");
  const order = orderable
    ? ` ORDER BY ${q(opts.orderBy!)}`
    : ` ORDER BY ${q("_ts")}`;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);

  const res = await sql.execute(
    `SELECT ${["_id", "_ts", "_json", ...names].map(q).join(", ")}
     FROM ${q(table)}${where}${order} LIMIT ?`,
    [...args, limit],
  );
  return res.rows.map((row) => decodeRow(row as Record<string, unknown>, columns) as T);
}

/** SELECT one row by its Convex document id. */
export async function selectById<T = Record<string, unknown>>(
  table: string,
  id: string,
): Promise<T | null> {
  assertTable(table);
  const { sql, problem } = tursoSql();
  if (!sql) throw new Error(problem ?? "Turso is not configured");

  const columns = MIGRATION_TABLES[table];
  const names = Object.keys(columns);
  const res = await sql.execute(
    `SELECT ${["_id", "_ts", "_json", ...names].map(q).join(", ")}
     FROM ${q(table)} WHERE ${q("_id")} = ? LIMIT 1`,
    [id],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? (decodeRow(row, columns) as T) : null;
}

export async function countRows(table: string, filter?: Filter): Promise<number> {
  assertTable(table);
  const { sql, problem } = tursoSql();
  if (!sql) throw new Error(problem ?? "Turso is not configured");
  const { sql: where, args } = whereClause(table, filter);
  const res = await sql.execute(
    `SELECT COUNT(*) AS n FROM ${q(table)}${where}`,
    args,
  );
  return Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

/**
 * DELETE … WHERE, restricted to an explicit id. There is deliberately no
 * unfiltered delete in this layer: clearing a table is what the migration's
 * `replace` mode is for, and an accidental bare DELETE here would take the
 * club's data with it.
 */
export async function deleteById(table: string, id: string): Promise<boolean> {
  assertTable(table);
  const { sql, problem } = tursoSql();
  if (!sql) throw new Error(problem ?? "Turso is not configured");
  await sql.execute(`DELETE FROM ${q(table)} WHERE ${q("_id")} = ?`, [id]);
  return true;
}

// ===== Entry points ========================================================

/**
 * The generic read used by the app. Admin-only: it exposes whatever tables the
 * migration brought across, and that is club data (members, rentals), so it is
 * never public.
 */
export const query = action({
  args: {
    table: v.string(),
    filter: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    orderBy: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const me = await ctx.runQuery(internal.users.currentInternalUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    return selectRows(args.table, {
      filter: args.filter,
      orderBy: args.orderBy,
      limit: args.limit,
    });
  },
});

/** Server/CLI only: proves the node → Turso read path with real data. */
export const peekInternal = internalAction({
  args: { table: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, { table, limit }) => {
    const rows = await selectRows(table, { limit: limit ?? 3 });
    return { table, count: await countRows(table), sample: rows };
  },
});

/** Admin-only: is Turso reachable and how big is this table. */
export const count = action({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    const me = await ctx.runQuery(internal.users.currentInternalUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    return { table, count: await countRows(table) };
  },
});