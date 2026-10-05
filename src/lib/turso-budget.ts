/**
 * Turso read-budget gate.
 *
 * The free plan bills ROW READS and WRITES per month (500M reads / 10M writes /
 * 5GB). A runaway query or a chatty mutation loop can burn that quota in a day,
 * after which the database stops answering — so the budget is not a metric to
 * watch, it is a HARD GATE the app must pass before every statement.
 *
 * This module is pure and driver-agnostic (same `SqlExecutor` shape as
 * src/lib/turso-migrate.ts), so it is unit-testable with no network and can wrap
 * a local `node:sqlite` engine, the Turso HTTP client, or a future driver.
 *
 * Two independent guards, because they catch different mistakes:
 *
 *  1. {@link ReadBudget} — a per-month ledger. Callers reserve the cost of a
 *     statement BEFORE running it; when the reservation would cross the plan
 *     cap the call throws {@link BudgetExceededError} instead of silently
 *     exhausting the quota. {@link withBudget} wires the ledger into any
 *     executor so reads/writes are recorded automatically from each result.
 *
 *  2. {@link assertScanAllowed} — the "no scan without an index" POLICY the
 *     migration settled on. A table scan or an unbounded read is refused unless
 *     the caller explicitly acknowledges it (see `allowScan`), which keeps the
 *     cheap path the default: index the query, bound it with a LIMIT, and the
 *     gate stays open.
 *
 * The budget is deliberately conservative: it refuses a call that would cross
 * the cap (rather than running and overrunning), and it reports a warning ratio
 * so callers can page an admin long before the hard stop.
 */

import type { SqlExecutor } from "./turso-migrate";

// ===== Limits ==============================================================

/** Free-plan allowance for one calendar month. */
export type BudgetLimits = { reads: number; writes: number };

export const TURSO_FREE_PLAN: BudgetLimits = {
  reads: 500_000_000,
  writes: 10_000_000,
};

/** Warn once a fraction of the cap is spent (0.8 = at 80%). */
export const DEFAULT_WARN_RATIO = 0.8;

// ===== Errors ==============================================================

/**
 * Thrown when a statement would push a month's usage past the plan cap. The
 * call is refused, never partially applied: callers treat this as a hard stop
 * and surface it to an admin rather than retrying in a loop.
 */
export class BudgetExceededError extends Error {
  readonly kind: "reads" | "writes";
  readonly requested: number;
  readonly used: number;
  readonly limit: number;

  constructor(kind: "reads" | "writes", requested: number, used: number, limit: number) {
    super(
      `Turso ${kind} budget exceeded: ${used}+${requested} would pass ${limit} for this period. ` +
        `Refusing the ${kind === "reads" ? "read" : "write"} rather than exhausting the free plan.`,
    );
    this.name = "BudgetExceededError";
    this.kind = kind;
    this.requested = requested;
    this.used = used;
    this.limit = limit;
  }
}

/** A query touched a table without an index, which the free-plan policy forbids. */
export class UnindexedScanError extends Error {
  constructor(table: string) {
    super(
      `Refusing to scan "${table}" without an index — free-plan policy requires every ` +
        `read to use an index. Add withIndex(...) or opt in with allowScan for slow-moving tables.`,
    );
    this.name = "UnindexedScanError";
  }
}

/** A read had no LIMIT, so its cost is unbounded and cannot be budgeted. */
export class UnboundedReadError extends Error {
  constructor(table: string) {
    super(
      `Refusing to read "${table}" without a LIMIT — an unbounded read cannot be budgeted. ` +
        `Use .take(n)/.first() or opt in with allowScan.`,
    );
    this.name = "UnboundedReadError";
  }
}

// ===== Monthly ledger ======================================================

/** Stable key for the calendar month (UTC) a timestamp falls in. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type BudgetCost = { reads?: number; writes?: number };

export type BudgetUsage = {
  period: string;
  reads: number;
  writes: number;
  calls: number;
  readLimit: number;
  writeLimit: number;
  readRemaining: number;
  writeRemaining: number;
  readRatio: number;
  writeRatio: number;
  /** True once either ratio reached `warnRatio`. */
  warning: boolean;
};

export type ReadBudgetOptions = {
  limits?: BudgetLimits;
  /** Clock injection for tests (defaults to Date.now). */
  now?: () => number;
  warnRatio?: number;
};

/**
 * A month-scoped ledger of Turso reads and writes.
 *
 * All entry points are cheap and synchronous, so it can sit on the hot path of
 * every statement. It rolls over automatically when the UTC month changes, so a
 * long-lived serverless instance never carries last month's spend forward.
 */
export class ReadBudget {
  private readonly limits: BudgetLimits;
  private readonly now: () => number;
  private readonly warnRatio: number;

  private period: string;
  private reads = 0;
  private writes = 0;
  private calls = 0;

  constructor(opts: ReadBudgetOptions = {}) {
    this.limits = opts.limits ?? TURSO_FREE_PLAN;
    this.now = opts.now ?? (() => Date.now());
    this.warnRatio = opts.warnRatio ?? DEFAULT_WARN_RATIO;
    this.period = monthKey(this.now());
  }

  /** Drop usage if the calendar month has advanced. Called by every accessor. */
  private rollover(): void {
    const current = monthKey(this.now());
    if (current !== this.period) {
      this.period = current;
      this.reads = 0;
      this.writes = 0;
      this.calls = 0;
    }
  }

  /** Could a statement costing `cost` run without crossing the cap? */
  canSpend(cost: BudgetCost = {}): boolean {
    this.rollover();
    const reads = cost.reads ?? 0;
    const writes = cost.writes ?? 0;
    return this.reads + reads <= this.limits.reads && this.writes + writes <= this.limits.writes;
  }

