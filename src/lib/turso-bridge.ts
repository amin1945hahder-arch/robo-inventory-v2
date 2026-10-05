/**
 * turso-bridge — a Convex `ctx.db`-shaped facade over the Turso data layer.
 *
 * WHY:
 * Every converted data function becomes a Convex ACTION, and an action's body
 * should read like it always did:
 *
 *   const db = bridgedb(exec);
 *   const part = await db.get(id);            // was ctx.db.get(id)
 *   await db.patch(id, { note: "checked" });  // was ctx.db.patch(id, …)
 *   const id2  = await db.insert("parts", {…}); // was ctx.db.insert("parts", {…})
 *
 * The whole point is that the query→action conversion is a ONE-LINE change per
 * function (`ctx.db` → a `bridgedb(exec)` instance) instead of rewriting 529
 * call sites. That keeps the mechanical pass safe and reviewable.
 *
 * THE ID PROBLEM (why this file is not just a rename):
 * Convex ids are opaque strings with no table baked in. `tursoData` writes new
 * rows with a table-prefixed id (`parts.7xK2…`) so {@link tableOfId} can
 * resolve them, but rows produced by the Convex → Turso migration KEEP their
 * original Convex ids (`k57cnk5e1p1a62b8x2`), which carry no table. A bridge
 * that only takes an id therefore needs a fallback: the `_idmap` table, one row
 * per migrated document id → its table. {@link makeIdResolver} reads it with a
 * primary-key lookup (1 row read, never a scan) and caches hits, so the cost is
 * paid once per process, not once per call.
 *
 * Convex-compatibility decisions (all pinned by tests):
 *  - `insert(table, doc)` returns the new id STRING (like Convex), not the doc.
 *  - `replace(id, doc)` returns void (like Convex); `patch` merges and treats
 *    `undefined` as "remove field".
 *  - Every write bumps its table's change head (the free-plan "only fetch what
 *    changed" gate) unless `autoBump: false`.
 */

import { tableOfId, tursoData, TursoData, type DataDoc, type QuerySpec } from "./turso-data";
import type { ConvexDoc, SqlExecutor } from "./turso-migrate";

export const IDMAP_TABLE = "_idmap";

export const IDMAP_DDL = `CREATE TABLE IF NOT EXISTS "_idmap" (
  "id" TEXT PRIMARY KEY,
  "table" TEXT NOT NULL
)`;

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Resolve a document id to its table. May do I/O (the `_idmap` lookup), so it
 * is allowed to be async; a synchronous resolver is fine for tests.
 */
export type TableResolver = (id: string) => Promise<string | null> | string | null;

/**
 * Build a resolver backed by the `_idmap` table.
 *
 * `tableOfId` (table-prefixed Turso ids) is tried first for free; only ids
 * without a prefix pay the one-row primary-key lookup. Hits are cached for the
 * life of the resolver so the same id is never looked up twice.
 */
export function makeIdResolver(exec: SqlExecutor): TableResolver {
  const cache = new Map<string, string>();
  let ddlEnsured: Promise<void> | null = null;
  return async (id: string): Promise<string | null> => {
    const direct = tableOfId(id);
    if (direct) return direct;
    const cached = cache.get(id);
    if (cached) return cached;
    if (!ddlEnsured) ddlEnsured = exec.execute(IDMAP_DDL).then(() => undefined);
    await ddlEnsured;
    const res = await exec.execute(`SELECT "table" FROM ${q(IDMAP_TABLE)} WHERE "id" = ?`, [id]);
    const row = res.rows[0] as { table?: string } | undefined;
    if (!row?.table) return null;
    cache.set(id, row.table);
    return row.table;
  };
}

/**
 * Record migrated id → table rows so {@link makeIdResolver} can resolve ids
 * that were NOT created by the Turso layer (Convex-migrated rows). Bulk and
 * idempotent: safe to re-run on every migration pass.
 */
export async function recordIdMap(
  exec: SqlExecutor,
  table: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await exec.execute(IDMAP_DDL);
  for (const id of ids) {
    await exec.execute(
      `INSERT OR REPLACE INTO ${q(IDMAP_TABLE)} ("id", "table") VALUES (?, ?)`,
      [id, table],
    );
  }
}

