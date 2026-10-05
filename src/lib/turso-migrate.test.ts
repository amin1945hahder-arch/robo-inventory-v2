// @vitest-environment node
// The dry run drives a REAL SQLite engine through node:sqlite, which the
// default jsdom environment cannot bundle.
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATCH_SIZE,
  CONVEX_ONLY_TABLES,
  MIGRATION_VERSION,
  RUNS_TABLE,
  appTables,
  checksum,
  decodeRow,
  encodeRow,
  encodeValue,
  importDump,
  insertSql,
  migrationSchemaSql,
  migrationTableSql,
  stableStringify,
  verifyDump,
  type Dump,
  type SqlExecutor,
} from "./turso-migrate";
import { MIGRATION_TABLES } from "./turso-schema.generated";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A real SQLite database in memory, driven through the same SqlExecutor the
 * Turso path uses. This is the offline dry run: it exercises the actual DDL,
 * the actual inserts and the actual verification, with no network.
 */
function sqliteExec(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sql: string, args: unknown[] = []) {
      const stmt = db.prepare(sql);
      if (SELECT.test(sql.trim())) {
        return { rows: stmt.all(...(args as never[])) as unknown[] };
      }
      stmt.run(...(args as never[]));
      return { rows: [] };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.exec("BEGIN");
      try {
        const out = await fn();
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
const SELECT = /^select/i;

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const SAMPLE: Dump = {
  users: [
    {
      _id: "u1",
      _creationTime: 1700,
      name: "Ali",
      email: "ali@club.test",
      role: "admin",
      profileApproved: true,
      isAnonymous: false,
      clubRoles: ["رئيس نادي الروبوت", "مدرب"],
      inventoryPerms: { edit: true, add: false, delete: false },
      updatedAt: 1800.5,
      // unknown field — must survive via _json
      futureField: { nested: [1, 2, 3] },
    },
    { _id: "u2", _creationTime: 1701, name: "Sara" },
  ],
  rentals: [
    {
      _id: "r1",
      _creationTime: 1702,
      userId: "u1",
      partId: "p1",
      status: "active",
      requestedAt: 1702,
    },
  ],
};

describe("value encoding", () => {
  it("stores booleans as 0/1 and numbers as REAL", () => {
    expect(encodeValue("int", true)).toBe(1);
    expect(encodeValue("int", false)).toBe(0);
    expect(encodeValue("int", undefined)).toBeNull();
    expect(encodeValue("real", 12.5)).toBe(12.5);
    expect(encodeValue("real", 3)).toBe(3);
    expect(encodeValue("text", "hi")).toBe("hi");
  });

  it("JSON-encodes json columns, including non-ASCII", () => {
    expect(encodeValue("json", ["عضو إداري"])).toBe('["عضو إداري"]');
    expect(encodeValue("json", null)).toBeNull();
  });
});

describe("row encoding", () => {
  const columns = { name: "text" as const, role: "text" as const, extra: "json" as const };

  it("keeps unknown fields in _json so nothing is silently dropped", () => {
    const row = encodeRow(
      { _id: "x", _creationTime: 5, name: "A", somethingNew: 42 },
      columns,
    );
    expect(row._id).toBe("x");
    expect(row._ts).toBe(5);
    expect(JSON.parse(row._json as string)).toEqual({ somethingNew: 42 });
  });

  it("omits _json entirely when there are no unknown fields", () => {
    expect(encodeRow({ _id: "x", name: "A" }, columns)._json).toBeNull();
  });

  it("round-trips through decodeRow", () => {
    const doc = {
      _id: "x",
      _creationTime: 5,
      name: "A",
      role: "admin",
      extra: [1, 2],
      futureField: "keep",
    };
    const row = encodeRow(doc, columns);
    expect(decodeRow(row, columns)).toEqual(doc);
  });
});

describe("checksums", () => {
  it("is stable across key order", () => {
    expect(checksum({ a: 1, b: 2 })).toBe(checksum({ b: 2, a: 1 }));
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("changes when a value changes", () => {
    expect(checksum({ a: 1 })).not.toBe(checksum({ a: 2 }));
  });
});

describe("ddl", () => {
  it("creates one table per Convex table plus its indexes", () => {
    const sql = migrationTableSql("rentals").join("\n");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "rentals"');
    expect(sql).toContain('"requestedAt" REAL');
    expect(sql).toContain('"_id" TEXT PRIMARY KEY');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "ix_rentals_by_user"');
  });

  it("refuses a table that is not in the spec", () => {
    expect(() => migrationTableSql("nope")).toThrow(/not in the migration spec/);
  });

  it("targets _id, _ts, _json plus every column", () => {
    const { columns } = insertSql("users");
    expect(columns[0]).toBe("_id");
    expect(columns.slice(1, 3)).toEqual(["_ts", "_json"]);
    expect(columns).toEqual(expect.arrayContaining(["email", "role"]));
  });
});

describe("offline dry run against real SQLite", () => {
  it("imports every row and verifies clean", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);

    const report = await importDump(exec, SAMPLE, { mode: "replace", source: "unit" });
    expect(report.ok).toBe(true);
    expect(report.version).toBe(MIGRATION_VERSION);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.written).toBe(3); // 2 users + 1 rental

    const users = report.tables.find((t) => t.table === "users")!;
    expect(users).toMatchObject({ expected: 2, written: 2, skipped: false });

    const verify = await verifyDump(exec, SAMPLE);
    expect(verify.ok).toBe(true);
    expect(verify.totals.mismatched).toBe(0);
    expect(verify.totals.rowsFound).toBe(3);
    db.close();
  });

  it("stores values with their real SQLite types", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    await importDump(exec, SAMPLE, { mode: "replace" });

    const row = db.prepare('SELECT * FROM "users" WHERE _id = ?').get("u1") as Record<
      string,
      unknown
    >;
    expect(row.name).toBe("Ali");
    expect(row.profileApproved).toBe(1); // INTEGER
    expect(row.clubRoles).toBe('["رئيس نادي الروبوت","مدرب"]'); // JSON text
    expect(row.updatedAt).toBe(1800.5); // REAL
    expect(JSON.parse(row._json as string)).toEqual({ futureField: { nested: [1, 2, 3] } });
    db.close();
  });

  it("is idempotent: re-running merge does not duplicate rows", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    await importDump(exec, SAMPLE, { mode: "replace" });
    await importDump(exec, SAMPLE, { mode: "merge" });
    await importDump(exec, SAMPLE, { mode: "merge" });

    const n = db.prepare('SELECT COUNT(*) AS n FROM "users"').get() as { n: number };
    expect(n.n).toBe(2);
    db.close();
  });

  it("replace mode clears rows that vanished from the source", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    await importDump(exec, SAMPLE, { mode: "replace" });
    await importDump(exec, { ...SAMPLE, users: [SAMPLE.users![0]] }, { mode: "replace" });

    const n = db.prepare('SELECT COUNT(*) AS n FROM "users"').get() as { n: number };
    expect(n.n).toBe(1);
    db.close();
  });

  it("verification catches a truncated target", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    await importDump(exec, SAMPLE, { mode: "replace" });
    db.prepare('DELETE FROM "users" WHERE _id = ?').run("u2");

    const verify = await verifyDump(exec, SAMPLE);
    expect(verify.ok).toBe(false);
    const users = verify.tables.find((t) => t.table === "users")!;
    expect(users.matching).toBe(false);
    expect(users.actual).toBe(1);
    expect(users.missingIds).toContain("u2");
    db.close();
  });

  it("records every run for audit", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    await importDump(exec, SAMPLE, { mode: "replace", source: "dev-dry-run" });

    const runs = db
      .prepare(`SELECT source, mode, rowsWritten, ok FROM "${RUNS_TABLE}"`)
      .all() as Record<string, unknown>[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ source: "dev-dry-run", mode: "replace", rowsWritten: 3, ok: 1 });
    db.close();
  });

  it("can migrate a subset of tables", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    const report = await importDump(exec, SAMPLE, { tables: ["rentals"] });

    expect(report.tables).toHaveLength(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("rentals");
    expect(tables.map((t) => t.name)).not.toContain("users");
    db.close();
  });

  it("batches writes when the driver supports it, with identical results", async () => {
    const db = freshDb();
    const base = sqliteExec(db);
    let batches = 0;
    let statements = 0;
    const exec: SqlExecutor = {
      execute: base.execute,
      transaction: base.transaction,
      async executeBatch(list) {
        batches++;
        statements += list.length;
        for (const s of list) await base.execute(s.sql, s.args);
      },
    };

    const many: Dump = {
      users: Array.from({ length: 125 }, (_, i) => ({
        _id: `u${i}`,
        _creationTime: 1000 + i,
        name: `Member ${i}`,
        profileApproved: i % 2 === 0,
      })),
    };

    const report = await importDump(exec, many, { mode: "replace" });
    expect(report.totals.written).toBe(125);
    // 125 rows at BATCH_SIZE 50 => 3 round trips, not 125.
    expect(batches).toBe(Math.ceil(125 / BATCH_SIZE));
    expect(statements).toBe(125);

    const n = db.prepare('SELECT COUNT(*) AS n FROM "users"').get() as { n: number };
    expect(n.n).toBe(125);
    const booleans = db
      .prepare('SELECT profileApproved FROM "users" WHERE _id = ?')
      .get("u1") as { profileApproved: number };
    expect(booleans.profileApproved).toBe(0);
    expect((await verifyDump(exec, many)).ok).toBe(true);
    db.close();
  });

  it("an empty dump is a valid, clean run", async () => {
    const db = freshDb();
    const exec = sqliteExec(db);
    const report = await importDump(exec, {}, { mode: "replace" });
    expect(report.ok).toBe(true);
    expect(report.totals.written).toBe(0);
    expect(report.totals.failed).toBe(0);
    db.close();
  });
});

