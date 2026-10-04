/**
 * Convex → Turso (libSQL/SQLite) migration core.
 *
 * Pure and driver-agnostic: every function here takes a {@link SqlExecutor},
 * so the exact same import path runs against a local `node:sqlite` database
 * (used by the unit tests as an offline dry run) and against Turso's HTTP
 * client in src/convex/tursoMigrate.ts. Nothing in this file imports Convex,
 * Turso or node:sqlite.
 *
 * Fidelity rules:
 *  - `json` columns are JSON-encoded, so arrays/objects survive verbatim.
 *  - `int` columns hold booleans as 0/1 and decode back to true/false.
 *  - A field absent from the schema spec is still preserved in `_json` so a
 *    later schema addition cannot silently drop data on the next run.
 *  - `_id` is the Convex document id (TEXT PRIMARY KEY) and `_ts` the
 *    `_creationTime`, so ids stay stable across the migration.
 */

import {
  MIGRATION_INDEXES,
  MIGRATION_TABLES,
  type SqlKind,
} from "./turso-schema.generated";

export type { SqlKind };

/** Bumped whenever the DDL below changes in a way that needs a re-run. */
export const MIGRATION_VERSION = 1;

export const META_TABLE = "_migration_meta";
export const RUNS_TABLE = "_migration_runs";

/** Minimal SQL surface both `node:sqlite` and `@libsql/client` provide. */
export interface SqlExecutor {
  execute(sql: string, args?: unknown[]): Promise<{ rows: unknown[] }>;
  /** Optional: run a group of statements atomically. */
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Optional: send many statements in ONE round trip. A real migration is
   * thousands of rows, and one HTTP request per row over libSQL is far too
   * slow (and risks the Convex action timeout), so drivers that can batch
   * (libSQL) do.
   */
  executeBatch?(statements: { sql: string; args: unknown[] }[]): Promise<void>;
}

/** Rows per batched round trip. */
export const BATCH_SIZE = 50;

export type ConvexDoc = Record<string, unknown>;

/** Every Convex table's rows, keyed by table name. */
export type Dump = Record<string, ConvexDoc[]>;

const SQL_TYPE: Record<SqlKind, string> = {
  text: "TEXT",
  real: "REAL",
  int: "INTEGER",
  json: "TEXT",
};

/** Identifiers are only ever schema-derived, but quote them anyway. */
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ===== DDL ================================================================

/** CREATE TABLE + CREATE INDEX statements for one Convex table. */
export function migrationTableSql(table: string): string[] {
  const columns = MIGRATION_TABLES[table];
  if (!columns) throw new Error(`Table "${table}" is not in the migration spec`);
  const parts = [
    `${q("_id")} TEXT PRIMARY KEY`,
    `${q("_ts")} REAL`,
    `${q("_json")} TEXT`,
  ];
  for (const [name, kind] of Object.entries(columns)) {
    parts.push(`${q(name)} ${SQL_TYPE[kind]}`);
  }
  const out = [
    `CREATE TABLE IF NOT EXISTS ${q(table)} (\n  ${parts.join(",\n  ")}\n)`,
  ];
  for (const ix of MIGRATION_INDEXES[table] ?? []) {
    out.push(
      `CREATE INDEX IF NOT EXISTS ${q(`ix_${table}_${ix.name}`)} ON ${q(table)} (${ix.columns
        .map(q)
        .join(", ")})`,
    );
  }
  return out;
}

