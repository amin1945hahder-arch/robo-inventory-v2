import { describe, expect, it } from "vitest";
import { orientedSize, sheetPrintCss } from "./print";

describe("orientedSize", () => {
  it("keeps portrait dims as-is and swaps for landscape", () => {
    const a4 = { w: 210, h: 297 };
    expect(orientedSize(a4, "portrait")).toEqual({ w: 210, h: 297 });
    expect(orientedSize(a4, "landscape")).toEqual({ w: 297, h: 210 });
  });
});

describe("sheetPrintCss", () => {
  const css = sheetPrintCss({ paper: { w: 210, h: 297 }, orientation: "landscape", marginMm: 8 });

  it("sizes @page from the ORIENTED paper with a single margin", () => {
    // Landscape A4 → 297mm wide × 210mm tall; margin applied once by @page.
    expect(css).toContain("@page { size: 297mm 210mm; margin: 8mm; }");
    const portrait = sheetPrintCss({
      paper: { w: 210, h: 297 },
      orientation: "portrait",
      marginMm: 12,
    });
    expect(portrait).toContain("@page { size: 210mm 297mm; margin: 12mm; }");
  });

  it("removes the app shell from the print flow (no blank pages)", () => {
    expect(css).toContain("@supports selector(:has(*))");
    expect(css).toContain(
      "body *:not(#print-area):not(#print-area *):not(:has(#print-area)) { display: none !important; }",
    );
    // The sheet subtree itself must never be display:none'd.
    expect(css).not.toMatch(/#print-area \* \{ display: none/);
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
});
