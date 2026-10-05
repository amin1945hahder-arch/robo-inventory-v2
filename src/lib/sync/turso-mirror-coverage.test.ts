/**
 * TURSO READ FRESHNESS — the guard that keeps the conversion honest.
 *
 * THE INVARIANT
 * -------------
 * A converted read serves Turso. That is only correct while Turso is FRESH. A
 * read is kept fresh by exactly one of two things:
 *
 *  1. the Convex → Turso mirror, which only covers tables that carry
 *     `updatedAt` and a `by_updatedAt` index; or
 *  2. that table's WRITERS having moved to Turso too — after which Turso is the
 *     system of record and nothing needs to sync it at all.
 *
 * A table that satisfies NEITHER is a trap: the initial one-off import copied
 * it, the mirror never touches it again, and the read quietly serves whatever
 * the rows looked like at migration time while writes keep landing in Convex.
 * That is silent, permanent data staleness — the worst failure mode this whole
 * cutover has, because nothing errors and nothing logs.
 *
 * SO THIS TEST IS A TRIPWIRE. It fails the moment a read is converted on a
 * table that neither the mirror nor the writers can keep current. The fix is
 * never to add the table to the allowlist — it is to move that table's writers
 * to Turso, or to revert that read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TURSO_FUNCTIONS } from "./tursoFunctions";
import { MIGRATION_TABLES } from "../turso-schema.generated";

const here = path.dirname(fileURLToPath(import.meta.url));
const convexDir = path.resolve(here, "../../convex");

/**
 * The tables the Convex → Turso mirror actually keeps current: those with an
 * `updatedAt` column AND a `by_updatedAt` index in the Convex schema. Derived,
 * not hand-listed, so it stays correct if the schema changes.
 */
function mirroredTables(): Set<string> {
  const schema = readFileSync(path.join(convexDir, "sync.ts"), "utf8");
  const list = /export const SYNC_TABLES = \[([\s\S]*?)\] as const;/.exec(schema);
  if (!list) throw new Error("could not find SYNC_TABLES in src/convex/sync.ts");
  return new Set(
    list[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean),
  );
}

/** Auth tables: never read from Turso, so they need no freshness guarantee. */
const AUTH_TABLES = new Set([
  "accounts",
  "sessions",
  "verificationTokens",
  "passwordResetTokens",
]);

/**
 * Reads whose tables are intentionally not yet kept fresh, each pending the
 * writer migration for that table. Every entry is REAL outstanding work.
 *
 * This is the honest ledger of the conversion's one remaining hazard. It is
 * expected to SHRINK to empty as writers move; it must never GROW.
 *
 * A function may list SEVERAL pending tables — the common case, e.g. the
 * project workspace reads members, tasks and notes and only some of them are
 * mirrored.
 */
const PENDING_WRITE_MIGRATION: Readonly<Record<string, readonly string[]>> = {
  // settings table — read through appThemes/appBackup/settings.
  "settings/getCardLayout": ["settings"],
  "settings/getMySounds": ["settings"],
  "settings/getSounds": ["settings"],
  "settings/getTelegram": ["settings"],
  "settings/getReturnCooldown": ["settings"],
  // Other keys in settings still have Convex-owned writers; appThemes uses its own key.
  "appThemes/get": ["settings"],
  "appBackup/getBackupSettings": ["settings"],
  // telegramTopics table — addTopic/updateTopic/deleteTopic still Convex.
  "telegramTopics/listTopics": ["telegramTopics"],
  // notifications + profileRequests.
  "notifications/listNotifications": ["notifications"],
  "notifications/unreadCount": ["notifications"],
  "notifications/listProfileRequests": ["profileRequests"],
  "notifications/myPendingProfileRequest": ["profileRequests"],
  // project README tables. `get`/`getRequest`/`pendingAll` also reach
  // projectMembers through the projectAccessDb helper (see the note on
  // helper indirection below).
  "projectReadme/get": ["projectReadmes", "readmeEditRequests", "projectMembers"],
  "projectReadme/getRequest": ["readmeEditRequests", "projectMembers"],
  "projectReadme/history": ["readmeHistory", "projectMembers"],
  "projectReadme/pendingAll": ["readmeEditRequests", "projectMembers"],
  // project workspace tables.
  "projectWorkspace/listSummaries": ["projectMembers", "projectTasks"],
  "projectWorkspace/workspace": ["projectMembers", "projectTasks", "projectNotes"],
  // seenRequests ledger.
  "bulk/seenForKeys": ["seenRequests"],
  "bulk/allSeenKeys": ["seenRequests"],
  // print farm tables.
  "printing/listPrinters": ["printers"],
  "printing/listFilaments": ["filaments"],
  "printing/listJobs": ["printJobs"],
  "printing/farmStats": ["printers", "filaments", "printJobs"],
  // member request queues.
  "users/listRankRequests": ["rankRequests"],
  "users/listPrinterRequests": ["printerRequests"],
  "users/listInventoryRequests": ["inventoryRequests"],
  "users/myPendingRankRequest": ["rankRequests"],
  "users/myPendingPrinterRequest": ["printerRequests"],
  "users/myPendingInventoryRequest": ["inventoryRequests"],
  // reads the mirrored tables PLUS projectMembers (via its own inline query).
  "users/getPersonCard": ["projectMembers"],
};

