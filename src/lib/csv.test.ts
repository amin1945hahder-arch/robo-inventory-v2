import { describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import { downloadCsv, toCsv } from "@/lib/csv";

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

  it("round-trips Arabic text (quotes, commas, newlines) through a CSV parser", () => {
    const rows = [
      ["الاسم", "الوصف"],
      ["روبوت مصنوع يدويًا", 'قطعة, مع "اقتباس" وسطر\nثاني'],
    ];
    const csv = toCsv(rows);
    // Real UTF-8 BOM as the very first byte — without it Excel shows mojibake.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
      skipEmptyLines: true,
    });
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.data[0]).toEqual(rows[0]);
    expect(parsed.data[1]).toEqual(rows[1]);
  });
});

describe("downloadCsv", () => {
  it("forces the BOM and defers the object-URL revoke", () => {
    vi.useFakeTimers();
    const blobs: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: unknown[]) {
          blobs.push(String(parts[0]));
        }
      },
    );
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    (globalThis.URL as any).createObjectURL = createObjectURL;
    (globalThis.URL as any).revokeObjectURL = revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    try {
      // Hand-built CSV without a BOM still ships with one (Arabic-safe).
      downloadCsv("a.csv", '"الاسم"');
      expect(blobs[0].charCodeAt(0)).toBe(0xfeff);
      // An existing BOM is never doubled.
      downloadCsv("b.csv", "\uFEFFkeep");
      expect(blobs[1]).toBe("\uFEFFkeep");
      // Synchronous revoke can truncate downloads on Android WebView —
      // the URL must still be alive right after click().
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
      expect(click).toHaveBeenCalled();
    } finally {
      click.mockRestore();
      delete (globalThis.URL as any).createObjectURL;
      delete (globalThis.URL as any).revokeObjectURL;
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
