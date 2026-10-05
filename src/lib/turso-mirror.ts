/**
 * Convex → Turso live mirror (transitional).
 *
 * WHY THIS EXISTS
 *
 * The big-bang cutover risk is consistency: a converted READ serves Turso, but
 * every WRITE still lands in Convex until its writer is converted too — so a
 * half-converted app serves stale data. This module removes that risk by making
 * Turso a current REPLICA of Convex continuously.
 *
 * A scheduled action pulls, per table, only the rows whose `updatedAt` moved
 * past a cursor (the same `by_updatedAt` index the delta-sync layer already
 * uses — never a scan), upserts them into Turso in batches, applies hard-delete
 * tombstones, and advances the cursor. Reads can therefore move to Turso
 * incrementally, and writes can follow later; when every write is on Turso this
 * mirror is simply deleted.
 *
 * Everything here is pure and driver-agnostic (`SqlExecutor`), so it is
 * unit-tested offline with `node:sqlite`.
 */

import { bumpChange } from "./turso-data";
import {
  encodeRow,
  insertSqlMany,
  type ConvexDoc,
  type SqlExecutor,
} from "./turso-migrate";
import { IDMAP_DDL, IDMAP_TABLE } from "./turso-bridge";
import { MIGRATION_TABLES } from "./turso-schema.generated";

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** One row per mirrored table: the `updatedAt` watermark already copied. */
export const MIRROR_TABLE = "_mirror";

export const MIRROR_DDL = `CREATE TABLE IF NOT EXISTS ${q(MIRROR_TABLE)} (
  ${q("table")} TEXT PRIMARY KEY,
  ${q("cursor")} REAL NOT NULL,
  ${q("at")} REAL NOT NULL
)`;

/** Rows per statement — HTTP driver, so batch (see insertSqlMany). */
export const MIRROR_BATCH = 100;

/** Executors whose mirror/id-map DDL has already been applied this process. */
const schemaEnsured = new WeakSet<object>();
const idmapEnsured = new WeakSet<object>();

export async function ensureMirrorSchema(exec: SqlExecutor): Promise<void> {
  if (schemaEnsured.has(exec)) return;
  await exec.execute(MIRROR_DDL);
  schemaEnsured.add(exec);
}

/**
 * Every mirrored row's id must be resolvable by the bridge's id-based helpers
 * (`db.get(id)` on a freshly written Convex id, which carries no table
 * prefix). One statement per batch, only for the ids just written.
 */
async function recordIdMapBatch(
  exec: SqlExecutor,
  table: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  if (!idmapEnsured.has(exec)) {
    await exec.execute(IDMAP_DDL);
    idmapEnsured.add(exec);
  }
  const holes = ids.map(() => "?").join(", ");
  await exec.execute(
    `INSERT OR REPLACE INTO ${q(IDMAP_TABLE)} ("id", "table") SELECT "_id", ? FROM ${q(
      table,
    )} WHERE "_id" IN (${holes})`,
    [table, ...ids],
  );
}

/** The last `updatedAt` copied for this table (0 when never mirrored). */
export async function readCursor(exec: SqlExecutor, table: string): Promise<number> {
  await ensureMirrorSchema(exec);
  const res = await exec.execute(
    `SELECT ${q("cursor")} FROM ${q(MIRROR_TABLE)} WHERE ${q("table")} = ?`,
    [table],
  );
  const row = res.rows[0] as { cursor?: number } | undefined;
  return Number(row?.cursor ?? 0);
}

export async function writeCursor(
  exec: SqlExecutor,
  table: string,
  cursor: number,
  now = Date.now(),
): Promise<void> {
  await ensureMirrorSchema(exec);
  await exec.execute(
    `INSERT OR REPLACE INTO ${q(MIRROR_TABLE)} (${q("table")}, ${q("cursor")}, ${q("at")}) VALUES (?, ?, ?)`,
    [table, cursor, now],
  );
}

/**
 * Upsert a page of rows into one Turso table, batched, then bump the table's
 * change head so subscribed clients learn "something changed". Returns the
 * number of rows written.
 */
export async function applyMirrorPage(
  exec: SqlExecutor,
  table: string,
  rows: readonly ConvexDoc[],
): Promise<number> {
  const columns = MIGRATION_TABLES[table];
  if (!columns) throw new Error(`Table "${table}" is not in the migration spec`);
  let written = 0;
  for (let i = 0; i < rows.length; i += MIRROR_BATCH) {
    const chunk = rows
      .slice(i, i + MIRROR_BATCH)
      .filter((doc) => doc?._id !== undefined && doc?._id !== null);
    if (chunk.length === 0) continue;
    const stmt = insertSqlMany(table, chunk.length);
    const args: unknown[] = [];
    for (const doc of chunk) {
      const values = encodeRow(doc, columns);
      for (const c of stmt.columns) args.push(values[c] ?? null);
    }
    await exec.execute(stmt.sql, args);
    await recordIdMapBatch(
      exec,
      table,
      chunk.map((doc) => String(doc._id)),
    );
    written += chunk.length;
  }
  if (written > 0) await bumpChange(exec, table);
  return written;
}

/** Apply hard deletes (the tombstone stream) — deletes in Turso too. */
export async function applyMirrorDeletes(
  exec: SqlExecutor,
  table: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += MIRROR_BATCH) {
    const chunk = ids.slice(i, i + MIRROR_BATCH);
    const holes = chunk.map(() => "?").join(", ");
    await exec.execute(`DELETE FROM ${q(table)} WHERE ${q("_id")} IN (${holes})`, chunk);
    deleted += chunk.length;
  }
  if (deleted > 0) await bumpChange(exec, table);
  return deleted;
}
