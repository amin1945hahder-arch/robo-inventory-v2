"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  MIGRATION_VERSION,
  appTables,
  importDump,
  migrationMetaSql,
  verifyDump,
  type Dump,
  type SqlExecutor,
} from "../lib/turso-migrate";
import { MIGRATION_TABLES } from "../lib/turso-schema.generated";
import { tursoSql } from "./tursoClient";
import { IDMAP_DDL, backfillIdMap } from "../lib/turso-bridge";

/**
 * Convex → Turso migration tooling.
 *
 * This is TOOLING, not a cutover: nothing in the app reads from Turso yet, and
 * Convex Auth keeps owning identity (the users / accounts / sessions tables
 * come across so sign-in survives the move). Run it, check the reports, and
 * only then decide whether to repoint the app's queries at Turso.
 *
 * Everything is admin-gated and every step is report-only until you call
 * `runImport` with an explicit mode. `preview` never writes anything.
 *
 * Config (Keys tab):
 *   TURSO_DATABASE_URL  — libsql://<db>-<org>.turso.io
 *   TURSO_AUTH_TOKEN    — a token with write access
 */

// The APP-data tables only.
//
// NOT `Object.keys(MIGRATION_TABLES)`: that set also contains the Convex-only
// infrastructure tables (`tursoHeads`, the change-head signal the frontend uses
// to decide when to refetch a Turso-backed action). Turso tracks its own heads in
// `_changes`, so copying `tursoHeads` across would cost rows on the free plan and
// make `verify` report a permanent mismatch that has nothing to do with the data
// migration. Every default below therefore comes from `appTables()`.
const TABLE_NAMES = appTables();

/**
 * The connection lives in tursoClient.ts now, shared with the runtime data
 * layer, so there is exactly one place that knows how to reach Turso.
 */
function tursoExecutor(): { exec: SqlExecutor | null; problem: string | null } {
  const { sql, problem } = tursoSql();
  return { exec: sql, problem };
}

/**
 * Authorization for migration steps.
 *
 * Two ways in, because the migration has two legitimate callers:
 *
 *  1. A signed-in club admin (from the app / dashboard).
 *  2. The operator running `bunx convex run tursoMigrate:…` from a terminal.
 *     `convex run` runs with NO user session, so (1) can never succeed there.
 *     The deployment-level CLI credential IS the authorization, but these steps
 *     read and rewrite the whole database, so the operator must ALSO opt in by
 *     explicitly enabling the switch on the deployment:
 *
 *         bunx convex env set TURSO_MIGRATION_ALLOW_CLI 1   # and unset after
 *
 *     Off by default: nothing here runs from a terminal unless you say so.
 */
export async function requireMigrationAdmin(ctx: ActionCtx): Promise<void> {
  const me = (await ctx.runQuery(internal.users.currentInternalUser, {})) as {
    role?: string;
  } | null;
  if (me && me.role === "admin") return;
  if (process.env.TURSO_MIGRATION_ALLOW_CLI === "1") return;
  throw new Error(
    "Admin access required — sign in as an admin, or set TURSO_MIGRATION_ALLOW_CLI=1 on the " +
      "deployment to run this from the CLI.",
  );
}

/** Pull a whole dump, table by table, from the connected Convex deployment. */
async function collectDump(ctx: ActionCtx, tables: string[]): Promise<Dump> {
  const dump: Dump = {};
  for (const table of tables) {
    dump[table] = (await ctx.runQuery(
      internal.tursoMigrateSource.dumpTable,
      { table },
    )) as Dump[string];
  }
  return dump;
}

/**
 * Read-only preview: how many rows each table holds on THIS deployment, plus
 * whether Turso is configured. Writes nothing.
 */
export const preview = action({
  args: {},
  handler: async (ctx): Promise<{
    source: string;
    turso: { configured: boolean; problem: string | null };
    version: number;
    tables: { table: string; rows: number }[];
    totalRows: number;
  }> => {
    await requireMigrationAdmin(ctx);
    const { exec, problem } = tursoExecutor();
    const tables: { table: string; rows: number }[] = [];
    let totalRows = 0;
    for (const table of TABLE_NAMES) {
      const rows = (await ctx.runQuery(
        internal.tursoMigrateSource.dumpTable,
        { table },
      )) as Dump[string];
      tables.push({ table, rows: rows.length });
      totalRows += rows.length;
    }
    return {
      source: "connected Convex deployment",
      turso: { configured: Boolean(exec), problem },
      version: MIGRATION_VERSION,
      tables,
      totalRows,
    };
  },
});

/**
 * The migration itself. `mode: "merge"` (the default) upserts rows and is safe
 * to re-run; `mode: "replace"` first empties each target table, which is what
 * a true one-shot migration wants — never use it against a database you have
 * already written to by hand.
 */
