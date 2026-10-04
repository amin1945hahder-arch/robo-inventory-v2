// Generates src/lib/turso-schema.generated.ts from src/convex/schema.ts.
//
// The Convex schema is ~850 lines of nested validators across 32 tables;
// transcribing it by hand into SQLite DDL is exactly the kind of silent-drift
// bug that ruins a data migration. So the column spec is DERIVED, and a unit
// test re-runs this generator and fails if the committed file is stale.
//
// Usage: node scripts/gen-turso-schema.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = path.join(root, "src/convex/schema.ts");
const OUT = path.join(root, "src/lib/turso-schema.generated.ts");

/**
 * SQLite column kind per Convex validator shape.
 *  text  — TEXT      (strings, ids, string-literal unions)
 *  real  — REAL      (numbers)
 *  int   — INTEGER   (booleans, stored as 0/1)
 *  json  — TEXT holding JSON (arrays, objects, mixed unions, unknown) — always
 *          JSON-encoded, so the round trip is lossless.
 */
function classify(validator, depth = 0) {
  if (depth > 20) return "json"; // paranoia: never recurse forever
  const s = validator.trim();
  // Unwrap v.optional(...) only when it wraps the WHOLE value — an unanchored
  // test also matches nested uses (v.array(v.optional(...))) and loops forever.
  const opt = /^v\.optional\(([\s\S]*)\)$/.exec(s);
  if (opt) return classify(opt[1], depth + 1);
  if (s === "roleValidator") return "text"; // the only shared validator
  if (/^v\.(string|id)\(/.test(s)) return "text";
  if (/^v\.number\(/.test(s)) return "real";
  if (/^v\.boolean\(/.test(s)) return "int";
  // A union made only of string literals is still plain text.
  const literals = (s.match(/v\.literal\(/g) ?? []).length;
  const others = (s.match(/v\.(?!literal\()/g) ?? []).length;
  if (literals > 0 && others === 0) return "text";
  return "json";
}

/** Strip line/block comments so they never confuse the field scanner. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Read `defineTable({ ... })` bodies with a brace-matching scanner. */
function extractTables(src) {
  const out = [];
  const re = /(\w+):\s*defineTable\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = re.lastIndex;
    while (i < src.length && src[i] !== "{") i++;
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: m[1], body: src.slice(start + 1, i) });
    // `.index("by_x", ["a"])` calls are CHAINED after the table body, outside
    // the braces we just matched — capture that tail too.
    let d2 = 0;
    let tailEnd = i + 1;
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if ("([{".includes(c)) d2++;
      else if (")]}".includes(c)) {
        // A ")" at depth 0 is the one closing `defineTable(`, not a terminator;
        // only the schema object's own "}" (or the table separator) ends the run.
        if (c === "}" && d2 === 0) break;
        if (d2 > 0) d2--;
      } else if (c === "," && d2 === 0) break;
      tailEnd = j + 1;
    }
    out[out.length - 1].indexChain = src.slice(i + 1, tailEnd);
    re.lastIndex = i;
  }
  return out;
}

/**
 * Read `key: <validator>` pairs from a table body (depth-aware, comma
 * terminated). `.index("by_x", [...])` entries are collected separately and are
 * NOT fields.
 */
function extractFields(body) {
  const fields = [];
  const re = /(\w+):/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1];
    if (key === "index" || key === "defineTable") continue;
    let i = re.lastIndex;
    let depth = 0;
    let end = re.lastIndex; // exclusive end of the value
    for (; i < body.length; i++) {
      const c = body[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === "," && depth === 0) break;
      end = i + 1;
    }
    fields.push({ key, validator: body.slice(re.lastIndex, end) });
    re.lastIndex = i;
  }
  return fields;
}

/** Read `.index("name", ["a", "b"])` declarations from a table body. */
function extractIndexes(body) {
  const out = [];
  const re = /\.index\(\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const cols = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (cols.length > 0) out.push({ name: m[1], columns: cols });
  }
  return out;
}