/** Bookkeeping tables: one row of migration metadata, one row per run. */
export function migrationMetaSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${q(META_TABLE)} (
  ${q("key")} TEXT PRIMARY KEY,
  ${q("value")} TEXT
)`,
    `CREATE TABLE IF NOT EXISTS ${q(RUNS_TABLE)} (
  ${q("id")} INTEGER PRIMARY KEY AUTOINCREMENT,
  ${q("startedAt")} REAL NOT NULL,
  ${q("finishedAt")} REAL,
  ${q("version")} INTEGER NOT NULL,
  ${q("source")} TEXT NOT NULL,
  ${q("mode")} TEXT NOT NULL,
  ${q("rowsWritten")} INTEGER NOT NULL DEFAULT 0,
  ${q("ok")} INTEGER,
  ${q("error")} TEXT
)`,
  ];
}

/** Every statement needed to prepare a target database. */
export function migrationSchemaSql(tables: readonly string[] = Object.keys(MIGRATION_TABLES)): string[] {
  return [...migrationMetaSql(), ...tables.flatMap(migrationTableSql)];
}

// ===== Row encoding ========================================================

export function encodeValue(kind: SqlKind, value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  switch (kind) {
    case "int":
      return value ? 1 : 0;
    case "real":
      return typeof value === "number" ? value : Number(value);
    case "text":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "json":
      return JSON.stringify(value);
  }
}

export function decodeValue(kind: SqlKind, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  switch (kind) {
    case "int":
      return Boolean(value);
    case "real":
      return Number(value);
    case "text":
      return typeof value === "string" ? value : String(value);
    case "json": {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
  }
}

/**
 * Turns a Convex document into column values. Fields the spec knows about get
 * their typed column; anything else survives inside `_json`, so nothing is
 * lost even if the spec is stale.
 */
export function encodeRow(doc: ConvexDoc, columns: Record<string, SqlKind>): Record<string, unknown> {
  const known = new Set(Object.keys(columns));
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id" || key === "_creationTime" || key === "_table") continue;
    if (known.has(key)) continue;
    if (value !== undefined) extra[key] = value;
  }

  const row: Record<string, unknown> = {
    _id: doc._id,
    _ts: typeof doc._creationTime === "number" ? doc._creationTime : null,
    _json: Object.keys(extra).length ? JSON.stringify(extra) : null,
  };
  for (const [name, kind] of Object.entries(columns)) {
    row[name] = encodeValue(kind, doc[name]);
  }
  return row;
}

/** The inverse of encodeRow — used by the verification report. */
export function decodeRow(
  row: Record<string, unknown>,
  columns: Record<string, SqlKind>,
): ConvexDoc {
  const out: ConvexDoc = {};
  if (row._id != null) out._id = String(row._id);
  if (typeof row._ts === "number") out._creationTime = row._ts;
  if (typeof row._json === "string") {
    try {
      Object.assign(out, JSON.parse(row._json) as ConvexDoc);
    } catch {
      /* keep going: a bad blob must not hide the columns */
    }
  }
  for (const [name, kind] of Object.entries(columns)) {
    const decoded = decodeValue(kind, row[name]);
    if (decoded !== undefined) out[name] = decoded;
  }
  return out;
}

/** `INSERT OR REPLACE` makes a re-run idempotent instead of duplicating. */
export function insertSql(table: string): { sql: string; columns: string[] } {
  const columns = Object.keys(MIGRATION_TABLES[table] ?? {});
  const names = ["_id", "_ts", "_json", ...columns];
  return {
    sql: `INSERT OR REPLACE INTO ${q(table)} (${names
      .map(q)
      .join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    columns: names,
  };
}

// ===== Checksums ===========================================================

