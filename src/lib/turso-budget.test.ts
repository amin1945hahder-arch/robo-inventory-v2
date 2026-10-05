// @vitest-environment node
// Pure unit tests — no SQL engine or network needed. The budget gate and scan
// policy are the only thing standing between the app and a burnt free-plan
// quota, so every branch (rollover, refusal, actual-cost recording, opt-in
// bypass) is pinned here.
import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  DEFAULT_WARN_RATIO,
  ReadBudget,
  TURSO_FREE_PLAN,
  UnboundedReadError,
  UnindexedScanError,
  assertScanAllowed,
  monthKey,
  withBudget,
} from "./turso-budget";
import type { SqlExecutor } from "./turso-migrate";

// A controllable clock so month rollover is deterministic.
function clock(start: number) {
  let now = start;
  return {
    now: () => now,
    set: (ms: number) => {
      now = ms;
    },
  };
}

// A fake executor that returns a caller-chosen number of rows and records the
// statements it was asked to run — lets a test assert the gate refused BEFORE
// any statement reached the engine.
function fakeExec(rowCount = 0) {
  const calls: string[] = [];
  const exec: SqlExecutor & { calls: string[] } = {
    calls,
    async execute(sql: string) {
      calls.push(sql);
      return { rows: Array.from({ length: rowCount }, (_, i) => ({ i })) };
    },
  };
  return exec;
}

const JAN = Date.UTC(2026, 0, 15);
const FEB = Date.UTC(2026, 1, 15);

describe("monthKey", () => {
  it("formats the UTC calendar month, zero-padded", () => {
    expect(monthKey(Date.UTC(2026, 0, 1))).toBe("2026-01");
    expect(monthKey(Date.UTC(2026, 11, 31, 23, 59))).toBe("2026-12");
    // A late-UTC timestamp does not leak into the next month.
    expect(monthKey(Date.UTC(2026, 8, 30, 23, 59, 59))).toBe("2026-09");
  });
});