/**
 * The `Doc<"table">` mentions inside one exported function's source.
 *
 * KNOWN LIMITATION — this is a LOWER BOUND. It scans only the function's own
 * body, so a table reached through a module-level HELPER (e.g. projectReadme's
 * `projectAccessDb`, which reads projectMembers) is invisible to it. That is
 * why the pending ledger below lists helper-read tables by hand: the scan
 * catches what you forget, the ledger catches what it cannot see. It is not a
 * substitute for reading the code when converting a new function.
 */
function tablesReadBy(fn: string): Set<string> {
  const src = readFileSync(path.join(convexDir, `${fn.split("/")[0]}.ts`), "utf8");
  // Slice out just this function's body: from its export to the next export.
  const marker = `export const ${fn.split("/")[1]} =`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`cannot locate ${fn} in its module`);
  const rest = src.slice(start + marker.length);
  const next = rest.search(/\nexport const /);
  const body = next < 0 ? rest : rest.slice(0, next);
  return new Set(
    [...body.matchAll(/Doc<"([A-Za-z0-9_]+)">/g)].map((m) => m[1]),
  );
}

describe("converted reads are served from FRESH data", () => {
  const mirrored = mirroredTables();

  it("derives a non-empty mirror set (sanity: the regex found SYNC_TABLES)", () => {
    expect(mirrored.size).toBeGreaterThan(0);
  });

  it("every registered read is mirrored, or its writers are pending migration", () => {
    const stale: string[] = [];

    for (const fn of TURSO_FUNCTIONS) {
      const pending = PENDING_WRITE_MIGRATION[fn] ?? [];
      for (const table of tablesReadBy(fn)) {
        if (table in MIGRATION_TABLES === false) continue; // not a real table
        if (AUTH_TABLES.has(table)) continue; // auth stays in Convex by design
        if (mirrored.has(table)) continue; // kept current by the mirror
        if (pending.includes(table)) continue; // known, tracked, pending its writers
        stale.push(`${fn} reads "${table}" which nothing keeps fresh`);
      }
    }

    expect(
      stale,
      "A converted read serves a table that neither the mirror nor the write " +
        "migration keeps current — it would silently serve migration-time data. " +
        "Convert that table's writers, or revert the read.",
    ).toEqual([]);
  });

  it("the pending-writer ledger stays honest (no stale or duplicated entries)", () => {
    for (const [fn, tables] of Object.entries(PENDING_WRITE_MIGRATION)) {
      // It must still be a registered read, or the entry is dead weight.
      expect(TURSO_FUNCTIONS.has(fn), `${fn} is in the pending ledger but not converted`).toBe(true);
      for (const table of tables) {
        // And it must genuinely be pending — not secretly mirrored already.
        expect(
          mirrored.has(table) || AUTH_TABLES.has(table),
          `${fn} is listed as pending on "${table}", but that table is already kept fresh`,
        ).toBe(false);
        expect(
          table in MIGRATION_TABLES,
          `${fn} is listed as pending on unknown table "${table}"`,
        ).toBe(true);
      }
      // No duplicates within one entry.
      expect(new Set(tables).size).toBe(tables.length);
    }
    // Every pending entry must be a distinct function.
    const fns = Object.keys(PENDING_WRITE_MIGRATION);
    expect(new Set(fns).size).toBe(fns.length);
  });

  it("reports how much of the read surface is still pending", () => {
    const pending = Object.keys(PENDING_WRITE_MIGRATION).length;
    const total = TURSO_FUNCTIONS.size;
    // Prints the current split so the shrinking backlog is visible in CI output.
    // eslint-disable-next-line no-console
    console.log(
      `turso read freshness: ${total - pending}/${total} reads mirrored, ` +
        `${pending} pending their table's writers`,
    );
    expect(pending).toBeLessThanOrEqual(total);
  });
});