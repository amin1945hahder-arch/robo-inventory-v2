// @vitest-environment node
/**
 * Live Turso round-trip smoke test — OFF by default.
 *
 * This proves the transport the cutover depends on: `@libsql/client/http`
 * against the REAL TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in the environment,
 * including interactive transactions (begin → write → rollback → commit),
 * which determine whether converted mutations can keep their
 * read-then-write atomicity.
 *
 * It NEVER touches an application table: everything happens inside a
 * `_smoke_*` scratch table that is dropped in a finally block. It only runs
 * when explicitly requested:
 *
 *   RUN_TURSO_SMOKE=1 bunx vitest run src/lib/turso-data.smoke.test.ts
 *
 * Without the flag (the default `bun run test` path) the suite skips it, so
 * no normal test run ever spends Turso quota or writes to the live database.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client/http";
import type { SqlExecutor } from "./turso-data";
import { TURSO_FREE_PLAN, ReadBudget, withBudget } from "./turso-budget";
import { bridgedb, makeIdResolver } from "./turso-bridge";

const enabled =
  process.env.RUN_TURSO_SMOKE === "1" &&
  Boolean(process.env.TURSO_DATABASE_URL) &&
  Boolean(process.env.TURSO_AUTH_TOKEN);

describe.skipIf(!enabled)("live Turso round-trip (opt-in)", () => {
  it("connects, round-trips rows, and supports interactive transactions", async () => {
    const url = (process.env.TURSO_DATABASE_URL as string).replace(
      /^libsql:\/\//,
      "https://",
    );
    const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN as string });

    const exec: SqlExecutor = {
      async execute(sql: string, args: unknown[] = []) {
        const res = await db.execute({ sql, args: args as never });
        return { rows: res.rows as unknown[] };
      },
    };

    const table = `_smoke_data_layer_${Date.now().toString(36)}`;
    await db.execute(
      `CREATE TABLE ${table} (_id TEXT PRIMARY KEY, n REAL NOT NULL)`,
    );
    try {
      // Row roundtrip through the executor the data layer uses.
      await exec.execute(`INSERT INTO ${table} VALUES (?, ?)`, ["a", 1]);
      const got = await exec.execute(`SELECT n FROM ${table} WHERE _id = ?`, ["a"]);
      expect(Number((got.rows[0] as { n: unknown }).n)).toBe(1);

      // Interactive transaction — rollback must actually hold. This is the
      // property converted mutations need for read-then-write sequences.
      let txnSupported = false;
      let rollbackHeld = false;
      try {
        const txn = await db.transaction();
        await txn.execute({ sql: `INSERT INTO ${table} VALUES (?, ?)`, args: ["b", 2] });
        await txn.rollback();
        txnSupported = true;
        const after = await db.execute(`SELECT COUNT(*) AS c FROM ${table}`);
        rollbackHeld = Number(after.rows[0].c) === 1; // only "a" remains
      } catch {
        txnSupported = false;
      }
      expect(txnSupported).toBe(true);
      expect(rollbackHeld).toBe(true);

      // Commit path.
      if (txnSupported) {
        const txn2 = await db.transaction();
        await txn2.execute({ sql: `INSERT INTO ${table} VALUES (?, ?)`, args: ["c", 3] });
        await txn2.commit();
        const after = await db.execute(`SELECT COUNT(*) AS c FROM ${table}`);
        expect(Number(after.rows[0].c)).toBe(2);
      }
    } finally {
      await db.execute(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  it("the converted label read returns real rows through the bridge (read-only)", async () => {
    const url = (process.env.TURSO_DATABASE_URL as string).replace(
      /^libsql:\/\//,
      "https://",
    );
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN as string });
    const raw: SqlExecutor = {
      async execute(sql: string, args: unknown[] = []) {
        const res = await client.execute({ sql, args: args as never });
        return { rows: res.rows as unknown[] };
      },
    };
    // Exactly what loadTurso() builds: budget-wrapped executor + bridge.
    const budget = new ReadBudget({ limits: TURSO_FREE_PLAN });
    const exec = withBudget(raw, budget);
    const bridge = bridgedb(exec, { resolver: makeIdResolver(exec) });

    // The queries labels.getLabelData runs, in the same order/shape.
    const closets = await bridge.query<{ name: string }>("closets").collect();
    const groups = await bridge
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await bridge
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const users = await bridge
      .query<{ name?: string; isAnonymous?: boolean }>("users")
      .collect();

    // The migrated data is really there and decodes to Convex-shaped docs.
    expect(closets.length).toBeGreaterThan(0);
    expect(groups.length).toBeGreaterThan(0);
    expect(parts.length).toBeGreaterThan(0);
    expect(users.length).toBeGreaterThan(0);
    expect(typeof closets[0].name).toBe("string");
    // The budget ledger saw the reads (proves the gate wraps the real path).
    expect(budget.usage().reads).toBeGreaterThan(0);
    expect(budget.usage().readRatio).toBeLessThan(1);
  });

  it("lookup.resolve's primitives work live (by_name, by_tag, id-map get)", async () => {
    const url = (process.env.TURSO_DATABASE_URL as string).replace(/^libsql:\/\//, "https://");
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN as string });
    const exec = withBudget(
      {
        async execute(sql: string, args: unknown[] = []) {
          const res = await client.execute({ sql, args: args as never });
          return { rows: res.rows as unknown[] };
        },
      },
      new ReadBudget({ limits: TURSO_FREE_PLAN }),
    );
    const bridge = bridgedb(exec, { resolver: makeIdResolver(exec) });

    // `inv:<name>` / bare-name fallback — the by_name index must exist in SQL.
    const anyCloset = (await bridge.query("closets").first()) as any;
    expect(anyCloset).not.toBeNull();
    const byName = await bridge
      .query("closets")
      .withIndex("by_name", (q) => q.eq("name", anyCloset.name))
      .first();
    expect(byName).not.toBeNull();

    // `unit:<tag>` — the by_tag index.
    const anyPart = (await bridge.query("parts").first()) as any;
    expect(anyPart).not.toBeNull();
    const byTag = await bridge
      .query("parts")
      .withIndex("by_tag", (q) => q.eq("tag", anyPart.tag))
      .first();
    expect(byTag).not.toBeNull();

    // `g:<id>` / `closet:<id>` — a prefix-less MIGRATED id resolves via _idmap.
    const byId = (await bridge.get(anyPart._id)) as any;
    expect(byId).not.toBeNull();
    expect(byId._id).toBe(anyPart._id);
  });
});
