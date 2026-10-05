// @vitest-environment node
// Offline proof that the ctx.db-shaped bridge keeps Convex semantics over the
// Turso layer, and that ids written by the migration (which carry no table
// prefix) are still resolvable through the _idmap fallback.
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrationSchemaSql, type SqlExecutor } from "./turso-migrate";
import { tursoData } from "./turso-data";
import {
  IDMAP_TABLE,
  backfillIdMap,
  bridgedb,
  makeIdResolver,
  recordIdMap,
} from "./turso-bridge";

const SELECT = /^select/i;

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

let db: DatabaseSync;
let exec: SqlExecutor;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  exec = sqliteExec(db);
  for (const sql of migrationSchemaSql(["parts", "groups", "closets"])) db.exec(sql);
});

describe("bridgedb — ctx.db shape", () => {
  it("insert returns the new id string (like Convex) and auto-bumps the head", async () => {
    const b = bridgedb(exec, { now: () => 1000 });
    const id = await b.insert("parts", { groupId: "g1", tag: "A", status: "available" });
    expect(typeof id).toBe("string");
    expect(id.startsWith("parts.")).toBe(true);
    // The change head moved because the bridge bumps by default.
    const heads = await b.data.changes();
    expect(heads.parts).toMatchObject({ table: "parts", seq: 0 });
  });

  it("autoBump:false leaves the head untouched", async () => {
    const b = bridgedb(exec, { autoBump: false });
    await b.insert("groups", { name: "Wires" });
    expect(await b.data.changes()).toEqual({});
  });

  it("get/patch/delete resolve a table-prefixed id", async () => {
    const b = bridgedb(exec, { now: () => 1 });
    const id = await b.insert("parts", { groupId: "g1", tag: "A", status: "available" });
    expect(await b.get(id)).toMatchObject({ tag: "A" });
    await b.patch(id, { status: "rented", tag: undefined });
    const back = await b.get(id);
    expect(back?.status).toBe("rented");
    expect(back?.tag).toBeUndefined(); // undefined removes, like Convex
    await b.delete(id);
    expect(await b.get(id)).toBeNull();
  });

  it("replace keeps the id and creation time", async () => {
    const b = bridgedb(exec, { now: () => 500 });
    const id = await b.insert("groups", { name: "Wires", quantityTotal: 5 });
    await b.replace(id, { name: "Cables", quantityTotal: 9 });
    expect(await b.get(id)).toMatchObject({
      name: "Cables",
      quantityTotal: 9,
      _creationTime: 500,
    });
  });

  it("query() passes through to the indexed query builder", async () => {
    const b = bridgedb(exec);
    await b.insert("parts", { groupId: "g1", tag: "A", status: "available", updatedAt: 1 });
    await b.insert("parts", { groupId: "g1", tag: "B", status: "rented", updatedAt: 2 });
    const rows = await b
      .query("parts")
      .withIndex("by_group", (q) => q.eq(q.field("groupId"), "g1"))
      .take(10);
    expect(rows.map((r) => r.tag)).toEqual(["A", "B"]);
  });

  it("stats accumulate across bridged calls", async () => {
    const b = bridgedb(exec);
    const id = await b.insert("groups", { name: "X" });
    await b.get(id);
    expect(b.stats.rowsWritten).toBeGreaterThan(0);
    expect(b.stats.rowsRead).toBeGreaterThan(0);
  });
});

describe("change-head signal — touched tables", () => {
  it("records tables on write, sorted and de-duplicated", async () => {
    const b = bridgedb(exec);
    await b.insert("parts", { groupId: "g1" });
    await b.insert("parts", { groupId: "g1" });
    await b.insert("groups", { name: "Wires" });
    expect(b.touchedTables).toEqual(["groups", "parts"]);
  });

  it("takeTouched consumes the set", async () => {
    const b = bridgedb(exec);
    await b.insert("groups", { name: "X" });
    expect(b.takeTouched()).toEqual(["groups"]);
    expect(b.touchedTables).toEqual([]);
  });

  it("tracks writes even when autoBump is off (Turso head untouched)", async () => {
    const b = bridgedb(exec, { autoBump: false });
    const id = await b.insert("groups", { name: "X" });
    await b.patch(id, { name: "Y" });
    expect(await b.data.changes()).toEqual({});
    expect(b.touchedTables).toEqual(["groups"]);
  });
});

describe("migrated ids — the _idmap fallback", () => {
  it("tableOfId cannot resolve a Convex-shaped id, the resolver can", async () => {
    const data = tursoData(exec);
    // Simulate a migrated row: the original Convex id, no table prefix.
    await data.insert("parts", { _id: "k57cnk5e1p1a62b8x2", groupId: "g1", tag: "A" });
    await recordIdMap(exec, "parts", ["k57cnk5e1p1a62b8x2"]);

    const b = bridgedb(exec, { resolver: makeIdResolver(exec) });
    const doc = await b.get("k57cnk5e1p1a62b8x2");
    expect(doc).toMatchObject({ _id: "k57cnk5e1p1a62b8x2", tag: "A" });

    // And writes against the migrated id land in the right table.
    await b.patch("k57cnk5e1p1a62b8x2", { status: "rented" });
    expect((await data.get("parts", "k57cnk5e1p1a62b8x2"))?.status).toBe("rented");
  });

  it("throws a clear error when an id cannot be resolved at all", async () => {
    const b = bridgedb(exec, { resolver: makeIdResolver(exec) });
    await expect(b.get("mystery123")).rejects.toThrow(/Cannot resolve the table/);
  });

  it("backfillIdMap indexes every row's id across tables", async () => {
    const data = tursoData(exec);
    await data.insert("groups", { _id: "g_migrated_1", name: "Wires" });
    await data.insert("parts", { _id: "p_migrated_1", groupId: "g_migrated_1" });
    const recorded = await backfillIdMap(exec, ["groups", "parts"]);
    expect(recorded).toBe(2);

    const res = await exec.execute(`SELECT "id", "table" FROM ${IDMAP_TABLE} ORDER BY "id"`);
    expect(res.rows).toEqual([
      { id: "g_migrated_1", table: "groups" },
      { id: "p_migrated_1", table: "parts" },
    ]);
  });

  it("the resolver is idempotent and re-runnable", async () => {
    const data = tursoData(exec);
    await data.insert("closets", { _id: "c_migrated_1", name: "Shelf" });
    await backfillIdMap(exec, ["closets"]);
    await backfillIdMap(exec, ["closets"]); // second pass must not duplicate/throw
    const b = bridgedb(exec, { resolver: makeIdResolver(exec) });
    expect(await b.get("c_migrated_1")).toMatchObject({ name: "Shelf" });
    // A second resolver instance (fresh cache) still resolves from the map.
    const b2 = bridgedb(exec, { resolver: makeIdResolver(exec) });
    expect(await b2.get("c_migrated_1")).toMatchObject({ name: "Shelf" });
  });
});
