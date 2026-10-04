import { describe, expect, it } from "vitest";
import { orientedSize, paginateRowRuns, sheetPrintCss } from "./print";

describe("orientedSize", () => {
  it("keeps portrait dims as-is and swaps for landscape", () => {
    const a4 = { w: 210, h: 297 };
    expect(orientedSize(a4, "portrait")).toEqual({ w: 210, h: 297 });
    expect(orientedSize(a4, "landscape")).toEqual({ w: 297, h: 210 });
  });
});

describe("sheetPrintCss", () => {
  const css = sheetPrintCss({ paper: { w: 210, h: 297 }, orientation: "landscape", marginMm: 8 });

  it("sizes @page from the ORIENTED paper with zero margin (pages carry their own)", () => {
    // Landscape A4 → 297mm wide × 210mm tall; the content inset is each
    // .print-page's own padding, so @page must not add a second margin.
    expect(css).toContain("@page { size: 297mm 210mm; margin: 0; }");
    const portrait = sheetPrintCss({
      paper: { w: 210, h: 297 },
      orientation: "portrait",
      marginMm: 12,
    });
    expect(portrait).toContain("@page { size: 210mm 297mm; margin: 0; }");
  });

  it("removes the app shell from the print flow (no blank pages)", () => {
    expect(css).toContain("@supports selector(:has(*))");
    expect(css).toContain(
      "body *:not(#print-area):not(#print-area *):not(:has(#print-area)) { display: none !important; }",
    );
    // The sheet subtree itself must never be display:none'd.
    expect(css).not.toMatch(/#print-area \* \{ display: none/);
  });

  it("unclips EVERY ancestor of the sheet (the one-page-print bug)", () => {
    // The AppShell roots are `h-dvh overflow-hidden` / `h-dvh overflow-y-auto`.
    // They are ancestors of #print-area, so if they keep their bounded height
    // in print the whole workbook is trapped on printed page 1 — only the
    // first sheet comes out. The full ancestor chain must be opened up.
    expect(css).toContain("body :has(#print-area) {");
    const ancestors = css.match(/body :has\(#print-area\) \{[^}]*\}/s)?.[0] ?? "";
    expect(ancestors).toContain("height: auto !important;");
    expect(ancestors).toContain("max-height: none !important;");
    expect(ancestors).toContain("overflow: visible !important;");
    // Shell padding (main px-4, page gap wrappers…) must not offset or
    // narrow the fixed-width sheet — it would overflow the paper box.
    expect(ancestors).toContain("padding: 0 !important;");
    expect(ancestors).toContain("margin: 0 !important;");
  });

  it("forces true physical scale inside the sheet", () => {
    expect(css).toContain("--mm: 1mm !important");
    expect(css).toContain("#print-area .print-cell > div > div { transform: none !important; }");
    // The sheet must not be clipped to the preview's one-page height.
    expect(css).toContain("overflow: visible !important");
  });

  it("keeps labels/cards whole across page breaks", () => {
    expect(css).toContain("#print-area .print-label");
    expect(css).toContain("page-break-inside: avoid !important");
  });

  it("breaks after EVERY .print-page and re-shows pages the preview hid", () => {
    // One div = one sheet; the pager hides inactive pages inline, and this
    // !important rule beats that inline display:none at print time.
    expect(css).toContain(".print-page {");
    expect(css).toContain("display: block !important;");
    expect(css).toContain("break-after: page !important;");
    expect(css).toContain(".print-page:last-child {");
    expect(css).toContain("break-after: auto !important;");
    // Fixed pages clip rounding spill instead of adding a half-empty sheet;
    // flow pages (tables) keep their natural overflow.
    expect(css).toContain(".print-page--fixed { overflow: hidden !important; }");
    expect(css).toContain(".print-page--flow { overflow: visible !important; }");
    // Screen-only preview chunks never print; print-only copies do.
    expect(css).toContain(".preview-only { display: none !important; }");
    expect(css).toContain(".print-full { display: block !important; }");
  });
});

describe("paginateRowRuns", () => {
  const A = { id: "a", rows: 10, rowPitch: 20, headerH: 6 };

  it("returns an empty plan for no sections", () => {
    expect(paginateRowRuns([], 281)).toEqual([]);
    expect(paginateRowRuns([{ id: "a", rows: 0, rowPitch: 20 }], 281)).toEqual([]);
  });

  it("packs rows with integer per-page counts (10 rows × 20mm on 211mm usable)", () => {
    // header 6 + 10×20 = 206 ≤ 211 → exactly one page.
    expect(paginateRowRuns([A], 211)).toEqual([[{ sectionId: "a", fromRow: 0, rowCount: 10 }]]);
    // 200 usable: header 6 + 9×20 = 186 ≤ 200, +20 = 206 > 200 → 9 + 1.
    const pages = paginateRowRuns([A], 200);
    expect(pages).toEqual([
      [{ sectionId: "a", fromRow: 0, rowCount: 9 }],
      [{ sectionId: "a", fromRow: 9, rowCount: 1 }],
    ]);
  });

  it("assigns every row exactly once, in order", () => {
    const pages = paginateRowRuns(
      [
        { id: "a", rows: 7, rowPitch: 15, headerH: 5 },
        { id: "b", rows: 5, rowPitch: 25, headerH: 8 },
      ],
      120,
      { sectionGapMm: 6 },
    );
    const flat = pages
      .flat()
      .flatMap((run) =>
        Array.from({ length: run.rowCount }, (_, i) => `${run.sectionId}:${run.fromRow + i}`),
      );
    expect(flat).toEqual([
      ...Array.from({ length: 7 }, (_, i) => `a:${i}`),
      ...Array.from({ length: 5 }, (_, i) => `b:${i}`),
    ]);
  });

  it("never exceeds the usable height (rows are whole or moved to the next page)", () => {
    const sections = [
      { id: "a", rows: 23, rowPitch: 12.5, headerH: 6 },
      { id: "b", rows: 9, rowPitch: 30, headerH: 7 },
    ];
    const usable = 250;
    const pages = paginateRowRuns(sections, usable, { sectionGapMm: 6 });
    for (const page of pages) {
      let used = 0;
      for (let i = 0; i < page.length; i++) {
        const run = page[i];
        const section = sections.find((s) => s.id === run.sectionId)!;
        const first = i === 0 || page[i - 1].sectionId !== run.sectionId;
        if (first && i > 0) used += 6; // section gap
        if (first) used += section.headerH;
        used += run.rowCount * section.rowPitch;
      }
      expect(used).toBeLessThanOrEqual(usable);
    }
  });

  it("repeats the section header when a section continues on the next page", () => {
    const pages = paginateRowRuns([{ id: "a", rows: 6, rowPitch: 40, headerH: 6 }], 200);
    expect(pages.length).toBeGreaterThan(1);
    // Every page's first run belongs to the section (header is charged again).
    for (const page of pages) expect(page[0].sectionId).toBe("a");
  });

  it("separates sections on one page with the configured gap", () => {
    // 6 + 2×20 (a) + 6 gap + 6 header + 20 (b) = 78 ≤ 80 → one page, both.
    const pages = paginateRowRuns(
      [
        { id: "a", rows: 2, rowPitch: 20, headerH: 6 },
        { id: "b", rows: 1, rowPitch: 20, headerH: 6 },
      ],
      80,
      { sectionGapMm: 6 },
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].map((r) => r.sectionId)).toEqual(["a", "b"]);
  });

  it("starts a new page when the next section's header + row does not fit", () => {
    // 6 + 20 = 26 used by a; b needs 6 gap + 6 header + 20 = 32 > 30 usable.
    const pages = paginateRowRuns(
      [
        { id: "a", rows: 1, rowPitch: 20, headerH: 6 },
        { id: "b", rows: 1, rowPitch: 20, headerH: 6 },
      ],
      30,
      { sectionGapMm: 6 },
    );
    expect(pages).toHaveLength(2);
    expect(pages[0][0].sectionId).toBe("a");
    expect(pages[1][0].sectionId).toBe("b");
  });
});
