"use node";

// The HTTP sub-path is deliberate: the default "@libsql/client" entry pulls in
// the native `libsql` binding, which the Convex node runtime cannot bundle. We
// only ever talk to a REMOTE Turso database, so the pure-JS HTTP client is both
// the light and the correct one.
import { createClient } from "@libsql/client/http";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  readTursoConfig,
  summarizeShelfEvents,
  toShelfEvent,
  tursoDatabaseName,
  type ShelfEvent,
} from "../lib/turso";

/**
 * Turso edge ledger (libSQL over HTTP).
 *
 * Convex stays the source of truth. Every rental decision is ALSO appended to
 * a tiny `shelf_events` table in Turso — an append-only, edge-hosted audit
 * trail that can be read from anywhere (dashboards, bots, future public
 * pages) and that survives a Convex reset.
 *
 * Config comes from two environment variables (Keys tab):
 *   TURSO_DATABASE_URL  — libsql://<db>-<org>.turso.io
 *   TURSO_AUTH_TOKEN    — a group/member token with write access
 *
 * Every entry point is a no-op while they are missing, so the club app keeps
 * working before (or without) Turso ever being configured.
 */

const SHELF_EVENT_KIND = v.union(
  v.literal("rented"),
  v.literal("returned"),
  v.literal("broken"),
  v.literal("approved"),
  v.literal("denied"),
);

/** Read the two keys. Never throws — callers decide what to do. */
function config() {
  return readTursoConfig({
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  });
}

function connect() {
  const cfg = config();
  if (!cfg.ok) return { db: null, problem: cfg.problem } as const;
  // The dashboard hands out libsql://; the HTTP client speaks https://.
  const url = cfg.config.url.replace(/^libsql:\/\//, "https://");
  return {
    db: createClient({ url, authToken: cfg.config.authToken }),
    problem: null,
  } as const;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS shelf_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  kind      TEXT    NOT NULL,
  part_tag  TEXT    NOT NULL DEFAULT '',
  part_name TEXT    NOT NULL DEFAULT '',
  member    TEXT    NOT NULL DEFAULT '',
  note      TEXT    NOT NULL DEFAULT ''
)`;

const CREATE_INDEX =
  "CREATE INDEX IF NOT EXISTS shelf_events_at ON shelf_events (at DESC)";

/** Idempotent — safe to call before every write. */
async function ensureSchema(db: ReturnType<typeof createClient>) {
  await db.execute(CREATE_TABLE);
  await db.execute(CREATE_INDEX);
}

/** One append-only insert. */
async function insertEvent(
  db: ReturnType<typeof createClient>,
  row: ShelfEvent,
): Promise<void> {
  await ensureSchema(db);
  await db.execute({
    sql: `INSERT INTO shelf_events (at, kind, part_tag, part_name, member, note)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [row.at, row.kind, row.partTag, row.partName, row.member, row.note],
  });
}

function str(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "bigint") return String(cell);
  return "";
}

/** Pull ledger rows out of a libSQL result set without trusting its types. */
function rowsToEvents(rows: readonly unknown[]): ShelfEvent[] {
  const out: ShelfEvent[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const at = Number(r.at ?? 0);
    out.push({
      at: Number.isFinite(at) ? at : 0,
      kind: str(r.kind),
      partTag: str(r.part_tag ?? r.partTag),
      partName: str(r.part_name ?? r.partName),
      member: str(r.member),
      note: str(r.note),
    });
  }
  return out;
}

/**
 * Append one ledger row. Called from Convex mutations through the scheduler,
 * so it must NEVER throw — a missing key or a Turso outage is reported in the
 * result, not raised at the member who pressed the button.
 */
export const recordShelfEvent = internalAction({
  args: {
    kind: SHELF_EVENT_KIND,
    partTag: v.optional(v.string()),
    partName: v.optional(v.string()),
    member: v.optional(v.string()),
    note: v.optional(v.string()),
    at: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const { db, problem } = connect();
    if (!db) return { ok: false as const, reason: problem };
    const row = toShelfEvent({ ...args, at: args.at ?? Date.now() });
    try {
      await insertEvent(db, row);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  },
});

/** Admin-only: recent ledger rows plus the aggregate tile. */
export const ledger = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const me = await ctx.runQuery(internal.users.currentInternalUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");

    const cfg = config();
    if (!cfg.ok) {
      return {
        configured: false as const,
        problem: cfg.problem,
        database: null,
        events: [] as ShelfEvent[],
        summary: summarizeShelfEvents([]),
      };
    }

    const { db } = connect();
    if (!db) throw new Error("Turso is not reachable");
    const capped = Math.min(Math.max(limit ?? 25, 1), 100);

    try {
      await ensureSchema(db);
      const res = await db.execute({
        sql: `SELECT at, kind, part_tag, part_name, member, note
              FROM shelf_events ORDER BY at DESC LIMIT ?`,
        args: [capped],
      });
      const events = rowsToEvents(res.rows);
      return {
        configured: true as const,
        problem: null,
        database: tursoDatabaseName(cfg.config.url),
        events,
        summary: summarizeShelfEvents(events),
      };
    } catch (e) {
      return {
        configured: true as const,
        problem: (e as Error).message,
        database: tursoDatabaseName(cfg.config.url),
        events: [] as ShelfEvent[],
        summary: summarizeShelfEvents([]),
      };
    }
  },
});

/** Admin-only: is Turso wired up, and what is missing if not. */
export const status = action({
  args: {},
  handler: async (ctx) => {
    const me = await ctx.runQuery(internal.users.currentInternalUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    const cfg = config();
    return cfg.ok
      ? {
          configured: true as const,
          problem: null,
          database: tursoDatabaseName(cfg.config.url),
        }
      : {
          configured: false as const,
          problem: cfg.problem,
          database: null,
        };
  },
});

/**
 * Admin-facing single write (the "Log a test event" button in Admin Reports)
 * — same insert path as the scheduled writer above.
 */
export const appendEvent = action({
  args: { kind: SHELF_EVENT_KIND, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await ctx.runQuery(internal.users.currentInternalUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    const { db, problem } = connect();
    if (!db) return { ok: false as const, reason: problem };
    try {
      await insertEvent(db, toShelfEvent({ ...args, at: Date.now() }));
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  },
});