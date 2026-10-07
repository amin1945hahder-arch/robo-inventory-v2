import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  backupFileName,
  buildBackupZip,
  buildSchemaSql,
  csvCell,
  inferColumnType,
  redactSecrets,
  tableColumns,
  tableToCsv,
} from "./app-backup";

describe("csvCell", () => {
  it("escapes quotes and commas", () => {
    expect(csvCell('has "quotes"')).toBe('"has ""quotes"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(5)).toBe('"5"');
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("tableColumns", () => {
  it("puts _id and _creationTime first, then sorted keys", () => {
    const cols = tableColumns([
      { _id: "a", _creationTime: 1, zeta: 1, alpha: 2 },
      { _id: "b", alpha: 9, beta: 1 },
    ]);
    expect(cols).toEqual(["_id", "_creationTime", "alpha", "beta", "zeta"]);
  });
  it("omits _creationTime when no row has it", () => {
    expect(tableColumns([{ _id: "a", x: 1 }])).toEqual(["_id", "x"]);
  });
});

describe("tableToCsv", () => {
  it("writes a BOM + header + rows", () => {
    const csv = tableToCsv([
      { _id: "a", name: 'عن, "عربي"' },
      { _id: "b", name: "plain" },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe('"_id","name"');
    expect(lines[1]).toBe('"a","عن, ""عربي"""');
    expect(lines[2]).toBe('"b","plain"');
  });
});

describe("inferColumnType", () => {
  it("detects integer, real, text and bool", () => {
    expect(inferColumnType([1, 2, 3])).toBe("INTEGER");
    expect(inferColumnType([1.5, 2])).toBe("REAL");
    expect(inferColumnType(["a", "b"])).toBe("TEXT");
    expect(inferColumnType([true, false])).toBe("INTEGER");
    expect(inferColumnType([1, "a"])).toBe("TEXT");
    expect(inferColumnType([])).toBe("TEXT");
  });
});

describe("buildSchemaSql", () => {
  it("emits CREATE TABLE statements with _id primary key", () => {
    const sql = buildSchemaSql({
      parts: [
        { _id: "a", tag: "X-1", qty: 3 },
        { _id: "b", tag: "X-2", qty: 4.5 },
      ],
    });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "parts"');
    expect(sql).toContain('"_id" TEXT PRIMARY KEY');
    expect(sql).toContain('"tag" TEXT');
    expect(sql).toContain('"qty" REAL');
  });
  it("handles empty tables", () => {
    const sql = buildSchemaSql({ empty: [] });
    expect(sql).toContain("-- empty: (empty table)");
  });
});

describe("redactSecrets", () => {
  it("redacts the telegram settings value", () => {
    const tables: Record<string, Record<string, unknown>[]> = {
      settings: [
        { _id: "1", key: "telegram", value: '{"botToken":"SECRET"}' },
        { _id: "2", key: "return_request_cooldown_hours", value: "24" },
      ],
    };
    redactSecrets(tables);
    expect(tables.settings[0].value).toBe("[redacted]");
    expect(tables.settings[1].value).toBe("24");
  });
  it("is a no-op without a settings table", () => {
    const tables = { parts: [{ _id: "a" }] };
    expect(() => redactSecrets(tables)).not.toThrow();
  });
});

describe("backupFileName", () => {
  it("formats the zip name", () => {
    const name = backupFileName(new Date(2026, 8, 19, 9, 5).getTime());
    expect(name).toBe("RC_Full_Backup_2026-09-19_0905.zip");
  });
});

describe("buildBackupZip", () => {
  it("produces a zip with csv/, data.json and schema.sql", async () => {
    const b64 = await buildBackupZip(
      {
        parts: [{ _id: "a", tag: "ARD-1" }],
        emptyTable: [],
      },
      { app: "RC", generatedAt: 1_700_000_000_000, version: 1 },
    );
    const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "csv/emptyTable.csv",
        "csv/parts.csv",
        "data.json",
        "schema.sql",
        "README.txt",
      ]),
    );
    const json = JSON.parse(await zip.file("data.json")!.async("string"));
    expect(json.meta.app).toBe("RC");
    expect(json.tables.parts.rows[0].tag).toBe("ARD-1");
    expect(json.tables.parts.columns).toEqual(["_id", "tag"]);
  });
});
