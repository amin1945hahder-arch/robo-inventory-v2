// NOTE: intentionally NOT "use node". The libsql HTTP client is pure JS over
// fetch, so it runs in the default Convex runtime — which lets converted reads
// live in their ORIGINAL module (with its queries/mutations) instead of being
// relocated to a separate "use node" file. See src/convex/tursoHealth.ts for
// the live probe that verifies this.
//
// The HTTP sub-path is deliberate (same reason as turso.ts): the default
// "@libsql/client" entry pulls in the native `libsql` binding, which the Convex
// node runtime cannot bundle. We only ever talk to a REMOTE Turso database.
import { createClient } from "@libsql/client/http";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { readTursoConfig } from "../lib/turso";
import { TURSO_FREE_PLAN, ReadBudget, withBudget } from "../lib/turso-budget";
import type { SqlExecutor } from "../lib/turso-migrate";
import { bridgedb, makeIdResolver, type BridgeDb } from "../lib/turso-bridge";

/**
 * Action-side Turso runtime.
 *
 * Every converted data function (a Convex ACTION) starts with:
 *
 *   const { db, problem } = loadTurso();
 *   if (!db) throw new Error(problem);
 *
 * and then reads/writes exactly like it used to, through the ctx.db-shaped
 * bridge. This module owns the two cross-cutting concerns so no call site has
 * to:
 *
 *  1. the DRIVER (libsql HTTP client → SqlExecutor), and
 *  2. the FREE-PLAN BUDGET GATE — the executor is wrapped by {@link withBudget}
 *     so a runaway read/write is refused before the 500M-read / 10M-write
 *     monthly quota can be exhausted.
 *
 * The ledger is process-lifetime and month-scoped (it rolls over on the UTC
 * month change). It is intentionally best-effort: the DURABLE defense against
 * quota burn is the change-head gate (`_changes` + `shouldRefetch`), which makes
 * idle clients cost zero reads; this gate is the hard stop on top of it.
 */

/** Month-scoped ledger shared by every action in this process. */
let ledger: ReadBudget | null = null;

export function tursoBudget(): ReadBudget {
  if (!ledger) ledger = new ReadBudget({ limits: TURSO_FREE_PLAN });
  return ledger;
}

export type TursoExecutor = {
  /** Budget-wrapped executor, or null when Turso is not configured. */
  exec: (SqlExecutor & { budget: ReadBudget }) | null;
  budget: ReadBudget;
  problem: string | null;
};

/** Build the budget-wrapped Turso executor from the workspace keys. */
export function tursoExecutor(): TursoExecutor {
  const budget = tursoBudget();
  const cfg = readTursoConfig({
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  });
  if (!cfg.ok) return { exec: null, budget, problem: cfg.problem };

  // The dashboard hands out libsql://; the HTTP client speaks https://.
  const client = createClient({
    url: cfg.config.url.replace(/^libsql:\/\//, "https://"),
    authToken: cfg.config.authToken,
  });
  const raw: SqlExecutor = {
    async execute(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as never });
      return { rows: res.rows as unknown[] };
    },
  };
  return { exec: withBudget(raw, budget), budget, problem: null };
}

export type TursoRuntime = {
  /** ctx.db-shaped facade, or null when Turso is not configured. */
  db: BridgeDb | null;
  budget: ReadBudget;
  problem: string | null;
};

/**
 * The one-call entry point for converted actions: a bridge whose id-based
 * helpers also resolve Convex-migrated ids through the `_idmap` fallback.
 */
export function loadTurso(): TursoRuntime {
  const { exec, budget, problem } = tursoExecutor();
  if (!exec) return { db: null, budget, problem };
  return {
    db: bridgedb(exec, { resolver: makeIdResolver(exec) }),
    budget,
    problem: null,
  };
}

/**
 * Publish the change-head signal for everything the bridge wrote.
 *
 * Call this ONCE at the tail of a converted write action, after the Turso
 * writes have committed:
 *
 *   const { db, problem } = loadTurso();
 *   if (!db) throw new Error(problem);
 *   …writes through db…
 *   await publishTouchedHeads(ctx, db);   // wakes subscribed clients
 *
 * No writes → no Convex mutation, so read-only actions stay free.
 */
export async function publishTouchedHeads(ctx: ActionCtx, db: BridgeDb): Promise<void> {
  const tables = db.takeTouched();
  if (tables.length === 0) return;
  await ctx.runMutation(internal.head.publishHeads, { tables });
}