/**
 * Backfill the whole id map from the tables themselves. ONE statement per
 * table (`INSERT … SELECT`), not one per row — the migration runs over an HTTP
 * driver, so a per-row backfill of a few thousand ids would blow the action
 * time limit. Idempotent: safe to re-run after every migration pass.
 */
export async function backfillIdMap(
  exec: SqlExecutor,
  tables: readonly string[],
): Promise<number> {
  await exec.execute(IDMAP_DDL);
  let recorded = 0;
  for (const table of tables) {
    await exec.execute(
      `INSERT OR REPLACE INTO ${q(IDMAP_TABLE)} ("id", "table") SELECT "_id", ? FROM ${q(table)}`,
      [table],
    );
    const res = await exec.execute(
      `SELECT COUNT(*) AS n FROM ${q(IDMAP_TABLE)} WHERE "table" = ?`,
      [table],
    );
    recorded += Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
  }
  return recorded;
}

export type BridgeOptions = {
  now?: () => number;
  /** Fallback for ids that carry no table (migrated rows). Default: none. */
  resolver?: TableResolver;
  /** Bump the change head after each write (default true). */
  autoBump?: boolean;
};

/**
 * A `ctx.db`-compatible facade. Id-based helpers (`get`/`patch`/`delete`/
 * `replace`) resolve the table from the id; table-based helpers
 * (`insert`/`query`) take the table like Convex does.
 */
export class BridgeDb {
  readonly data: TursoData;
  private readonly resolver: TableResolver | undefined;
  private readonly autoBump: boolean;
  /** Tables written since the last {@link takeTouched} — the change-head signal. */
  private readonly touched = new Set<string>();

  constructor(exec: SqlExecutor, opts: BridgeOptions = {}) {
    this.data = tursoData(exec, { now: opts.now });
    this.resolver = opts.resolver;
    this.autoBump = opts.autoBump ?? true;
  }

  /** Table encoded in the id, or via the resolver for migrated ids. */
  async resolveTable(id: string): Promise<string> {
    const direct = tableOfId(id);
    if (direct) return direct;
    if (this.resolver) {
      const resolved = await this.resolver(id);
      if (resolved) return resolved;
    }
    throw new Error(
      `Cannot resolve the table for id "${id}" — it carries no table prefix and no id-map ` +
        `entry. Pass a table explicitly or backfill the id map.`,
    );
  }

  async get<T = DataDoc>(id: string): Promise<T | null> {
    if (!id) return null;
    return this.data.get<T>(await this.resolveTable(id), id);
  }

  /** Tables written since the last flush — sorted, de-duplicated. */
  get touchedTables(): string[] {
    return [...this.touched].sort();
  }

  /** Consume the touched set (clears it) — call after publishing the heads. */
  takeTouched(): string[] {
    const out = this.touchedTables;
    this.touched.clear();
    return out;
  }

  /** Record the write and (optionally) bump the Turso change head. */
  private async markWritten(table: string): Promise<void> {
    this.touched.add(table);
    if (this.autoBump) await this.data.bump(table);
  }

  /** Insert a document and return its id — exactly like `ctx.db.insert`. */
  async insert(table: string, doc: ConvexDoc): Promise<string> {
    const stored = await this.data.insert(table, doc);
    await this.markWritten(table);
    return stored._id;
  }

  async patch(id: string, partial: ConvexDoc): Promise<void> {
    const table = await this.resolveTable(id);
    await this.data.patch(table, id, partial);
    await this.markWritten(table);
  }

  async replace(id: string, doc: ConvexDoc): Promise<void> {
    const table = await this.resolveTable(id);
    await this.data.replace(table, id, doc);
    await this.markWritten(table);
  }

  async delete(id: string): Promise<void> {
    const table = await this.resolveTable(id);
    await this.data.delete(table, id);
    await this.markWritten(table);
  }

  query<T = DataDoc>(table: string): QuerySpec<T> {
    return this.data.query<T>(table);
  }

  bump(table: string) {
    return this.data.bump(table);
  }

  get stats() {
    return this.data.stats;
  }
}

export function bridgedb(exec: SqlExecutor, opts: BridgeOptions = {}): BridgeDb {
  return new BridgeDb(exec, opts);
}
