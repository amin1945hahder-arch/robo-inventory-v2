/**
 * Shared print plumbing for the sheet pages (Print labels + Export studio).
 *
 * The screen preview is a *scaled* paper: mm values are mapped through the
 * CSS var `--mm` (px per mm at the preview zoom) and scaled cells render at
 * true mm then shrink by a transform. Printing must undo that scale and lay
 * the sheet out at true physical size, with NO leftover app-shell layout
 * (which used to print as extra blank pages — "too many papers").
 *
 * `sheetPrintCss()` emits one @media print block that:
 *  1. sizes @page from the oriented paper + the chosen margin (single
 *     source of truth — the sheet content starts exactly at the page margin,
 *     no double margin);
 *  2. removes everything except the sheet from the print flow (display:none
 *     on every node that is neither #print-area, its subtree, nor an ancestor
 *     of it) so pages contain only labels/cards/table rows;
 *  3. forces `--mm: 1mm` inside #print-area and removes the scaled-cell
 *     transform, so every mm() value and QR renders at its true size;
 *  4. lets long content paginate (no clipping, no page-break mid-label).
 *
 * The `:has()`-based isolation is wrapped in @supports so browsers without
 * it fall back to the older visibility-based rules in index.css instead of
 * printing a blank sheet.
 */

export type Orientation = "portrait" | "landscape";

export type SheetPrintOptions = {
  /** Paper in mm, portrait by convention (PAPERS entry). */
  paper: { w: number; h: number };
  orientation: Orientation;
  /** Page margin in mm — also the content inset (applied once, by @page). */
  marginMm: number;
};

/** Paper dims with width/height swapped for landscape. */
export function orientedSize(
  paper: { w: number; h: number },
  orientation: Orientation,
): { w: number; h: number } {
  return orientation === "landscape" ? { w: paper.h, h: paper.w } : { ...paper };
}

/** The full @media print block for one sheet page. */
export function sheetPrintCss({ paper, orientation, marginMm }: SheetPrintOptions): string {
  const { w, h } = orientedSize(paper, orientation);
  const margin = Math.max(0, marginMm);
  return `
@media print {
  @page { size: ${w}mm ${h}mm; margin: ${margin}mm; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }

  /* Isolate the sheet: hide every node except #print-area, its subtree and
     its ancestors — the app shell stops contributing pages entirely. */
  @supports selector(:has(*)) {
    body *:not(#print-area):not(#print-area *):not(:has(#print-area)) { display: none !important; }
  }

  /* The paper wrapper: unclip, unborder, let content define page breaks. */
  :has(> #print-area) {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  /* True physical scale: mm() resolves to real mm, transforms are dropped,
     and the sheet starts at the page margin (no double margin). */
  #print-area {
    position: static !important;
    inset: auto !important;
    width: auto !important;
    max-width: none !important;
    height: auto !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    background: #fff !important;
    --mm: 1mm !important;
  }

  .no-print { display: none !important; }

  /* Rows/labels never split across pages; scaled cells print at true size. */
  #print-area .print-cell,
  #print-area .print-label,
  #print-area .print-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  #print-area .print-cell > div > div { transform: none !important; }
  #print-area section h2 { break-after: avoid; page-break-after: avoid; }
}
`;
}
