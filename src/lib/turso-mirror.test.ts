// @vitest-environment node
// Offline proof of the live mirror's write path: cursor round-trip, batched
// upsert, and tombstone deletes — all against a real SQLite engine.
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrationSchemaSql, type SqlExecutor } from "./turso-migrate";
import { readChanges, tursoData } from "./turso-data";
import {
  applyMirrorDeletes,
  applyMirrorPage,
  readCursor,
  writeCursor,
} from "./turso-mirror";
import { bridgedb, makeIdResolver } from "./turso-bridge";

const SELECT = /^\s*(select|with|pragma|explain)\b/i;

function sqliteExec(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sql: string, args: unknown[] = []) {
      const stmt = db.prepare(sql);
      if (SELECT.test(sql)) return { rows: stmt.all(...(args as never[])) as unknown[] };
      stmt.run(...(args as never[]));
      return { rows: [] };
    },
  };
}

let db: DatabaseSync;
let exec: SqlExecutor;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  exec = sqliteExec(db);
  for (const sql of migrationSchemaSql(["parts"])) db.exec(sql);
});

const row = (id: string, updatedAt: number, tag = "A") => ({
  _id: id,
  _creationTime: 1,
  groupId: "g1",
  tag,
  status: "available",
  updatedAt,
});

describe("mirror cursors", () => {
  it("starts at 0 and round-trips a written cursor", async () => {
    expect(await readCursor(exec, "parts")).toBe(0);
    await writeCursor(exec, "parts", 1234);
    expect(await readCursor(exec, "parts")).toBe(1234);
    await writeCursor(exec, "parts", 2000); // idempotent overwrite
    expect(await readCursor(exec, "parts")).toBe(2000);
  });

  it("keeps cursors independent per key", async () => {
    await writeCursor(exec, "parts", 10);
    await writeCursor(exec, "__tombstones__", 99);
    expect(await readCursor(exec, "parts")).toBe(10);
    expect(await readCursor(exec, "__tombstones__")).toBe(99);
  });
});

describe("applyMirrorPage", () => {
  it("upserts rows and bumps the table change head", async () => {
    const written = await applyMirrorPage(exec, "parts", [row("p1", 5), row("p2", 6)]);
    expect(written).toBe(2);
    const data = tursoData(exec);
    expect((await data.get("parts", "p1"))?.tag).toBe("A");
    expect((await readChanges(exec)).parts).toBeDefined();
  });

  it("is idempotent across re-runs (upsert, not duplicate)", async () => {
    await applyMirrorPage(exec, "parts", [row("p1", 5)]);
    await applyMirrorPage(exec, "parts", [row("p1", 5, "B")]);
    const data = tursoData(exec);
    expect((await data.get("parts", "p1"))?.tag).toBe("B");
    const count = db.prepare('SELECT COUNT(*) AS n FROM "parts"').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("skips rows with no _id and returns 0 without bumping", async () => {
    const written = await applyMirrorPage(exec, "parts", [{ tag: "no-id" }]);
    expect(written).toBe(0);
    expect((await readChanges(exec)).parts).toBeUndefined();
  });

  it("rejects an unknown table", async () => {
    await expect(applyMirrorPage(exec, "nope", [row("p", 1)])).rejects.toThrow(/not in the migration spec/);
  });

  it("handles more rows than one batch", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(`p${i}`, i + 1));
    expect(await applyMirrorPage(exec, "parts", rows)).toBe(250);
    const count = db.prepare('SELECT COUNT(*) AS n FROM "parts"').get() as { n: number };
    expect(count.n).toBe(250);
  });
});

describe("id map maintenance", () => {
  it("records written ids so the bridge can resolve a prefix-less id", async () => {
    // A live Convex id: no table prefix, exactly what the mirror copies.
    await applyMirrorPage(exec, "parts", [row("k57newliveid", 5)]);
    const b = bridgedb(exec, { resolver: makeIdResolver(exec) });
    expect(await b.get("k57newliveid")).toMatchObject({ tag: "A", groupId: "g1" });
  });
});

describe("applyMirrorDeletes", () => {
  it("deletes the given ids and bumps the head", async () => {
    await applyMirrorPage(exec, "parts", [row("p1", 5), row("p2", 6)]);
    const deleted = await applyMirrorDeletes(exec, "parts", ["p1"]);
    expect(deleted).toBe(1);
    const data = tursoData(exec);
    expect(await data.get("parts", "p1")).toBeNull();
    expect(await data.get("parts", "p2")).not.toBeNull();
  });

  it("is a no-op for an empty list", async () => {
    expect(await applyMirrorDeletes(exec, "parts", [])).toBe(0);
  });
});