/** FNV-1a over a canonical JSON encoding — stable across runs and platforms. */
export function checksum(value: unknown): string {
  const s = typeof value === "string" ? value : stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** JSON.stringify with sorted keys, so key order can't change a checksum. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// ===== The driver ==========================================================

export type TableReport = {
  table: string;
  expected: number;
  written: number;
  skipped: boolean;
  error?: string;
};

export type MigrationReport = {
  ok: boolean;
  version: number;
  startedAt: number;
  finishedAt: number;
  mode: "replace" | "merge";
  source: string;
  tables: TableReport[];
  totals: { tables: number; expected: number; written: number; failed: number };
};

export type ImportOptions = {
  /** replace = wipe each target table first (a true migration);
   *  merge  = upsert rows, keep whatever is already there (safe re-runs). */
  mode?: "replace" | "merge";
  source?: string;
  /** Only migrate these tables (default: all of them). */
  tables?: readonly string[];
  now?: number;
};

/**
 * Writes a whole dump into the target database. Tables are independent: one
 * failing table is recorded in the report and the rest still run, because a
 * partial migration you can inspect beats an all-or-nothing run you cannot.
 */
export async function importDump(
  exec: SqlExecutor,
  dump: Dump,
  opts: ImportOptions = {},
): Promise<MigrationReport> {
  const mode = opts.mode ?? "merge";
  const startedAt = opts.now ?? Date.now();
  const wanted = opts.tables ?? Object.keys(MIGRATION_TABLES);
  const tables: TableReport[] = [];

  for (const sql of migrationMetaSql()) await exec.execute(sql);

  for (const table of wanted) {
    const columns = MIGRATION_TABLES[table];
    const rows = dump[table];
    if (!columns) {
      tables.push({
        table,
        expected: 0,
        written: 0,
        skipped: true,
        error: "not in the migration spec",
      });
      continue;
    }
    if (rows === undefined) {
      tables.push({ table, expected: 0, written: 0, skipped: true });
      continue;
    }

    try {
      for (const sql of migrationTableSql(table)) await exec.execute(sql);
      if (mode === "replace") await exec.execute(`DELETE FROM ${q(table)}`);

      const stmt = insertSql(table);
      const write = async () => {
        let written = 0;
        const batch = exec.executeBatch
          ? async () => {
              let chunk: { sql: string; args: unknown[] }[] = [];
              for (const doc of rows) {
                if (doc?._id === undefined || doc?._id === null) continue;
                const values = encodeRow(doc, columns);
                chunk.push({
                  sql: stmt.sql,
                  args: stmt.columns.map((c) => values[c] ?? null),
                });
                if (chunk.length >= BATCH_SIZE) {
                  await exec.executeBatch!(chunk);
                  written += chunk.length;
                  chunk = [];
                }
              }
              if (chunk.length) {
                await exec.executeBatch!(chunk);
                written += chunk.length;
              }
            }
          : async () => {
              for (const doc of rows) {
                if (doc?._id === undefined || doc?._id === null) continue;
                const values = encodeRow(doc, columns);
                await exec.execute(stmt.sql, stmt.columns.map((c) => values[c] ?? null));
                written++;
              }
            };
        await batch();
        return written;
      };
      const written = exec.transaction ? await exec.transaction(write) : await write();
      tables.push({ table, expected: rows.length, written, skipped: false });
    } catch (e) {
      tables.push({
        table,
        expected: rows.length,
        written: 0,
        skipped: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await exec.execute(
    `INSERT OR REPLACE INTO ${q(META_TABLE)} (${q("key")}, ${q("value")}) VALUES (?, ?)`,
    ["version", String(MIGRATION_VERSION)],
  );

  const totals = tables.reduce(
    (acc, t) => ({
      tables: acc.tables + (t.skipped ? 0 : 1),
      expected: acc.expected + t.expected,
      written: acc.written + t.written,
      failed: acc.failed + (t.error ? 1 : 0),
    }),
    { tables: 0, expected: 0, written: 0, failed: 0 },
  );

  const finishedAt = Date.now();
  await exec.execute(
    `INSERT INTO ${q(RUNS_TABLE)} (${q("startedAt")}, ${q("finishedAt")}, ${q("version")}, ${q("source")}, ${q("mode")}, ${q("rowsWritten")}, ${q("ok")})
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      startedAt,
      finishedAt,
      MIGRATION_VERSION,
      opts.source ?? "unknown",
      mode,
      totals.written,
      totals.failed === 0 ? 1 : 0,
    ],
  );

  return {
    ok: totals.failed === 0,
    version: MIGRATION_VERSION,
    startedAt,
    finishedAt,
    mode,
    source: opts.source ?? "unknown",
    tables,
    totals,
  };
}

export type VerifyReport = {
  ok: boolean;
  checkedAt: number;
  tables: {
    table: string;
    expected: number;
    actual: number;
    matching: boolean;
    missingIds: string[];
  }[];
  totals: { tables: number; mismatched: number; rowsExpected: number; rowsFound: number };
};

/**
 * Compares a dump with what is actually in the target: row count plus the
 * presence of every source id. Does not compare checksums, because the stored
 * representation is intentionally normalised (booleans → 0/1, JSON strings).
 */
export async function verifyDump(
  exec: SqlExecutor,
  dump: Dump,
  tables: readonly string[] = Object.keys(MIGRATION_TABLES),
): Promise<VerifyReport> {
  const out: VerifyReport["tables"] = [];

  for (const table of tables) {
    const rows = dump[table];
    if (rows === undefined || !MIGRATION_TABLES[table]) continue;
    try {
      const res = await exec.execute(`SELECT COUNT(*) AS n FROM ${q(table)}`);
      const actual = Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0);
      const ids = rows
        .map((d) => (d?._id === undefined ? null : String(d._id)))
        .filter((x): x is string => x !== null);
      const missing: string[] = [];
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const found = await exec.execute(
          `SELECT ${q("_id")} FROM ${q(table)} WHERE ${q("_id")} IN (${placeholders})`,
          ids,
        );
        const present = new Set(
          found.rows.map((r) => String((r as { _id?: unknown })._id)),
        );
        for (const id of ids) if (!present.has(id)) missing.push(id);
      }
      out.push({
        table,
        expected: rows.length,
        actual,
        matching: actual === rows.length && missing.length === 0,
        missingIds: missing.slice(0, 10),
      });
    } catch (e) {
      out.push({
        table,
        expected: rows.length,
        actual: -1,
        matching: false,
        missingIds: [e instanceof Error ? e.message : String(e)].slice(0, 10),
      });
    }
  }

  const totals = out.reduce(
    (acc, t) => ({
      tables: acc.tables + 1,
      mismatched: acc.mismatched + (t.matching ? 0 : 1),
      rowsExpected: acc.rowsExpected + t.expected,
      rowsFound: acc.rowsFound + Math.max(0, t.actual),
    }),
    { tables: 0, mismatched: 0, rowsExpected: 0, rowsFound: 0 },
  );

  return { ok: totals.mismatched === 0, checkedAt: Date.now(), tables: out, totals };
}