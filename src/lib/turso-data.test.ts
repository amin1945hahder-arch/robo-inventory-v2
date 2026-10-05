// @vitest-environment node
// Drives a REAL SQLite engine through node:sqlite — the same offline dry-run
// harness the migration tests use, so SQL compilation, encode/decode fidelity
// and index usage are proven with no network.
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  CHANGES_TABLE,
  bumpChange,
  compilePredicate,
  readChanges,
  shouldRefetch,
  tableOfId,
  tursoData,
  type SqlExecutor,
} from "./turso-data";
import { migrationSchemaSql } from "./turso-migrate";

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
  for (const sql of migrationSchemaSql(["closets", "groups", "parts"])) {
    db.exec(sql);
  }
});

describe("row fidelity (same rules as the Convex → Turso migration)", () => {
  it("round-trips booleans, json fields and unknown fields", async () => {
    const data = tursoData(exec, { now: () => 1700000000000 });
    const stored = await data.insert("parts", {
      groupId: "g1",
      tag: "R-42",
      status: "available",
      deleted: false,
      consumptionLog: [{ at: 1, qty: 2 }],
      futureField: { nested: [1, 2] }, // unknown → must survive in _json
      updatedAt: 42,
    });

    expect(stored._id.startsWith("parts.")).toBe(true);
    expect(stored._creationTime).toBe(1700000000000);

    const back = await data.get("parts", stored._id);
    expect(back).toMatchObject({
      groupId: "g1",
      tag: "R-42",
      status: "available",
      deleted: false, // stored as 0/1, decoded back to boolean
      consumptionLog: [{ at: 1, qty: 2 }],
      futureField: { nested: [1, 2] },
      updatedAt: 42,
    });
    expect(await data.get("parts", "missing")).toBeNull();
  });

  it("patch merges, preserves unknown _json fields, and undefined removes", async () => {
    const data = tursoData(exec, { now: () => 1 });
    const { _id } = await data.insert("closets", {
      name: "Shelf A",
      location: "Lab",
      note: "old",
      customTag: "keep-me", // unknown field
    });

    await data.patch("closets", _id, { note: "new", location: undefined });
    const back = await data.get("closets", _id);
    expect(back?.note).toBe("new");
    expect(back?.location).toBeUndefined(); // removed, like Convex patch
    expect(back?.name).toBe("Shelf A");
    expect(back?.customTag).toBe("keep-me"); // _json untouched by the patch

    await expect(data.patch("closets", "nope", { name: "x" })).rejects.toThrow(
      /No document/,
    );
  });

  it("replace keeps the original id and creation time", async () => {
    const data = tursoData(exec, { now: () => 100 });
    const { _id, _creationTime } = await data.insert("groups", {
      name: "Wires",
      quantityTotal: 5,
    });
    await data.replace("groups", _id, { name: "Cables", quantityTotal: 9 });
    const back = await data.get("groups", _id);
    expect(back).toMatchObject({ name: "Cables", quantityTotal: 9, _creationTime: 100 });
  });

  it("delete is idempotent", async () => {
    const data = tursoData(exec);
    const { _id } = await data.insert("groups", { name: "X" });
    await data.delete("groups", _id);
    await data.delete("groups", _id); // no throw
    expect(await data.get("groups", _id)).toBeNull();
  });
});

