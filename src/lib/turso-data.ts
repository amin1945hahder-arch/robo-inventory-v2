/**
 * Turso data layer — a Convex `ctx.db`-compatible repository over the SAME
 * SqlExecutor abstraction the migration core uses (src/lib/turso-migrate.ts).
 *
 * WHY THIS FILE EXISTS
 *
 * The app is moving its READS and WRITES from the Convex database to Turso
 * (libSQL/SQLite at the edge) while Convex keeps handling everything else
 * (auth, compute, scheduling, notifications). Convex's platform rule makes
 * the shape of that move non-negotiable: queries and mutations may ONLY touch
 * the Convex database (docs.convex.dev: "query and mutation functions in
 * Convex are not allowed to make fetch calls"), so every converted data
 * function becomes an action, and actions need a Turso driver with the same
 * ergonomics as `ctx.db` — which is what this module provides:
 *
 *   const db = tursoData(executor);
 *   const part  = await db.get("parts", id);
 *   await db.patch("parts", id, { note: "checked" });
 *   const low   = await db.query("parts")
 *     .withIndex("by_group", (q) => q.eq(q.field("groupId"), gid))
 *     .filter((q) => q.neq(q.field("status"), "broken"))
 *     .order("desc")
 *     .take(50);
 *
 * DESIGN RULES (all testable offline against node:sqlite — no network)
 *
 *  - Storage fidelity: rows are encoded/decoded with the SAME
 *    encodeRow/decodeRow rules as the Convex → Turso migration, so a migrated
 *    database and a freshly written one are indistinguishable (booleans →
 *    0/1, arrays/objects → JSON columns, unknown fields survive in `_json`).
 *  - SQL is compiled, not fetched-then-filtered: `withIndex`/`filter`
 *    callbacks build a tiny predicate AST that is pushed down into WHERE, so
 *    SQLite's index does the work and the rows that leave the database are
 *    only the rows the caller asked for. That is the whole point of the
 *    free-plan budget: Turso bills ROW READS (free plan: 500M reads /
 *    10M writes / 5GB per month), so every scan avoided is budget kept.
 *  - Row accounting: every statement records `stats.rowsRead` /
 *    `stats.rowsWritten` so tests (and future telemetry) can prove a query
 *    stayed bounded instead of trusting it.
 *  - Change heads: `bumpChange`/`readChanges` implement the "only fetch new
 *    stuff" gate — a write bumps its table's head, clients learn about it
 *    through the cheap reactive channel (Convex `sync.syncHead` pattern the
 *    app already uses) and only then pull from Turso. Reads become a
 *    function of CHANGES, not of page views.
 */

import {
  MIGRATION_INDEXES,
  MIGRATION_TABLES,
  type SqlKind,
} from "./turso-schema.generated";
import {
  appTables,
  decodeRow,
  encodeRow,
  encodeValue,
  migrationTableSql,
  type ConvexDoc,
  type SqlExecutor,
} from "./turso-migrate";

export type { SqlExecutor };

/** A stored document: Convex shape plus the required `_id`. */
export type DataDoc = ConvexDoc & { _id: string };

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

const columnsOf = (table: string): Record<string, SqlKind> => {
  const columns = MIGRATION_TABLES[table];
  if (!columns) throw new Error(`Table "${table}" is not in the data spec`);
  return columns;
};

