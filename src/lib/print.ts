/**
 * Shared print plumbing for the sheet pages (Print labels + Export studio).
 *
 * Page model: the print surface renders N explicit `.print-page` divs, each
 * one physical sheet — inline width/height/padding in mm() units (which the
 * print block forces to true mm via `--mm: 1mm`), with `break-after: page`
 * between them. `@page` carries the paper size with **zero margin** so the
 * page's own padding is the single source of truth for the content inset
 * (no double margin, and the number of printed pages equals the number of
 * `.print-page` divs — what you preview is exactly what prints).
 *
 * `.print-page--fixed`  → labels/cards: exact paper height, integer rows
 *                          per page (computed by the caller via
 *                          paginateRowRuns / fitOnSheet), clipped locally
 *                          so a rounding fraction can never spill onto an
 *                          extra sheet.
 * `.print-page--flow`   → tables: height grows with content, the browser
 *                          paginates rows naturally.
 *
 * The screen preview shows ONE page at a time (the others carry an inline
 * `display: none`); the print block forces `.print-page { display: block }`
 * back on — !important in the stylesheet wins over the inline style — so
 * every prepared page prints even when the preview is parked on page 1.
 *
 * `sheetPrintCss()` also:
 *  1. removes everything except #print-area from the print flow (the app
 *     shell stops contributing pages entirely);
 *  2. forces `--mm: 1mm` inside #print-area and drops the scaled-cell
 *     transform, so every mm() value and QR renders at true size;
 *  3. keeps labels/cards/rows whole across page breaks.
 */

export type Orientation = "portrait" | "landscape";

export type SheetPrintOptions = {
  /** Paper in mm, portrait by convention (PAPERS entry). */
  paper: { w: number; h: number };
  orientation: Orientation;
  /** Page margin in mm — applied once, as each .print-page's own padding. */
  marginMm: number;
};

/** Paper dims with width/height swapped for landscape. */
export function orientedSize(
  paper: { w: number; h: number },
  orientation: Orientation,
): { w: number; h: number } {
  return orientation === "landscape" ? { w: paper.h, h: paper.w } : { ...paper };
}

/** The full @media print block for the sheet pages. */
export function sheetPrintCss({ paper, orientation, marginMm }: SheetPrintOptions): string {
  const { w, h } = orientedSize(paper, orientation);
  const margin = Math.max(0, marginMm);
  return `
@media print {
  @page { size: ${w}mm ${h}mm; margin: 0; }
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

  /* True physical scale: mm() resolves to real mm, transforms are dropped. */
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

  /* Explicit page breaks: one .print-page div = one physical sheet. The
     inline display:none used by the on-screen pager is overridden here, so
     EVERY prepared page prints — not just the previewed one. */
  .print-page {
    display: block !important;
    position: relative !important;
    inset: auto !important;
    break-after: page !important;
    page-break-after: always !important;
    background: #fff !important;
  }
  .print-page:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }
  /* Fixed pages (labels/cards) are sized exactly — anything a rounding
     fraction could spill is clipped HERE instead of creating an extra
     half-empty sheet. */
  .print-page--fixed { overflow: hidden !important; }
  .print-page--flow { overflow: visible !important; }

  /* Screen-only preview chunks never print; the print-only full copies do. */
  .preview-only { display: none !important; }
  .print-full { display: block !important; }

  .no-print { display: none !important; }

  /* Rows/labels never split across pages; scaled cells print at true size. */
  #print-area .print-cell,
  #print-area .print-label,
  #print-area .print-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  #print-area tr { break-inside: avoid !important; page-break-inside: avoid !important; }
  #print-area .print-cell > div > div { transform: none !important; }
  #print-area section h2 { break-after: avoid; page-break-after: avoid; }
}
`;
}

// ---------------------------------------------------------------------------
// Row pagination: integer rows per page, never a trimmed half-row.
// ---------------------------------------------------------------------------

export type RowRun = { sectionId: string; fromRow: number; rowCount: number };

/**
 * Pack section rows into pages of at most `usableH` mm.
 *
 * Every row is a fixed-pitch block (`rowPitch` = row height + gap); a section
 * header (`headerH`) is charged on the first row of the section on each page
 * (so a section continued onto a new page repeats its header), and
 * `sectionGapMm` separates different sections on the same page.
 *
 * Guarantees:
 *  - rows are assigned to exactly one page, in order;
 *  - a page never exceeds usableH (unless a single header+row is taller than
 *    the whole printable area — degenerate config the caller must clamp);
 *  - no partial rows: pages break BETWEEN rows only.
 */
export function paginateRowRuns(
  sections: { id: string; rows: number; rowPitch: number; headerH?: number }[],
  usableH: number,
  opts: { sectionGapMm?: number } = {},
): RowRun[][] {
  const gap = opts.sectionGapMm ?? 0;
  const pages: RowRun[][] = [];
  let page: RowRun[] = [];
  let used = 0;

  const flush = () => {
    if (page.length > 0) {
      pages.push(page);
      page = [];
      used = 0;
    }
  };
  const pushRun = (sectionId: string, fromRow: number) => {
    const last = page[page.length - 1];
    if (last && last.sectionId === sectionId && last.fromRow + last.rowCount === fromRow) {
      last.rowCount += 1;
    } else {
      page.push({ sectionId, fromRow, rowCount: 1 });
    }
  };

  for (const s of sections) {
    if (s.rows <= 0) continue;
    const headerH = s.headerH ?? 0;
    for (let r = 0; r < s.rows; r++) {
      const continues =
        page.length > 0 && page[page.length - 1].sectionId === s.id;
      const need =
        (continues ? 0 : (page.length > 0 ? gap : 0) + headerH) + s.rowPitch;
      if (used + need > usableH && page.length > 0) flush();
      const stillContinues =
        page.length > 0 && page[page.length - 1].sectionId === s.id;
      used += (stillContinues ? 0 : headerH) + s.rowPitch;
      pushRun(s.id, r);
    }
  }
  flush();
  return pages;
}
