/**
 * Offline dry run of the Convex → Turso migration.
 *
 * Pulls real rows out of the CONNECTED Convex deployment (one table per
 * execution, full fidelity — no stripping, no redaction) and runs them through
 * the exact same importDump/verifyDump core that src/convex/tursoMigrate.ts
 * uses against Turso. The only difference is the target: a local SQLite file
 * instead of libSQL over HTTP, so this can be exercised without credentials.
 *
 *   bun scripts/dryrun-migration.ts --tables users,parts --out /tmp/x.sqlite
 *   bun scripts/dryrun-migration.ts --all --out /tmp/x.sqlite
 */
import { execFileSync } from "node:child_process";
import { Database } from "bun:sqlite";
import {
  appTables,
  importDump,
  verifyDump,
  type Dump,
  type SqlExecutor,
} from "../src/lib/turso-migrate";
import { MIGRATION_TABLES } from "../src/lib/turso-schema.generated";

const args = process.argv.slice(2);
const flag = (name: string, fallback = "") => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const outPath = flag("out", "/tmp/roboshelf-migration-dryrun.sqlite");
const all = args.includes("--all");
const picked = flag("tables")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// `--all` means every DATA table. `appTables()` drops the Convex-only
// infrastructure tables (`tursoHeads`), which must never be created in Turso.
const tables = all ? appTables() : picked;

if (tables.length === 0) {
  console.error("Nothing to do: pass --all or --tables=a,b,c");
  process.exit(1);
}
const unknown = tables.filter((t) => !(t in MIGRATION_TABLES));
if (unknown.length) {
  console.error(`Not in the migration spec: ${unknown.join(", ")}`);
  process.exit(1);
}

/** Same shape the Convex action builds — dumped straight from the deployment. */
function dumpTable(table: string): Dump[string] {
  const raw = execFileSync(
    "bunx",
    ["convex", "run", "tursoMigrateSource:dumpTable", JSON.stringify({ table })],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw) as Dump[string];
  return Array.isArray(parsed) ? parsed : [];
}

function executor(db: Database): SqlExecutor {
  return {
    async execute(sql: string, params: unknown[] = []) {
      const stmt = db.query(sql);
      if (/^\s*select/i.test(sql)) {
        return { rows: stmt.all(...(params as never[])) as unknown[] };
      }
      stmt.run(...(params as never[]));
      return { rows: [] };
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return (db.transaction(fn as () => T) as () => Promise<T>)();
    },
  };
}

const db = new Database(outPath, { create: true });
const exec = executor(db);

const dump: Dump = {};
for (const table of tables) {
  const rows = dumpTable(table);
  dump[table] = rows;
  console.log(`dumped ${table.padEnd(22)} ${rows.length} row(s)`);
}

const report = await importDump(exec, dump, {
  mode: "replace",
  source: "convex-dev-dry-run",
  tables,
});
const verify = await verifyDump(exec, dump, tables);

console.log("\n── import ─────────────────────────────────────────────");
for (const t of report.tables) {
  const mark = t.error ? "✗" : t.skipped ? "–" : "✓";
  console.log(
    `${mark} ${t.table.padEnd(22)} ${String(t.written).padStart(6)} / ${t.expected}` +
      (t.error ? `  ERROR: ${t.error}` : ""),
  );
}
console.log(
  `\nwritten ${report.totals.written}/${report.totals.expected} rows across ` +
    `${report.totals.tables} tables in ${report.finishedAt - report.startedAt}ms`,
);

console.log("\n── verify ─────────────────────────────────────────────");
for (const t of verify.tables) {
  if (t.matching) continue;
  console.log(`✗ ${t.table}: expected ${t.expected}, found ${t.actual}${t.missingIds.length ? `, missing ${t.missingIds.join(", ")}` : ""}`);
}
console.log(
  verify.ok
    ? `all ${verify.totals.tables} migrated tables match the source`
    : `${verify.totals.mismatched}/${verify.totals.tables} tables MISMATCH`,
);
console.log(`\ntarget: ${outPath}`);
db.close();
process.exit(verify.ok ? 0 : 1);