// ===== IDs ================================================================
//
// Convex ids are opaque strings. Turso-written rows get a table-prefixed id
// (`parts.7xK2…`) so helpers that receive an id WITHOUT table context (the
// join caches in parts.ts, container chains across groups/closets) can still
// resolve the table by prefix — the migration keeps original Convex ids for
// existing rows, so callers that handle migrated rows must pass the table
// explicitly (conversion rule documented in TURSO_CUTOVER.md).

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomId(): string {
  let out = "";
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(bytes);
  for (let i = 0; i < bytes.length; i++) out += B62[bytes[i] % B62.length];
  // Deterministic fallback where crypto is unavailable (never in Node ≥18).
  return out || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Table encoded in a Turso-written id, or null for legacy Convex ids. */
export function tableOfId(id: string): string | null {
  const dot = id.indexOf(".");
  if (dot <= 0) return null;
  const table = id.slice(0, dot);
  return table in MIGRATION_TABLES ? table : null;
}

// ===== Predicate AST ======================================================

export type Predicate =
  | { kind: "cmp"; field: string; op: "=" | "<>" | ">" | ">=" | "<" | "<="; value: unknown }
  | { kind: "in"; field: string; values: unknown[] }
  | { kind: "and" | "or"; parts: Predicate[] };

/**
 * Chainable AND-composition — mirrors Convex's fluent range style:
 *
 *   .withIndex("by_table_deletedAt", (q) => q.eq("table", t).gt("deletedAt", since))
 *   .filter((q) => q.eq("status", "active").neq("note", ""))
 *
 * AND the field-ref predicate style:
 *
 *   (q) => q.eq(q.field("status"), "active")
 *
 * Both are used heavily in this codebase (≈185 fluent + ≈81 field-ref call
 * sites), so both must compile to the same predicate AST.
 */
export type FieldRef = { field: string };
export type PredicateLike = Predicate | Chain;

export function toPredicate(p: PredicateLike): Predicate {
  return p instanceof Chain ? p.toPredicate() : p;
}

export class Chain {
  private readonly preds: Predicate[];
  constructor(pred: Predicate) {
    this.preds = [pred];
  }
  private push(pred: Predicate): this {
    // `readonly` guards the reference, not the contents: chained calls
    // append to ONE AND-list, mirroring Convex's builder semantics.
    this.preds.push(pred);
    return this;
  }
  eq(ref: FieldRef | string, value: unknown): this {
    return this.push(cmp(ref, "=", value));
  }
  neq(ref: FieldRef | string, value: unknown): this {
    return this.push(cmp(ref, "<>", value));
  }
  gt(ref: FieldRef | string, value: unknown): this {
    return this.push(cmp(ref, ">", value));
  }
  gte(ref: FieldRef | string, value: unknown): this {
    return this.push(cmp(ref, ">=", value));
  }
  lt(ref: FieldRef | string, value: unknown): this {
    return this.push(cmp(ref, "<", value));
  }
  lte(ref: FieldRef | string, value: unknown): this {
    return this.push(cmp(ref, "<=", value));
  }
  in(ref: FieldRef | string, values: unknown[]): this {
    const field = typeof ref === "string" ? ref : ref.field;
    return this.push({ kind: "in", field, values });
  }
  toPredicate(): Predicate {
    return this.preds.length === 1 ? this.preds[0] : { kind: "and", parts: this.preds };
  }
}

function cmp(
  ref: FieldRef | string,
  op: "=" | "<>" | ">" | ">=" | "<" | "<=",
  value: unknown,
): Predicate {
  const field = typeof ref === "string" ? ref : ref.field;
  return { kind: "cmp", field, op, value };
}

/** Convex-style `q` object handed to withIndex/filter callbacks. */
export class FilterBuilder {
  field(name: string): FieldRef {
    return { field: name };
  }
  eq(ref: FieldRef | string, value: unknown): Chain {
    return new Chain(cmp(ref, "=", value));
  }
  neq(ref: FieldRef | string, value: unknown): Chain {
    return new Chain(cmp(ref, "<>", value));
  }
  gt(ref: FieldRef | string, value: unknown): Chain {
    return new Chain(cmp(ref, ">", value));
  }
  gte(ref: FieldRef | string, value: unknown): Chain {
    return new Chain(cmp(ref, ">=", value));
  }
  lt(ref: FieldRef | string, value: unknown): Chain {
    return new Chain(cmp(ref, "<", value));
  }
  lte(ref: FieldRef | string, value: unknown): Chain {
    return new Chain(cmp(ref, "<=", value));
  }
  in(ref: FieldRef | string, values: unknown[]): Chain {
    const field = typeof ref === "string" ? ref : ref.field;
    return new Chain({ kind: "in", field, values });
  }
  and(...parts: PredicateLike[]): Predicate {
    return { kind: "and", parts: parts.map(toPredicate) };
  }
  or(...parts: PredicateLike[]): Predicate {
    return { kind: "or", parts: parts.map(toPredicate) };
  }
}

/**
 * Compile a predicate into a WHERE fragment.
 *
 * Convex semantics preserved:
 *  - `eq` against a missing (NULL) column never matches (NULL = x is NULL).
 *  - `neq` DOES match rows where the field is absent — in Convex, a document
 *    without the field is `neq` any value. SQLite would drop NULL rows, so
 *    `neq` is compiled as `(col IS NULL OR col <> ?)`.
 *  - values are encoded through the column's kind (booleans → 0/1, json →
 *    JSON text) so comparisons match how the rows were written.
 */
export function compilePredicate(
  table: string,
  pred: Predicate,
): { sql: string; args: unknown[] } {
  const columns = columnsOf(table);
  const args: unknown[] = [];

  const column = (field: string): string => {
    if (field in columns) return q(field);
    // Unknown fields live inside `_json`; compare against its JSON text as a
    // last resort — rare path, correctness over speed.
    if (field === "_id" || field === "_creationTime") return q(field === "_id" ? "_id" : "_ts");
    return q(field); // will simply match nothing if the column does not exist
  };

  const walk = (p: Predicate): string => {
    switch (p.kind) {
      case "and":
        return p.parts.length ? `(${p.parts.map(walk).join(" AND ")})` : "1=1";
      case "or":
        return p.parts.length ? `(${p.parts.map(walk).join(" OR ")})` : "1=0";
      case "in": {
        const kind = columns[p.field] ?? "text";
        if (p.values.length === 0) return "1=0";
        const holes = p.values.map((v) => {
          args.push(encodeValue(kind, v));
          return "?";
        });
        return `${column(p.field)} IN (${holes.join(", ")})`;
      }
      case "cmp": {
        const kind = columns[p.field];
        // Convex treats a missing field as undefined, so `eq(field, undefined)`
        // must match absent columns. Turso stores those as NULL, and `col =
        // NULL` never matches in SQL — so compile the undefined comparisons to
        // the IS (NOT) NULL forms instead.
        if (p.value === undefined) {
          if (p.op === "=") return `${column(p.field)} IS NULL`;
          if (p.op === "<>") return `${column(p.field)} IS NOT NULL`;
        }
        if (p.op === "<>") {
          if (kind === undefined && !(p.field in columns)) {
            // Unknown column: JSON-text scan never matches — keep it honest.
            args.push(encodeValue("json", p.value));
            return `${column(p.field)} IS NOT NULL AND ${column(p.field)} <> ?`;
          }
          args.push(encodeValue(kind, p.value));
          return `(${column(p.field)} IS NULL OR ${column(p.field)} <> ?)`;
        }
        args.push(encodeValue(kind ?? "text", p.value));
        return `${column(p.field)} ${p.op} ?`;
      }
    }
  };

  return { sql: walk(pred), args };
}

// ===== Query builder ======================================================

export type IndexRange = (q: FilterBuilder) => PredicateLike;
export type FilterFn = (q: FilterBuilder) => PredicateLike;

/**
 * Type parameter T lets a converted call site keep its Convex schema type:
 * `db.query<Doc<"parts">>("parts")` returns `Doc<"parts">[]`, exactly like
 * `ctx.db.query("parts")`. The decoded row is structurally the Convex document
 * (`_id` is a plain string, which is assignable to the branded `Id`), so the
 * only difference is the id branding — hence the cast, done once, here.
 */
export class QuerySpec<T = DataDoc> {
  private indexName: string | null = null;
  private indexRange: Predicate | null = null;
  private extra: Predicate | null = null;
  private direction: "asc" | "desc" = "asc";
  // Explicit fields (not constructor parameter properties) because the
  // project compiles with `erasableSyntaxOnly`.
  private readonly db: TursoData;
  private readonly table: string;

  constructor(db: TursoData, table: string) {
    this.db = db;
    this.table = table;
  }

  /**
   * Select an index. The range is OPTIONAL, matching Convex: a bare
   * `withIndex("by_name")` walks the whole index (the pattern used for small
   * alphabetical listings like `listClosets`).
   */
  withIndex(name: string, range?: IndexRange): this {
    this.indexName = name;
    this.indexRange = range ? toPredicate(range(new FilterBuilder())) : null;
    return this;
  }

  filter(fn: FilterFn): this {
    const pred = toPredicate(fn(new FilterBuilder()));
    this.extra = this.extra ? { kind: "and", parts: [this.extra, pred] } : pred;
    return this;
  }

  order(direction: "asc" | "desc"): this {
    this.direction = direction;
    return this;
  }

  private plan(): { where: string; args: unknown[]; orderBy: string } {
    const parts: Predicate[] = [];
    if (this.indexRange) parts.push(this.indexRange);
    if (this.extra) parts.push(this.extra);

    const clauses: string[] = [];
    const args: unknown[] = [];
    for (const p of parts) {
      const compiled = compilePredicate(this.table, p);
      clauses.push(compiled.sql);
      args.push(...compiled.args);
    }

    // Convex returns rows in INDEX order; without an index the insertion
    // order (_creationTime) is the closest faithful equivalent.
    let orderBy = `${q("_ts")} ${this.direction.toUpperCase()}`;
    if (this.indexName) {
      const ix = (MIGRATION_INDEXES[this.table] ?? []).find((i) => i.name === this.indexName);
      if (!ix) throw new Error(`Index "${this.indexName}" not found on "${this.table}"`);
      orderBy = `${ix.columns.map(q).join(", ")} ${this.direction.toUpperCase()}`;
    }

    return {
      where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
      args,
      orderBy,
    };
  }

  /** SQL text + args for this query (exported for EXPLAIN/budget tests). */
  toSql(limit?: number): { sql: string; args: unknown[] } {
    const { where, args, orderBy } = this.plan();
    let sql = `SELECT * FROM ${q(this.table)}${where} ORDER BY ${orderBy}`;
    if (limit !== undefined) sql += ` LIMIT ${Number(limit)}`;
    return { sql, args };
  }

  async exec(limit?: number): Promise<T[]> {
    const { sql, args } = this.toSql(limit);
    const res = await this.db.execute(sql, args);
    return res.rows.map((row) =>
      this.db.decode(this.table, row as Record<string, unknown>),
    ) as T[];
  }

  collect(): Promise<T[]> {
    return this.exec();
  }
  take(n: number): Promise<T[]> {
    return this.exec(Math.max(0, Math.trunc(n)));
  }
  first(): Promise<T | null> {
    return this.exec(1).then((rows) => rows[0] ?? null);
  }
  async unique(): Promise<T | null> {
    const rows = await this.exec(2);
    if (rows.length > 1) {
      throw new Error(`Expected unique value in "${this.table}", found ${rows.length}`);
    }
    return rows[0] ?? null;
  }
}

// ===== Change heads (the "only fetch what changed" gate) ==================

export const CHANGES_TABLE = "_changes";

export const CHANGES_DDL = `CREATE TABLE IF NOT EXISTS ${q(CHANGES_TABLE)} (
  ${q("table")} TEXT PRIMARY KEY,
  ${q("at")} REAL NOT NULL,
  ${q("seq")} INTEGER NOT NULL
)`;

export type ChangeHead = { table: string; at: number; seq: number };

/**
 * Record that `table` just changed. One tiny write per mutation — the client
 * spends one cheap head read to learn "something changed" and only then pays
 * for a data pull, instead of re-reading the database on every page view.
 */
export async function bumpChange(
  exec: SqlExecutor,
  table: string,
  now = Date.now(),
): Promise<ChangeHead> {
  await exec.execute(CHANGES_DDL);
  await exec.execute(
    `INSERT INTO ${q(CHANGES_TABLE)} (${q("table")}, ${q("at")}, ${q("seq")}) VALUES (?, ?, 0)
     ON CONFLICT(${q("table")}) DO UPDATE SET ${q("at")} = excluded.${q("at")}, ${q(
       "seq",
     )} = ${q(CHANGES_TABLE)}.${q("seq")} + 1`,
    [table, now],
  );
  // Read back the stored row so the returned head always equals the state
  // other readers will see (first bump → seq 0, each later bump → +1).
  const res = await exec.execute(
    `SELECT ${q("table")}, ${q("at")}, ${q("seq")} FROM ${q(CHANGES_TABLE)} WHERE ${q(
      "table",
    )} = ?`,
    [table],
  );
  const row = res.rows[0] as ChangeHead | undefined;
  return row ? { table: row.table, at: Number(row.at), seq: Number(row.seq) } : { table, at: now, seq: 0 };
}

/** Current head per table (empty map when nothing ever changed). */
export async function readChanges(exec: SqlExecutor): Promise<Record<string, ChangeHead>> {
  try {
    const res = await exec.execute(
      `SELECT ${q("table")}, ${q("at")}, ${q("seq")} FROM ${q(CHANGES_TABLE)}`,
    );
    const out: Record<string, ChangeHead> = {};
    for (const row of res.rows as ChangeHead[]) {
      out[row.table] = { table: row.table, at: Number(row.at), seq: Number(row.seq) };
    }
    return out;
  } catch {
    return {}; // head table not created yet — nothing changed
  }
}

/**
 * Pure gate: should the client refetch `table` given the heads it saw last
 * time versus the heads it just learned? This is the entire budget policy in
 * one function — no head movement means NO Turso data read at all.
 */
export function shouldRefetch(
  last: Record<string, ChangeHead>,
  next: Record<string, ChangeHead>,
): string[] {
  const tables = new Set([...Object.keys(last), ...Object.keys(next)]);
  const out: string[] = [];
  for (const table of tables) {
    const a = last[table];
    const b = next[table];
    if (!a && b) out.push(table);
    else if (a && b && (a.seq !== b.seq || a.at !== b.at)) out.push(table);
  }
  return out.sort();
}

// ===== The data layer =====================================================

export type DataStats = { statements: number; rowsRead: number; rowsWritten: number };

export class TursoData {
  readonly stats: DataStats = { statements: 0, rowsRead: 0, rowsWritten: 0 };
  private readonly now: () => number;
  // Explicit field instead of a constructor parameter property — the project
  // compiles with `erasableSyntaxOnly`.
  private readonly exec: SqlExecutor;

  constructor(exec: SqlExecutor, opts: { now?: () => number } = {}) {
    this.exec = exec;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Idempotent schema for the given tables (default: every DATA table).
   *
   * The default is `appTables()`, not every key of the migration spec: the spec
   * also carries the Convex-only infrastructure tables (`tursoHeads`), and
   * creating those in Turso would cost rows on the free plan for a table nothing
   * ever reads. See CONVEX_ONLY_TABLES in ./turso-migrate.
   */
  async ensureSchema(tables: readonly string[] = appTables()): Promise<void> {
    for (const table of tables) {
      for (const sql of migrationTableSql(table)) await this.execute(sql);
    }
  }

  async execute(sql: string, args: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.stats.statements += 1;
    const res = await this.exec.execute(sql, args);
    if (/^\s*select/i.test(sql)) this.stats.rowsRead += res.rows.length;
    return res;
  }

  /** Decode one stored row back into a Convex-shaped document. */
  decode(table: string, row: Record<string, unknown>): DataDoc {
    return decodeRow(row, columnsOf(table)) as DataDoc;
  }

  async get<T = DataDoc>(table: string, id: string): Promise<T | null> {
    if (!id) return null;
    const res = await this.execute(`SELECT * FROM ${q(table)} WHERE ${q("_id")} = ?`, [id]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? (this.decode(table, row) as T) : null;
  }

  /**
   * Insert a document. `_id`/`_creationTime` are generated like Convex would
   * (unless already provided by a migration round-trip) and the returned doc
   * is the stored one — `const id = await db.insert("parts", doc)` mirrors
   * Convex exactly.
   */
  async insert(table: string, doc: ConvexDoc): Promise<DataDoc> {
    const columns = columnsOf(table);
    const _id =
      typeof doc._id === "string" && doc._id ? doc._id : `${table}.${randomId()}`;
    const _creationTime =
      typeof doc._creationTime === "number" ? doc._creationTime : this.now();
    const stored = { ...doc, _id, _creationTime };

    const names = ["_id", "_ts", "_json", ...Object.keys(columns)];
    const values = encodeRow(stored, columns);
    const args = names.map((c) => values[c] ?? null);
    await this.execute(
      `INSERT OR REPLACE INTO ${q(table)} (${names.map(q).join(", ")}) VALUES (${names
        .map(() => "?")
        .join(", ")})`,
      args,
    );
    this.stats.rowsWritten += 1;
    return stored as DataDoc;
  }

  /**
   * Merge-patch a document: provided fields overwrite, `undefined` removes
   * (decoded as an absent field, exactly like Convex), everything else —
   * including unknown `_json` fields — is preserved. The full row is
   * re-encoded so column + `_json` merge logic stays in ONE place.
   */
  async patch(table: string, id: string, partial: ConvexDoc): Promise<void> {
    const existing = await this.get(table, id);
    if (!existing) throw new Error(`No document in "${table}" with id "${id}"`);
    const merged: ConvexDoc = { ...existing };
    for (const [key, value] of Object.entries(partial)) {
      if (key === "_id" || key === "_creationTime") continue;
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    const columns = columnsOf(table);
    const names = ["_id", "_ts", "_json", ...Object.keys(columns)];
    const values = encodeRow(merged, columns);
    await this.execute(
      `UPDATE ${q(table)} SET ${names
        .filter((c) => c !== "_id")
        .map((c) => `${q(c)} = ?`)
        .join(", ")} WHERE ${q("_id")} = ?`,
      [...names.filter((c) => c !== "_id").map((c) => values[c] ?? null), id],
    );
    this.stats.rowsWritten += 1;
  }

  /** Delete a document. Missing ids are a no-op (idempotent deletes). */
  async delete(table: string, id: string): Promise<void> {
    const res = await this.execute(`DELETE FROM ${q(table)} WHERE ${q("_id")} = ?`, [id]);
    void res;
    this.stats.rowsWritten += 1;
  }

  /** Replace the whole document (Convex `db.replace` semantics). */
  async replace(table: string, id: string, doc: ConvexDoc): Promise<DataDoc> {
    const existing = await this.get(table, id);
    if (!existing) throw new Error(`No document in "${table}" with id "${id}"`);
    return this.insert(table, { ...doc, _id: id, _creationTime: existing._creationTime });
  }

  query<T = DataDoc>(table: string): QuerySpec<T> {
    columnsOf(table); // fail fast on unknown tables
    return new QuerySpec<T>(this, table);
  }

  /** Append/bump the change head — call after EVERY write. */
  bump(table: string): Promise<ChangeHead> {
    return bumpChange(this.exec, table, this.now());
  }

  changes(): Promise<Record<string, ChangeHead>> {
    return readChanges(this.exec);
  }
}

/** Factory mirroring `createClient` ergonomics: `const db = tursoData(exec)`. */
export function tursoData(exec: SqlExecutor, opts?: { now?: () => number }): TursoData {
  return new TursoData(exec, opts);
}
