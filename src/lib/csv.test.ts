import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("CSV serialization", () => {
  it("quotes fields and joins rows with newlines", () => {
    const csv = toCsv([
      ["Section", "Title"],
      ["unit", "ARD-001"],
    ]);
    expect(csv).toContain('"Section","Title"');
    expect(csv).toContain('"unit","ARD-001"');
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("escapes embedded quotes per RFC 4180", () => {
    const csv = toCsv([['note with "quotes"']]);
    expect(csv).toContain('"note with ""quotes"""');
  });

  it("escapes embedded commas", () => {
    const csv = toCsv([["a,b", "c"]]);
    expect(csv).toContain('"a,b","c"');
  });

  it("stringifies numbers and prefixes a UTF-8 BOM for Excel", () => {
    const csv = toCsv([["qty", 3]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"qty","3"');
  });
});
