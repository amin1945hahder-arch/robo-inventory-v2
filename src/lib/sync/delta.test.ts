import { describe, expect, it } from "vitest";
import { applyDelta, cacheRows, emptyTableCache, persistCache, reviveCache } from "./delta";

describe("applyDelta", () => {
  it("inserts new rows and advances the cursor", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "p1", tag: "A", updatedAt: 100 }], []);
    expect(c.rows.size).toBe(1);
    expect(c.latestUpdatedAt).toBe(100);
  });

  it("upserts changed rows and keeps unknown fields", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "p1", tag: "A", status: "available", updatedAt: 100 }], []);
    c = applyDelta(c, [{ _id: "p1", status: "rented", updatedAt: 200 }], []);
    const row = c.rows.get("p1")!;
    expect(row.tag).toBe("A"); // untouched field preserved
    expect(row.status).toBe("rented");
    expect(row.updatedAt).toBe(200);
    expect(c.latestUpdatedAt).toBe(200);
  });

  it("ignores stale pages — the cursor never rewinds", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "p1", status: "rented", updatedAt: 200 }], []);
    c = applyDelta(c, [{ _id: "p1", status: "available", updatedAt: 100 }], []);
    expect(c.rows.get("p1")!.status).toBe("rented");
    expect(c.latestUpdatedAt).toBe(200);
  });

  it("drops tombstoned ids", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "p1", updatedAt: 100 }, { _id: "p2", updatedAt: 101 }], []);
    c = applyDelta(c, [], ["p1"]);
    expect(c.rows.has("p1")).toBe(false);
    expect(c.rows.has("p2")).toBe(true);
  });

  it("a delete followed by a re-create with a newer stamp wins", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "p1", tag: "old", updatedAt: 100 }], []);
    c = applyDelta(c, [], ["p1"]);
    c = applyDelta(c, [{ _id: "p1", tag: "new", updatedAt: 150 }], []);
    expect(c.rows.get("p1")!.tag).toBe("new");
  });

  it("skips malformed rows without throwing", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ tag: "no id" } as any, { _id: "p1", updatedAt: 5 }], []);
    expect(c.rows.size).toBe(1);
  });
});

describe("reviveCache / persistCache round-trip", () => {
  it("survives a serialize → parse → revive cycle", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "a", updatedAt: 1 }, { _id: "b", updatedAt: 9 }], []);
    const json = JSON.parse(JSON.stringify(persistCache(c)));
    const revived = reviveCache(json);
    expect(revived.latestUpdatedAt).toBe(9);
    expect(revived.rows.get("b")!.updatedAt).toBe(9);
  });

  it("returns an empty cache for corrupt data", () => {
    expect(reviveCache(null).rows.size).toBe(0);
    expect(reviveCache(42).rows.size).toBe(0);
    expect(reviveCache({ rows: "nope" }).rows.size).toBe(0);
    expect(reviveCache({ rows: [["x", { nope: 1 }]] }).rows.size).toBe(0);
  });
});

describe("cacheRows", () => {
  it("returns a stable sorted array", () => {
    let c = emptyTableCache();
    c = applyDelta(c, [{ _id: "b" }, { _id: "a" }], []);
    expect(cacheRows(c).map((r) => r._id)).toEqual(["a", "b"]);
  });
});
