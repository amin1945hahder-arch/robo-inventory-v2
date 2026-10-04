import { describe, expect, it } from "vitest";
import {
  TURSO_TOKEN,
  TURSO_URL,
  isShelfEventKind,
  readTursoConfig,
  shelfEventLabel,
  summarizeShelfEvents,
  toShelfEvent,
  tursoDatabaseName,
  type ShelfEvent,
} from "./turso";

const good = {
  [TURSO_URL]: "libsql://roboshelf-abc123.turso.io",
  [TURSO_TOKEN]: "eyJhbGciOi.turso.token",
};

describe("turso configuration", () => {
  it("accepts a complete pair of keys", () => {
    const res = readTursoConfig(good);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.config.url).toBe(good[TURSO_URL]);
  });

  it("names the missing key instead of throwing", () => {
    expect(readTursoConfig({})).toEqual({
      ok: false,
      problem: `${TURSO_URL} is not set`,
    });
    expect(readTursoConfig({ [TURSO_URL]: "  " })).toEqual({
      ok: false,
      problem: `${TURSO_URL} is not set`,
    });
    expect(readTursoConfig({ [TURSO_URL]: good[TURSO_URL] })).toEqual({
      ok: false,
      problem: `${TURSO_TOKEN} is not set`,
    });
  });

  it("rejects a URL that is not a Turso/libSQL endpoint", () => {
    const res = readTursoConfig({ ...good, [TURSO_URL]: "postgres://x/y" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problem).toContain("must start with");
  });

  it("accepts https and wss endpoints", () => {
    for (const url of [
      "https://db.turso.io",
      "wss://db.turso.io",
      "libsql://db.turso.io",
    ]) {
      expect(readTursoConfig({ ...good, [TURSO_URL]: url }).ok).toBe(true);
    }
  });

  it("trims pasted values", () => {
    const res = readTursoConfig({
      [TURSO_URL]: `  ${good[TURSO_URL]}  `,
      [TURSO_TOKEN]: "  tok  ",
    });
    expect(res.ok && res.config.authToken).toBe("tok");
  });

  it("derives a short database name for display", () => {
    expect(tursoDatabaseName("libsql://roboshelf-abc123.turso.io")).toBe("roboshelf");
    // A host without an organisation suffix is already the database name.
    expect(tursoDatabaseName("https://db.turso.io/?authToken=x")).toBe("db.turso.io");
    expect(tursoDatabaseName("libsql://shelf-myorg.turso.io")).toBe("shelf");
  });
});

describe("shelf ledger", () => {
  it("normalises a draft into a storable row", () => {
    const row = toShelfEvent({
      kind: "rented",
      at: 1700,
      partTag: "  MTR-04 ",
      partName: undefined,
      member: "Ali",
      note: "   ",
    });
    expect(row).toEqual({
      at: 1700,
      kind: "rented",
      partTag: "MTR-04",
      partName: "",
      member: "Ali",
      note: "",
    });
    expect(toShelfEvent({ kind: "returned" }).at).toBe(0);
  });

  it("caps free text so one row can never blow up the table", () => {
    const row = toShelfEvent({ kind: "returned", note: "x".repeat(500) });
    expect(row.note.length).toBe(200);
  });

  it("labels known kinds and passes unknown ones through", () => {
    expect(shelfEventLabel("rented")).toBe("Taken out");
    expect(shelfEventLabel("mystery")).toBe("mystery");
    expect(isShelfEventKind("rented")).toBe(true);
    expect(isShelfEventKind("mystery")).toBe(false);
  });

  const rows: ShelfEvent[] = [
    { at: 300, kind: "rented", partTag: "A", partName: "", member: "Ali", note: "" },
    { at: 100, kind: "rented", partTag: "B", partName: "", member: "Sara", note: "" },
    { at: 200, kind: "returned", partTag: "A", partName: "", member: "Ali", note: "" },
  ];

  it("summarises rows: totals, distinct parts/members, time span", () => {
    const s = summarizeShelfEvents(rows);
    expect(s.total).toBe(3);
    expect(s.uniqueParts).toBe(2);
    expect(s.uniqueMembers).toBe(2);
    expect(s.firstAt).toBe(100);
    expect(s.lastAt).toBe(300);
  });

  it("ranks kinds by count then by label", () => {
    const s = summarizeShelfEvents(rows);
    expect(s.byKind).toEqual([
      { kind: "rented", label: "Taken out", count: 2 },
      { kind: "returned", label: "Returned", count: 1 },
    ]);
  });

  it("handles an empty ledger and rows without timestamps", () => {
    const empty = summarizeShelfEvents([]);
    expect(empty).toMatchObject({
      total: 0,
      byKind: [],
      uniqueParts: 0,
      uniqueMembers: 0,
      lastAt: null,
      firstAt: null,
    });
    expect(summarizeShelfEvents([{ ...rows[0], at: 0 }]).lastAt).toBe(null);
  });
});