describe("generated schema spec", () => {
  it("is in sync with src/convex/schema.ts", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/gen-turso-schema.mjs", "--check"], {
        cwd: root,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("covers every table the app actually reads", () => {
    for (const table of [
      "users",
      "parts",
      "groups",
      "closets",
      "rentals",
      "projects",
      "printers",
      "settings",
    ]) {
      expect(MIGRATION_TABLES[table]).toBeDefined();
    }
    // Auth keeps working, so its tables must come across too.
    expect(MIGRATION_TABLES.sessions).toBeDefined();
    expect(MIGRATION_TABLES.accounts).toBeDefined();
  });

  it("never emits a column kind the driver does not understand", () => {
    const kinds = new Set(Object.values(MIGRATION_TABLES).flatMap((c) => Object.values(c)));
    for (const k of kinds) expect(["text", "real", "int", "json"]).toContain(k);
  });

  // tursoHeads is the Convex→client change-head publisher. Turso keeps its own
  // heads in _changes, so copying it would waste free-plan rows AND make verify
  // report a permanent phantom mismatch.
  it("appTables() excludes the Convex-only head table", () => {
    expect(MIGRATION_TABLES.tursoHeads).toBeDefined();
    expect(CONVEX_ONLY_TABLES.has("tursoHeads")).toBe(true);
    const tables = appTables();
    expect(tables).not.toContain("tursoHeads");
    expect(tables.length).toBe(Object.keys(MIGRATION_TABLES).length - 1);
    // The real app data is still all there.
    for (const t of ["users", "parts", "rentals", "settings", "sessions"]) {
      expect(tables).toContain(t);
    }
    // And no DDL is emitted for it.
    const ddl = migrationSchemaSql(tables).join("\n");
    expect(ddl).not.toContain('CREATE TABLE IF NOT EXISTS "tursoHeads"');
  });
});