const src = stripComments(readFileSync(SCHEMA, "utf8"));

/** Tables @convex-dev/auth adds via `...authTables` (not literal calls here).
 *  They must exist in Turso too, or sign-in loses every session. */
const AUTH_TABLES = {
  accounts: {
    accountId: "text",
    providerAccountId: "text",
    userId: "text",
    access_token: "json",
    refresh_token: "json",
    id_token: "json",
    access_token_expires_at: "text",
    refresh_token_expires_at: "text",
    token_type: "text",
    scope: "text",
    id_token_expires_at: "text",
    session_state: "text",
  },
  sessions: { userId: "text", expirationTime: "real" },
  verificationTokens: { identifier: "text", token: "text", expirationTime: "real" },
  passwordResetTokens: { identifier: "text", token: "text", expirationTime: "real" },
};

const tables = {};
const indexes = {};
for (const { name, body, indexChain } of extractTables(src)) {
  const columns = {};
  for (const f of extractFields(body)) {
    if (f.validator.trim() === "") continue;
    columns[f.key] = classify(f.validator);
  }
  tables[name] = columns;

  // Only index fields that actually became columns.
  indexes[name] = extractIndexes(indexChain ?? "")
    .map((ix) => ({
      name: ix.name,
      columns: ix.columns.filter((c) => c in columns),
    }))
    .filter((ix) => ix.columns.length > 0);
}
for (const [name, columns] of Object.entries(AUTH_TABLES)) {
  if (!tables[name]) {
    tables[name] = columns;
    indexes[name] = [];
  }
}

// Stable order: the order the tables appear in the schema.
const ordered = {};
for (const name of Object.keys(tables)) ordered[name] = tables[name];

const body = JSON.stringify(ordered, null, 2)
  .replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, "$1:")
  .replace(/^(\s+)"([^"]+)":/gm, (_m, indent, key) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${indent}${key}:` : `${indent}"${key}":`,
  );

// Same treatment as the tables block: unquote only the object KEYS (table
// names). Values stay quoted — index/column names must not become identifiers.
const indexBody = JSON.stringify(indexes, null, 2)
  .replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, "$1:")
  .replace(/^(\s+)"([^"]+)":/gm, (_m, indent, key) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${indent}${key}:` : `${indent}"${key}":`,
  );

const out = `// GENERATED FILE — do not edit by hand.
// Source: src/convex/schema.ts   Regenerate: node scripts/gen-turso-schema.mjs
//
// One entry per Convex table, mapping each document field to a SQLite column
// kind. Tables not present here are not migrated. "users" also carries the
// @convex-dev/auth columns because auth shares that table.
//
//   text — TEXT column
//   real — REAL column
//   int  — INTEGER column (boolean, stored as 0/1)
//   json — TEXT column holding JSON (lossless for arrays/objects/unions)

/** Convex table name -> column name -> SQLite kind. */
export type SqlKind = "text" | "real" | "int" | "json";

export const MIGRATION_TABLES: Record<string, Record<string, SqlKind>> = ${body};

/** Convex secondary indexes -> the SQLite indexes that replace them. */
export const MIGRATION_INDEXES: Record<string, { name: string; columns: string[] }[]> = ${indexBody};

export const MIGRATION_TABLE_NAMES: readonly string[] = Object.keys(MIGRATION_TABLES);
`;

if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== out) {
    console.error(
      "turso-schema.generated.ts is STALE — re-run node scripts/gen-turso-schema.mjs",
    );
    process.exit(1);
  }
  console.log("turso-schema.generated.ts is up to date");
} else {
  writeFileSync(OUT, out);
  console.log(
    `wrote ${Object.keys(ordered).length} tables, ${Object.values(indexes).reduce((n, x) => n + x.length, 0)} indexes`,
  );
}