describe("indexed queries (row-read budget)", () => {
  async function seed() {
    const data = tursoData(exec);
    const a = await data.insert("parts", {
      groupId: "g1",
      tag: "A",
      status: "available",
      updatedAt: 10,
    });
    const b = await data.insert("parts", {
      groupId: "g1",
      tag: "B",
      status: "rented",
      updatedAt: 20,
    });
    const c = await data.insert("parts", {
      groupId: "g2",
      tag: "C",
      status: "available",
      updatedAt: 30,
    });
    return { data, ids: [a._id, b._id, c._id] };
  }

  it("withIndex + filter compiles to SQL that SQLite runs off the index", async () => {
    const { data } = await seed();
    const spec = data
      .query("parts")
      .withIndex("by_group", (q) => q.eq(q.field("groupId"), "g1"))
      .filter((q) => q.eq(q.field("status"), "available"));
    const { sql, args } = spec.toSql();
    expect(sql).toContain(`"groupId" = ?`);
    expect(sql).toContain(`"status" = ?`);
    // `status` is a json column — comparisons go through the same JSON
    // encoding the rows were written with, so eq matches migrated rows.
    expect(args).toEqual(["g1", JSON.stringify("available")]);

    // The compiled plan must actually use the generated index — this is the
    // free-plan guarantee: filtered row reads stay bounded by MATCHING rows.
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(args as never[])) as { detail: string }[];
    const details = plan.map((p) => p.detail).join(" | ");
    expect(details).toContain("ix_parts_by_group");
    expect(details).not.toContain("SCAN parts");
  });

  it("returns only matching rows, in index order, with bounded stats", async () => {
    const { data } = await seed();
    const before = data.stats.rowsRead;
    const rows = await data
      .query("parts")
      .withIndex("by_group", (q) => q.eq(q.field("groupId"), "g1"))
      .collect();
    expect(rows.map((r) => r.tag)).toEqual(["A", "B"]); // index order
    // Accounting: only the returned rows were read from the database.
    expect(data.stats.rowsRead - before).toBe(2);
  });

  it("neq matches documents that do not have the field at all (Convex semantics)", async () => {
    const data = tursoData(exec);
    await data.insert("groups", { name: "G1", deleted: true });
    await data.insert("groups", { name: "G2", deleted: false });
    await data.insert("groups", { name: "G3" }); // field absent → NULL
    const rows = await data
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    expect(rows.map((r) => r.name).sort()).toEqual(["G2", "G3"]);
  });

  it("order/take/first/unique behave like ctx.db", async () => {
    const { data } = await seed();
    const desc = await data
      .query("parts")
      .withIndex("by_updatedAt", (q) => q.gte(q.field("updatedAt"), 0))
      .order("desc")
      .collect();
    // descending by updatedAt: 30, 20, 10
    expect(desc.map((r) => r.tag)).toEqual(["C", "B", "A"]);

    const taken = await data
      .query("parts")
      .withIndex("by_updatedAt", (q) => q.gte(q.field("updatedAt"), 0))
      .order("asc")
      .take(2);
    expect(taken.map((r) => r.tag)).toEqual(["A", "B"]);

    const first = await data.query("parts").withIndex("by_updatedAt", (q) => q.gte(q.field("updatedAt"), 0)).first();
    expect(first?.tag).toBe("A");

    // unique: 1 row ok, 2 rows throws
    const uniqueOne = await data
      .query("parts")
      .withIndex("by_group", (q) => q.eq(q.field("groupId"), "g2"))
      .unique();
    expect(uniqueOne?.tag).toBe("C");
    await expect(
      data.query("parts").withIndex("by_group", (q) => q.eq(q.field("groupId"), "g1")).unique(),
    ).rejects.toThrow(/unique/i);
  });

  it("a bare withIndex(name) walks the index with no WHERE clause", async () => {
    const data = tursoData(exec);
    await data.insert("closets", { name: "B" });
    await data.insert("closets", { name: "A" });
    const { sql, args } = data.query("closets").withIndex("by_name").toSql();
    expect(sql).not.toContain("WHERE");
    expect(args).toEqual([]);
    const rows = await data.query("closets").withIndex("by_name").collect();
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]); // walked in index order
  });

  it("or/and composition compiles correctly", async () => {
    const { data } = await seed();
    const { sql, args } = data
      .query("parts")
      .filter((q) =>
        q.or(q.eq(q.field("tag"), "A"), q.eq(q.field("tag"), "C")),
      )
      .toSql();
    expect(sql).toContain(`("tag" = ? OR "tag" = ?)`);
    expect(args).toEqual(["A", "C"]);
    const rows = await data.query("parts").filter((q) =>
      q.or(q.eq(q.field("tag"), "A"), q.eq(q.field("tag"), "C")),
    ).collect();
    expect(rows).toHaveLength(2);
  });

  it("rejects unknown tables and unknown index names", async () => {
    const data = tursoData(exec);
    expect(() => data.query("nope")).toThrow(/not in the data spec/);
    expect(() =>
      data.query("parts").withIndex("by_nothing", (q) => q.eq(q.field("x"), 1)).toSql(),
    ).toThrow(/Index .* not found/);
  });
});

