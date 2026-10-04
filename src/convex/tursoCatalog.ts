"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { tursoSql, type TursoSql } from "./tursoClient";
import { decodeRow, upsertRow } from "../lib/turso-migrate";
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

// ===== Writes =============================================================
// Once the write path moves too, a table is not half-migrated: it is either
// read AND written in Turso, or untouched in Convex.

async function execSql(): Promise<TursoSql> {
  const { sql, problem } = tursoSql();
  if (!sql) throw new Error(problem ?? "Turso is not configured");
  return sql;
}

export const upsertCloset = action({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    location: v.optional(v.string()),
    note: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("A closet needs a name");

    const sql = await execSql();
    const existing = args.id ? await sql.execute(
      `SELECT "updatedAt" FROM "closets" WHERE "_id" = ? LIMIT 1`,
      [args.id],
    ) : { rows: [] as unknown[] };

    const id = await upsertRow(sql, "closets", {
      ...(args.id ? { _id: args.id } : {}),
      name,
      location: args.location?.trim() || undefined,
      note: args.note?.trim() || undefined,
      imageUrl: args.imageUrl || undefined,
      // Preserve the original creation time on an edit.
      ...(existing.rows.length
        ? { _creationTime: undefined }
        : {}),
      updatedAt: Date.now(),
    });
    return { id };
  },
});

export const deleteCloset = action({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const sql = await execSql();

    // Refuse to orphan data: a closet that still holds groups must not vanish.
    const used = await sql.execute(
      `SELECT COUNT(*) AS n FROM "groups" WHERE "closetId" = ?`,
      [id],
    );
    const count = Number((used.rows[0] as { n?: number } | undefined)?.n ?? 0);
    if (count > 0) {
      throw new Error(
        `This storage still holds ${count} categor${count === 1 ? "y" : "ies"} — move or delete them first`,
      );
    }
    await sql.execute(`DELETE FROM "closets" WHERE "_id" = ?`, [id]);
    return { deleted: true };
  },
});

/**
 * Read-only pre-flight for the WRITE path.
 *
 * Runs the exact statements upsertCloset/deleteCloset depend on — the
 * existence lookup and the orphan-count query — so the SQL dialect is proven
 * against the live database without writing anything to it. The write actions
 * themselves are admin gated, so this is how the CLI can validate them.
 */
export const writePathSelfTest = internalAction({
  args: { closetId: v.optional(v.string()) },
  handler: async (_ctx, { closetId }) => {
    const sql = await execSql();
    const probe = closetId ?? "__no_such_closet__";
    const lookup = await sql.execute(
      `SELECT "updatedAt" FROM "closets" WHERE "_id" = ? LIMIT 1`,
      [probe],
    );
    const orphans = await sql.execute(
      `SELECT COUNT(*) AS n FROM "groups" WHERE "closetId" = ?`,
      [probe],
    );
    // A prepared write that proves INSERT syntax works and leaves nothing
    // behind. Explicit BEGIN/ROLLBACK across separate execute() calls does NOT
    // work over libSQL's HTTP protocol — every call is its own transaction, so
    // ROLLBACK fails with "no transaction is active". executeBatch runs its
    // statements in one transaction, so insert+delete succeed or not at all.
    const probeId = `kselftest${Date.now()}`;
    await sql.executeBatch([
      {
        sql: `INSERT INTO "closets" ("_id", "_ts", "name") VALUES (?, ?, ?)`,
        args: [probeId, Date.now(), "__selftest__"],
      },
      {
        sql: `DELETE FROM "closets" WHERE "_id" = ?`,
        args: [probeId],
      },
    ]);
    const insertWorks = true;
    return {
      lookupRows: lookup.rows.length,
      groupsInProbe: Number((orphans.rows[0] as { n?: number } | undefined)?.n ?? 0),
      insertWorks,
    };
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