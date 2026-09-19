import JSZip from "jszip";

/**
 * Full-app data backup builders (pure, shared by the server action and the
 * browser). A backup zip contains:
 *
 *   csv/<table>.csv   — one spreadsheet-friendly CSV per table (BOM, so Excel
 *                       opens Arabic text correctly) — same spirit as Export
 *   data.json         — structured dump: { meta, tables: { name: { columns,
 *                       rows } } } — the machine-readable copy
 *   schema.sql        — CREATE TABLE statements (SQLite flavor) so the dump
 *                       can be imported into any SQL engine directly
 *   README.txt        — what this archive is and how to use it
 *
 * Returns base64 (no data: prefix) so both Telegram and the browser download
 * consume the exact same artifact.
 */

export type BackupMeta = {
  app: string;
  generatedAt: number;
  version: number;
};

export type BackupTables = Record<string, Record<string, unknown>[]>;

const LEADING_KEYS = ["_id", "_creationTime"];

/** CSV field escaping: wrap in quotes, double embedded quotes. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Column list for a table: _id/_creationTime first, then the union of every
 *  row's keys alphabetically. */
export function tableColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  const rest = [...seen].filter((k) => !LEADING_KEYS.includes(k)).sort();
  return [...LEADING_KEYS.filter((k) => seen.has(k)), ...rest];
}

/** One CSV per table with BOM (Excel opens Arabic correctly). */
export function tableToCsv(rows: Record<string, unknown>[]): string {
  const cols = tableColumns(rows);
  const head = cols.map((c) => csvCell(c)).join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell(r[c])).join(","))
    .join("\n");
  return `\uFEFF${head}\n${body}`;
}

/** SQL-ish type for a column, inferred from the actual row values. */
export function inferColumnType(
  values: unknown[],
): "TEXT" | "REAL" | "INTEGER" | "JSON" {
  let sawNumber = false;
  let sawInt = true;
  let sawBool = false;
  let sawOther = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number") {
      sawNumber = true;
      if (!Number.isInteger(v)) sawInt = false;
    } else if (typeof v === "boolean") {
      sawBool = true;
    } else if (typeof v === "string") {
      sawOther = true;
    } else {
      sawOther = true;
    }
  }
  if (sawOther) return "TEXT";
  if (sawBool && !sawNumber) return "INTEGER"; // booleans stored as 0/1
  if (sawNumber) return sawInt ? "INTEGER" : "REAL";
  return "TEXT";
}

/** CREATE TABLE IF NOT EXISTS statements (SQLite flavor) for every table. */
export function buildSchemaSql(tables: BackupTables): string {
  const out: string[] = [
    `-- RoboShelf full backup schema (SQLite flavor)`,
    `-- generated ${new Date().toISOString()}`,
    `-- data lives in data.json and csv/*.csv in this archive`,
    "",
  ];
  for (const name of Object.keys(tables).sort()) {
    const rows = tables[name];
    const cols = tableColumns(rows);
    if (cols.length === 0) {
      out.push(`-- ${name}: (empty table)`);
      out.push(`CREATE TABLE IF NOT EXISTS "${name}" ();`);
      out.push("");
      continue;
    }
    const defs = cols.map((c) => {
      const values = rows.map((r) => r[c]);
      const type = inferColumnType(values);
      const pk = c === "_id" ? " PRIMARY KEY" : "";
      return `  "${c}" ${type}${pk}`;
    });
    out.push(`CREATE TABLE IF NOT EXISTS "${name}" (`);
    out.push(defs.join(",\n"));
    out.push(`);`);
    out.push("");
  }
  return out.join("\n");
}

/** Structured JSON dump — { meta, tables: { name: { columns, rows } } }. */
export function buildDataJson(tables: BackupTables, meta: BackupMeta): string {
  const payload = {
    meta,
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [
        name,
        { columns: tableColumns(rows), rows },
      ]),
    ),
  };
  return JSON.stringify(payload, null, 2);
}

/** Secrets that must never leave the database — even into a club-group zip. */
const SECRET_SETTINGS_KEYS = new Set(["telegram"]);

/** Redact bot tokens etc. from the settings table copy (pure + tested). */
export function redactSecrets(tables: BackupTables): void {
  const rows = tables["settings"];
  if (!rows) return;
  for (const row of rows) {
    if (row["key"] !== undefined && SECRET_SETTINGS_KEYS.has(String(row["key"]))) {
      row["value"] = "[redacted]";
    }
  }
}

export function backupFileName(generatedAt: number): string {
  const d = new Date(generatedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `RoboShelf_Full_Backup_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(
    d.getDate(),
  )}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** Assemble the whole archive, base64-encoded (no data: prefix). */
export async function buildBackupZip(
  tables: BackupTables,
  meta: BackupMeta,
): Promise<string> {
  const zip = new JSZip();
  const csv = zip.folder("csv")!;
  for (const name of Object.keys(tables).sort()) {
    csv.file(`${name}.csv`, tableToCsv(tables[name]));
  }
  zip.file("data.json", buildDataJson(tables, meta));
  zip.file("schema.sql", buildSchemaSql(tables));
  zip.file(
    "README.txt",
    [
      `RoboShelf — Robotics Club Inventory full backup`,
      `Generated: ${new Date(meta.generatedAt).toISOString()}`,
      ``,
      `Contents:`,
      `  csv/<table>.csv  — one CSV per table (UTF-8 BOM, Excel-friendly)`,
      `  data.json        — structured dump: { meta, tables: { name: { columns, rows } } }`,
      `  schema.sql       — CREATE TABLE statements (SQLite flavor)`,
      ``,
      `SQL import: run schema.sql in SQLite, then load rows from data.json`,
      `(every table's "columns" list matches the CREATE TABLE order).`,
      ``,
      `Bot tokens in the settings table are redacted on purpose.`,
    ].join("\n"),
  );
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}