describe("predicate compilation", () => {
  it("encodes values through the column kind", () => {
    const bool = compilePredicate("parts", {
      kind: "cmp",
      field: "deleted",
      op: "=",
      value: true,
    });
    expect(bool.sql).toBe(`"deleted" = ?`);
    expect(bool.args).toEqual([1]); // boolean → INTEGER 0/1

    const json = compilePredicate("rentals", {
      kind: "cmp",
      field: "status",
      op: "=",
      value: "pending",
    });
    expect(json.args).toEqual([JSON.stringify("pending")]); // json column
  });

  it("in() with an empty list never matches", () => {
    const { sql } = compilePredicate("parts", { kind: "in", field: "tag", values: [] });
    expect(sql).toBe("1=0");
  });

  // Convex treats a missing field as undefined, so eq(field, undefined) must
  // match absent columns. `col = NULL` never matches in SQL, so this compiles
  // to IS NULL (and neq to IS NOT NULL) instead of binding a NULL arg.
  it("eq/neq against undefined compile to IS NULL / IS NOT NULL", () => {
    const eqUndef = compilePredicate("filaments", {
      kind: "cmp",
      field: "archived",
      op: "=",
      value: undefined,
    });
    expect(eqUndef.sql).toBe(`"archived" IS NULL`);
    expect(eqUndef.args).toEqual([]);

    const neqUndef = compilePredicate("filaments", {
      kind: "cmp",
      field: "archived",
      op: "<>",
      value: undefined,
    });
    expect(neqUndef.sql).toBe(`"archived" IS NOT NULL`);
    expect(neqUndef.args).toEqual([]);
  });
});

describe("change heads — the only-fetch-what-changed gate", () => {
  it("bump + read roundtrip and monotonic seq", async () => {
    expect(await readChanges(exec)).toEqual({});
    const first = await bumpChange(exec, "parts", 1000);
    expect(first).toEqual({ table: "parts", at: 1000, seq: 0 });
    await bumpChange(exec, "parts", 2000);
    const heads = await readChanges(exec);
    expect(heads.parts).toMatchObject({ table: "parts", at: 2000, seq: 1 });
    // Head table is created lazily and is NOT a data table.
    expect(CHANGES_TABLE).toBe("_changes");
  });

  it("shouldRefetch only names tables that actually changed", () => {
    const last = { parts: { table: "parts", at: 1, seq: 3 }, groups: { table: "groups", at: 1, seq: 1 } };
    // nothing moved → no fetch at all (zero Turso data reads)
    expect(shouldRefetch(last, last)).toEqual([]);
    // one table bumped → exactly that table
    const next = { ...last, parts: { table: "parts", at: 2, seq: 4 } };
    expect(shouldRefetch(last, next)).toEqual(["parts"]);
    // a brand-new table appears → fetched
    expect(shouldRefetch(last, { ...next, rentals: { table: "rentals", at: 9, seq: 1 } })).toEqual([
      "parts",
      "rentals",
    ]);
  });

  it("data.bump() and data.changes() wire into the same store", async () => {
    const data = tursoData(exec, { now: () => 555 });
    await data.bump("groups");
    const heads = await data.changes();
    expect(heads.groups).toMatchObject({ at: 555, seq: 0 });
  });
});

describe("tableOfId", () => {
  it("parses ids written by this layer and ignores legacy Convex ids", () => {
    expect(tableOfId("parts.abc123")).toBe("parts");
    expect(tableOfId("k57cnk5e1p1a62b8x2")).toBeNull(); // migrated Convex id
    expect(tableOfId("nope.abc")).toBeNull(); // unknown table prefix
  });
});