describe("ReadBudget", () => {
  it("defaults to the free plan and a fresh period", () => {
    const b = new ReadBudget({ now: () => JAN });
    const u = b.usage();
    expect(u.period).toBe("2026-01");
    expect(u.readLimit).toBe(TURSO_FREE_PLAN.reads);
    expect(u.writeLimit).toBe(TURSO_FREE_PLAN.writes);
    expect(u.reads).toBe(0);
    expect(u.writes).toBe(0);
    expect(u.warning).toBe(false);
  });

  it("spend increments reads and writes", () => {
    const b = new ReadBudget({ now: () => JAN });
    b.spend({ reads: 10, writes: 2 });
    expect(b.usage()).toMatchObject({ reads: 10, writes: 2 });
  });

  it("canSpend is true up to the cap and false past it", () => {
    const b = new ReadBudget({ limits: { reads: 100, writes: 5 }, now: () => JAN });
    b.spend({ reads: 90 });
    expect(b.canSpend({ reads: 10 })).toBe(true);
    expect(b.canSpend({ reads: 11 })).toBe(false);
    expect(b.canSpend({ writes: 5 })).toBe(true);
    expect(b.canSpend({ writes: 6 })).toBe(false);
  });

  it("spend throws BudgetExceededError and records nothing on refusal", () => {
    const b = new ReadBudget({ limits: { reads: 100, writes: 5 }, now: () => JAN });
    b.spend({ reads: 95 });
    let thrown: unknown;
    try {
      b.spend({ reads: 10 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BudgetExceededError);
    const err = thrown as BudgetExceededError;
    expect(err.kind).toBe("reads");
    expect(err.requested).toBe(10);
    expect(err.used).toBe(95);
    expect(err.limit).toBe(100);
    // The refused reservation must not move the ledger.
    expect(b.usage().reads).toBe(95);
  });

  it("refuses an over-cap write reservation too", () => {
    const b = new ReadBudget({ limits: { reads: 100, writes: 3 }, now: () => JAN });
    b.spend({ writes: 3 });
    expect(() => b.spend({ writes: 1 })).toThrow(BudgetExceededError);
    try {
      b.spend({ writes: 1 });
    } catch (e) {
      expect((e as BudgetExceededError).kind).toBe("writes");
    }
  });

  it("record accumulates actual usage and counts calls", () => {
    const b = new ReadBudget({ now: () => JAN });
    b.record({ reads: 3 });
    b.record({ reads: 4, writes: 1 });
    expect(b.usage()).toMatchObject({ reads: 7, writes: 1, calls: 2 });
  });

  it("isExhausted flips at either cap", () => {
    const b = new ReadBudget({ limits: { reads: 10, writes: 2 }, now: () => JAN });
    expect(b.isExhausted()).toBe(false);
    b.spend({ reads: 10 });
    expect(b.isExhausted()).toBe(true);
    b.reset();
    expect(b.isExhausted()).toBe(false);
    b.spend({ writes: 2 });
    expect(b.isExhausted()).toBe(true);
  });

  it("usage reports ratios, remaining and the warning threshold", () => {
    const b = new ReadBudget({
      limits: { reads: 100, writes: 100 },
      now: () => JAN,
      warnRatio: 0.8,
    });
    expect(DEFAULT_WARN_RATIO).toBe(0.8);
    b.spend({ reads: 79 });
    expect(b.usage()).toMatchObject({ reads: 79, readRemaining: 21 });
    expect(b.usage().warning).toBe(false);
    b.spend({ reads: 1 }); // 80% → warning
    expect(b.usage().readRatio).toBeCloseTo(0.8);
    expect(b.usage().warning).toBe(true);
    expect(b.usage().readRemaining).toBe(20);
  });

  it("clamps remaining at zero past the cap", () => {
    const b = new ReadBudget({ limits: { reads: 10, writes: 10 }, now: () => JAN });
    b.record({ reads: 25 });
    expect(b.usage().readRemaining).toBe(0);
  });

  it("rolls usage over when the UTC month advances", () => {
    const c = clock(JAN);
    const b = new ReadBudget({ now: c.now });
    b.spend({ reads: 1_000_000 });
    expect(b.usage().reads).toBe(1_000_000);
    c.set(FEB);
    // Any accessor observes the new month and drops last month's spend.
    expect(b.usage()).toMatchObject({ period: "2026-02", reads: 0 });
  });

  it("reset clears the current period", () => {
    const b = new ReadBudget({ now: () => JAN });
    b.spend({ reads: 5 });
    b.reset();
    expect(b.usage()).toMatchObject({ reads: 0, writes: 0, calls: 0 });
  });
});

describe("assertScanAllowed", () => {
  it("allows an indexed, bounded read", () => {
    expect(() => assertScanAllowed("parts", { hasIndex: true, hasLimit: true })).not.toThrow();
  });

  it("refuses an unindexed read", () => {
    expect(() => assertScanAllowed("parts", { hasIndex: false, hasLimit: true })).toThrow(
      UnindexedScanError,
    );
  });

  it("refuses an unbounded read", () => {
    expect(() => assertScanAllowed("parts", { hasIndex: true, hasLimit: false })).toThrow(
      UnboundedReadError,
    );
  });

  it("allowScan bypasses both guards", () => {
    expect(() =>
      assertScanAllowed("groups", { hasIndex: false, hasLimit: false, allowScan: true }),
    ).not.toThrow();
  });

  it("prefers the index error when both are missing", () => {
    expect(() => assertScanAllowed("parts", { hasIndex: false, hasLimit: false })).toThrow(
      UnindexedScanError,
    );
  });
});

describe("withBudget", () => {
  it("records actual rows read for a SELECT", async () => {
    const b = new ReadBudget({ now: () => JAN });
    const exec = fakeExec(3);
    const wrapped = withBudget(exec, b);
    expect(wrapped.budget).toBe(b);

    await wrapped.execute("SELECT * FROM parts");
    // rows read, not rows returned by an estimate
    expect(b.usage()).toMatchObject({ reads: 3, writes: 0, calls: 1 });
  });

  it("charges writes with the configured cost for non-SELECTs", async () => {
    const b = new ReadBudget({ now: () => JAN });
    const wrapped = withBudget(fakeExec(), b, { writeCost: 2 });
    await wrapped.execute("INSERT INTO parts VALUES (?)", ["x"]);
    await wrapped.execute("UPDATE parts SET a = 1");
    expect(b.usage()).toMatchObject({ reads: 0, writes: 4, calls: 2 });
  });

  it("classifies WITH/PRAGMA/EXPLAIN as reads", async () => {
    const b = new ReadBudget({ now: () => JAN });
    const wrapped = withBudget(fakeExec(1), b);
    await wrapped.execute("WITH x AS (SELECT 1) SELECT * FROM x");
    await wrapped.execute("PRAGMA table_info(parts)");
    await wrapped.execute("EXPLAIN QUERY PLAN SELECT 1");
    expect(b.usage()).toMatchObject({ reads: 3, writes: 0 });
  });

  it("refuses before running when the budget is already exhausted", async () => {
    const b = new ReadBudget({ limits: { reads: 5, writes: 5 }, now: () => JAN });
    b.spend({ reads: 5 });
    const exec = fakeExec(1);
    const wrapped = withBudget(exec, b);

    await expect(wrapped.execute("SELECT * FROM parts")).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    // Hard gate: no statement reached the engine.
    expect(exec.calls).toHaveLength(0);

    let kind: string | undefined;
    try {
      await wrapped.execute("SELECT * FROM parts");
    } catch (e) {
      kind = (e as BudgetExceededError).kind;
    }
    expect(kind).toBe("reads");
  });

  it("reports the writes dimension when writes ran out", async () => {
    const b = new ReadBudget({ limits: { reads: 5, writes: 5 }, now: () => JAN });
    b.spend({ writes: 5 });
    const wrapped = withBudget(fakeExec(), b);
    let kind: string | undefined;
    try {
      await wrapped.execute("INSERT INTO parts VALUES (1)");
    } catch (e) {
      kind = (e as BudgetExceededError).kind;
    }
    expect(kind).toBe("writes");
  });

  it("reserves an estimate then records only the delta", async () => {
    const b = new ReadBudget({ now: () => JAN });
    const exec = fakeExec(12);
    const wrapped = withBudget(exec, b, { estimateReads: () => 10 });
    await wrapped.execute("SELECT * FROM parts");
    // 10 reserved + (12 - 10) recorded = the true 12.
    expect(b.usage().reads).toBe(12);
  });

  it("never under-counts when the actual is below the estimate", async () => {
    const b = new ReadBudget({ now: () => JAN });
    const wrapped = withBudget(fakeExec(4), b, { estimateReads: () => 10 });
    await wrapped.execute("SELECT * FROM parts");
    // Conservative: keeps the 10 reserved rather than crediting back.
    expect(b.usage().reads).toBe(10);
  });

  it("reserving an estimate can trip the gate before a runaway read", async () => {
    const b = new ReadBudget({ limits: { reads: 100, writes: 10 }, now: () => JAN });
    const wrapped = withBudget(fakeExec(1), b, { estimateReads: () => 500 });
    await expect(wrapped.execute("SELECT * FROM parts")).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(b.usage().reads).toBe(0);
  });

  it("preserves an underlying transaction when present", async () => {
    const b = new ReadBudget({ now: () => JAN });
    const base = fakeExec();
    let ran = false;
    (base as SqlExecutor).transaction = async <T>(fn: () => Promise<T>) => {
      ran = true;
      return fn();
    };
    const wrapped = withBudget(base, b);
    expect(typeof wrapped.transaction).toBe("function");
    await wrapped.transaction!(async () => undefined);
    expect(ran).toBe(true);
    expect(withBudget(fakeExec(), b).transaction).toBeUndefined();
  });
});