export const runImport = action({
  args: {
    mode: v.optional(v.union(v.literal("merge"), v.literal("replace"))),
    tables: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { mode, tables }) => {
    await requireMigrationAdmin(ctx);
    const wanted = (tables ?? TABLE_NAMES).filter((t) => t in MIGRATION_TABLES);
    if (wanted.length === 0) throw new Error("No known tables selected");

    const { exec, problem } = tursoExecutor();
    if (!exec) throw new Error(problem ?? "Turso is not configured");

    const dump = await collectDump(ctx, wanted);
    const report = await importDump(exec, dump, {
      mode: mode ?? "merge",
      source: "convex",
      tables: wanted,
    });

    const verify = await verifyDump(exec, dump, wanted);
    return { report, verify };
  },
});

/** Re-check a previous import against the live Convex data. Writes nothing. */
export const verify = action({
  args: { tables: v.optional(v.array(v.string())) },
  handler: async (ctx, { tables }) => {
    await requireMigrationAdmin(ctx);
    const wanted = (tables ?? TABLE_NAMES).filter((t) => t in MIGRATION_TABLES);
    const { exec, problem } = tursoExecutor();
    if (!exec) throw new Error(problem ?? "Turso is not configured");
    const dump = await collectDump(ctx, wanted);
    return verifyDump(exec, dump, wanted);
  },
});

/**
 * Server/CLI-only entry points.
 *
 * These are INTERNAL actions, so they are unreachable from the public
 * internet and need no user session — which is what lets the migration be run
 * from the Convex CLI (`convex run --type internal`) and from a cron/ops job.
 * The admin-gated actions above stay the ones the UI uses.
 */
export const previewInternal = internalAction({
  args: {},
  handler: async (ctx) => {
    const { exec, problem } = tursoExecutor();
    const tables: { table: string; rows: number }[] = [];
    let totalRows = 0;
    for (const table of TABLE_NAMES) {
      const rows = (await ctx.runQuery(
        internal.tursoMigrateSource.dumpTable,
        { table },
      )) as Dump[string];
      tables.push({ table, rows: rows.length });
      totalRows += rows.length;
    }
    return {
      turso: { configured: Boolean(exec), problem },
      version: MIGRATION_VERSION,
      tables,
      totalRows,
    };
  },
});

export const runImportInternal = internalAction({
  args: {
    mode: v.optional(v.union(v.literal("merge"), v.literal("replace"))),
    tables: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { mode, tables }) => {
    const wanted = (tables ?? TABLE_NAMES).filter((t) => t in MIGRATION_TABLES);
    if (wanted.length === 0) throw new Error("No known tables selected");
    const { exec, problem } = tursoExecutor();
    if (!exec) throw new Error(problem ?? "Turso is not configured");

    const dump = await collectDump(ctx, wanted);
    const report = await importDump(exec, dump, {
      mode: mode ?? "merge",
      source: "convex-cli",
      tables: wanted,
    });
    const verify = await verifyDump(exec, dump, wanted);
    return { report, verify };
  },
});

export const verifyInternal = internalAction({
  args: { tables: v.optional(v.array(v.string())) },
  handler: async (ctx, { tables }) => {
    const wanted = (tables ?? TABLE_NAMES).filter((t) => t in MIGRATION_TABLES);
    const { exec, problem } = tursoExecutor();
    if (!exec) throw new Error(problem ?? "Turso is not configured");
    return verifyDump(exec, await collectDump(ctx, wanted), wanted);
  },
});

/**
 * Backfill the `_idmap` (id → table) index the Turso bridge needs to resolve
 * MIGRATED Convex ids, which carry no table prefix. Run once after an import;
 * idempotent, and one statement per table (see backfillIdMap).
 */
export const syncIds = action({
  args: { tables: v.optional(v.array(v.string())) },
  handler: async (ctx, { tables }) => {
    await requireMigrationAdmin(ctx);
    const { exec, problem } = tursoExecutor();
    if (!exec) throw new Error(problem ?? "Turso is not configured");
    const wanted = (tables ?? TABLE_NAMES).filter((t) => t in MIGRATION_TABLES);
    await exec.execute(IDMAP_DDL);
    const recorded = await backfillIdMap(exec, wanted);
    return { tables: wanted.length, recorded };
  },
});

/** Previous migration runs recorded in the target database. */
export const history = action({
  args: {},
  handler: async (ctx) => {
    await requireMigrationAdmin(ctx);
    const { exec, problem } = tursoExecutor();
    if (!exec) return { configured: false as const, problem, runs: [] };
    for (const sql of migrationMetaSql()) await exec.execute(sql);
    const res = await exec.execute(
      'SELECT id, startedAt, finishedAt, version, source, mode, rowsWritten, ok, error FROM "_migration_runs" ORDER BY id DESC LIMIT 20',
    );
    return { configured: true as const, problem: null, runs: res.rows };
  },
});