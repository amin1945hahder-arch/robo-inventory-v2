"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { SYNC_TABLES } from "./sync";
import { tursoExecutor } from "./tursoDb";
import { requireMigrationAdmin } from "./tursoMigrate";
import {
  applyMirrorDeletes,
  applyMirrorPage,
  readCursor,
  writeCursor,
} from "../lib/turso-mirror";

/**
 * Live Convex → Turso mirror (TRANSITIONAL — delete once every write is on
 * Turso).
 *
 * The cutover risk is consistency: a converted READ serves Turso while its
 * WRITER is still on Convex, which would serve stale data. This scheduled
 * action keeps Turso a current replica so reads can move safely and writes can
 * follow at their own pace.
 *
 * Per run, per table: pull only rows past the cursor (by_updatedAt index — no
 * scans), upsert in batches, apply hard-delete tombstones, advance the cursor,
 * and publish the touched tables to the client head mirror. Bounded by
 * `maxPages` so one run always finishes well inside the action limit; the cron
 * simply picks up where it left off.
 */

const PAGE = 500;
const MAX_PAGES = 8;
/** Tombstone stream shares the cursor table under this reserved key. */
const TOMBSTONE_CURSOR = "__tombstones__";

const argShape = {
  tables: v.optional(v.array(v.string())),
  maxPages: v.optional(v.number()),
};

type MirrorArgs = { tables?: string[]; maxPages?: number };
type MirrorResult = {
  ok: boolean;
  problem: string | null;
  tables: string[];
  rows: number;
  deleted: number;
};

async function runMirror(ctx: ActionCtx, { tables, maxPages }: MirrorArgs): Promise<MirrorResult> {
  const { exec, problem } = tursoExecutor();
  if (!exec) return { ok: false, problem, tables: [], rows: 0, deleted: 0 };

  const synced = new Set<string>(SYNC_TABLES);
  const wanted = (tables ?? [...SYNC_TABLES]).filter((t) => synced.has(t));
  const pages = Math.max(1, Math.min(maxPages ?? MAX_PAGES, 20));
  const touched = new Set<string>();
  let rows = 0;
  let deleted = 0;

  for (const table of wanted) {
    let cursor = await readCursor(exec, table);
    for (let p = 0; p < pages; p++) {
      const page = (await ctx.runQuery(internal.tursoMigrateSource.mirrorPage, {
        table,
        since: cursor,
        limit: PAGE,
      })) as Record<string, unknown>[];
      if (page.length === 0) break;
      const written = await applyMirrorPage(exec, table, page);
      rows += written;
      for (const row of page) cursor = Math.max(cursor, Number(row.updatedAt ?? cursor));
      await writeCursor(exec, table, cursor);
      if (written > 0) touched.add(table);
      if (page.length < PAGE) break;
    }
  }

  // Hard deletes: a single global tombstone cursor (tombstones carry their
  // table), scoped to mirrored tables.
  let tcursor = await readCursor(exec, TOMBSTONE_CURSOR);
  for (let p = 0; p < pages; p++) {
    const ts = (await ctx.runQuery(internal.tursoMigrateSource.mirrorTombstones, {
      since: tcursor,
      limit: PAGE,
    })) as { table: string; recordId: string; deletedAt: number }[];
    if (ts.length === 0) break;
    const byTable = new Map<string, string[]>();
    for (const t of ts) {
      if (!synced.has(t.table)) continue;
      const list = byTable.get(t.table) ?? [];
      list.push(String(t.recordId));
      byTable.set(t.table, list);
    }
    for (const [table, ids] of byTable) {
      deleted += await applyMirrorDeletes(exec, table, ids);
      touched.add(table);
    }
    for (const t of ts) tcursor = Math.max(tcursor, t.deletedAt);
    await writeCursor(exec, TOMBSTONE_CURSOR, tcursor);
    if (ts.length < PAGE) break;
  }

  if (touched.size > 0) {
    await ctx.runMutation(internal.head.publishHeads, { tables: [...touched] });
  }
  return { ok: true, problem: null, tables: [...touched], rows, deleted };
}

/** Cron entry point (no user session). */
export const syncNow = internalAction({
  args: argShape,
  handler: runMirror,
});

/** Admin / operator manual run. */
export const syncNowAdmin = action({
  args: argShape,
  handler: async (ctx, args) => {
    await requireMigrationAdmin(ctx);
    return await runMirror(ctx, args);
  },
});