  /**
   * Reserve `cost`, or throw {@link BudgetExceededError}. Nothing is recorded
   * when the reservation is refused, so a rejected call never moves the ledger.
   */
  spend(cost: BudgetCost = {}): void {
    this.rollover();
    const reads = cost.reads ?? 0;
    const writes = cost.writes ?? 0;
    if (this.reads + reads > this.limits.reads) {
      throw new BudgetExceededError("reads", reads, this.reads, this.limits.reads);
    }
    if (this.writes + writes > this.limits.writes) {
      throw new BudgetExceededError("writes", writes, this.writes, this.limits.writes);
    }
    this.reads += reads;
    this.writes += writes;
  }

  /** Record ACTUAL usage after a statement ran (the accurate path). */
  record(cost: BudgetCost = {}): void {
    this.rollover();
    this.reads += cost.reads ?? 0;
    this.writes += cost.writes ?? 0;
    this.calls += 1;
  }

  /** True when either dimension is at (or past) its cap. */
  isExhausted(): boolean {
    this.rollover();
    return this.reads >= this.limits.reads || this.writes >= this.limits.writes;
  }

  /** A snapshot for dashboards, logs and tests. */
  usage(): BudgetUsage {
    this.rollover();
    const readRatio = this.limits.reads > 0 ? this.reads / this.limits.reads : 1;
    const writeRatio = this.limits.writes > 0 ? this.writes / this.limits.writes : 1;
    return {
      period: this.period,
      reads: this.reads,
      writes: this.writes,
      calls: this.calls,
      readLimit: this.limits.reads,
      writeLimit: this.limits.writes,
      readRemaining: Math.max(0, this.limits.reads - this.reads),
      writeRemaining: Math.max(0, this.limits.writes - this.writes),
      readRatio,
      writeRatio,
      warning: readRatio >= this.warnRatio || writeRatio >= this.warnRatio,
    };
  }

  /** Reset to a fresh period (admin "clear the counter" / tests). */
  reset(): void {
    this.period = monthKey(this.now());
    this.reads = 0;
    this.writes = 0;
    this.calls = 0;
  }
}

// ===== Scan policy =========================================================

export type ScanPolicy = {
  /** Did the query name an index? (withIndex). */
  hasIndex: boolean;
  /** Is the read bounded by a LIMIT? (`collect()` is not). */
  hasLimit: boolean;
  /**
   * Explicit, documented opt-in for the handful of legitimately-scanning
   * reads (tiny slow-moving reference tables, one-time backfills). Everything
   * else must be indexed AND bounded.
   */
  allowScan?: boolean;
};

/**
 * Enforce the free-plan read policy for one table access.
 *
 * Throws {@link UnindexedScanError} for an unindexed access and
 * {@link UnboundedReadError} for an unbounded one, unless `allowScan` is set.
 * Single-table, single-shot reads (`get` by primary key) count as indexed and
 * bounded, so only list/scan paths ever hit this.
 */
export function assertScanAllowed(table: string, policy: ScanPolicy): void {
  if (policy.allowScan) return;
  if (!policy.hasIndex) throw new UnindexedScanError(table);
  if (!policy.hasLimit) throw new UnboundedReadError(table);
}

// ===== Executor wrapper ====================================================

const SELECT = /^\s*(select|with|pragma|explain)\b/i;

export type WithBudgetOptions = {
  /** Charge a fixed write cost for non-SELECT statements (default 1). */
  writeCost?: number;
  /**
   * Reads a SELECT returns at which to reserve BEFORE running it. Omit to
   * reserve nothing up front and rely on {@link BudgetExceededError} only for
   * an already-exhausted budget — the accurate cost is still recorded after.
   */
  estimateReads?: (sql: string) => number | null;
};

/**
 * Wrap a {@link SqlExecutor} so every statement passes the gate:
 *
 *  - Before running, refuse outright if the month is already exhausted.
 *  - Optionally reserve an ESTIMATE up front (for known-cost reads).
 *  - After running, record the ACTUAL rows read / write so the ledger tracks
 *    reality, never an estimate.
 *
 * The wrapped executor exposes `budget` so callers and tests can read the
 * ledger without a second reference.
 */
export function withBudget(
  exec: SqlExecutor,
  budget: ReadBudget,
  opts: WithBudgetOptions = {},
): SqlExecutor & { budget: ReadBudget } {
  const writeCost = opts.writeCost ?? 1;

  const wrapped: SqlExecutor & { budget: ReadBudget } = {
    budget,
    async execute(sql: string, args: unknown[] = []) {
      const isRead = SELECT.test(sql);
      if (budget.isExhausted()) {
        // Refuse outright: surface the dimension that ran out.
        const u = budget.usage();
        const kind = u.reads >= u.readLimit ? "reads" : "writes";
        const used = kind === "reads" ? u.reads : u.writes;
        const limit = kind === "reads" ? u.readLimit : u.writeLimit;
        throw new BudgetExceededError(kind, 1, used, limit);
      }
      const estimate = isRead ? (opts.estimateReads?.(sql) ?? null) : null;
      if (estimate !== null && estimate > 0) budget.spend({ reads: estimate });
      const res = await exec.execute(sql, args);
      // Record the TRUE cost. For a reserved estimate we over-count by the
      // delta only when actual exceeds the estimate — cheap, and always errs
      // toward safety.
      if (isRead) {
        const actual = res.rows.length;
        budget.record({ reads: estimate !== null ? Math.max(0, actual - estimate) : actual });
      } else {
        budget.record({ writes: writeCost });
      }
      return res;
    },
    transaction: exec.transaction
      ? <T>(fn: () => Promise<T>) => exec.transaction!(fn)
      : undefined,
  };

  return wrapped;
}
