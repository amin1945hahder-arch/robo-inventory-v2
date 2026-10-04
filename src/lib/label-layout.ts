/**
 * Shared layout math for the QR label sheet (Print labels page).
 * Extracted so the page and the tests agree on exactly how wide a label is
 * and how many columns fit the paper — the source of the old overlap bug.
 */

export type SectionKey =
  | "all"
  | "closets"
  | "categories"
  | "projects"
  | "groups"
  | "units"
  | "people";

export type SectionSizes = Record<Exclude<SectionKey, "all">, number>;

export const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  a4: { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
  a3: { label: "A3 (297 × 420 mm)", w: 297, h: 420 },
  letter: { label: "US Letter (216 × 279 mm)", w: 216, h: 279 },
};

/** Labels ≥ this size lay the text beside the QR (horizontal); smaller stack. */
export const HORIZONTAL_MIN_MM = 18;

/** Horizontal label width = QR square + the same square × this factor for text. */
export const HORIZONTAL_WIDTH_FACTOR = 2.35;

/** Stacked (< 18mm) labels get a slim text strip under the QR — in mm — so
 *  the tag text is legible without stealing room from the QR square. */
export const STACKED_TEXT_STRIP_MM = 5;

/** Extra padding (borders) around a label, in mm. */
export const LABEL_PAD_MM = 4;

/** Gap between grid columns, in mm. */
export const LABEL_GAP_MM = 2;

export const SIZE_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;

export const DEFAULT_SIZES: SectionSizes = {
  closets: 30,
  categories: 25,
  projects: 25,
  groups: 20,
  units: 15,
  people: 20,
};

/** Physical width of a label of `sizeMm`, in mm. */
export function labelWidthMm(sizeMm: number) {
  if (sizeMm >= HORIZONTAL_MIN_MM) return sizeMm * HORIZONTAL_WIDTH_FACTOR;
  // stacked layout: the label is the QR square wide + padding on both sides
  return sizeMm + LABEL_PAD_MM;
}

export function labelHeightMm(sizeMm: number) {
  if (sizeMm >= HORIZONTAL_MIN_MM) return sizeMm + LABEL_PAD_MM;
  // stacked: QR square + text strip + padding, so the text never rides on
  // top of the QR (the old bug below 18 mm)
  return sizeMm + STACKED_TEXT_STRIP_MM + LABEL_PAD_MM;
}

export type LayoutOptions = {
  /** Paper width in mm (default A4 portrait width). */
  paperWidthMm?: number;
  /** Page margin in mm on each side. */
  marginMm?: number;
};

/**
 * Grid description for one sheet:
 *  - `basisMm`: the EXACT label width for the section — the grid column is
 *    exactly this wide, so a sheet packs the maximum number of columns with
 *    only the cut gap between them (the old +4mm padding wasted 1–2 columns
 *    per row and pushed labels onto extra pages).
 *  - `columns`: how many of those columns fit the printable width (≥ 1).
 */
export function computeColumns(
  section: Exclude<SectionKey, "all">,
  sizes: SectionSizes,
  { paperWidthMm = PAPERS.a4.w, marginMm = 8 }: LayoutOptions = {},
): { basisMm: number; columns: number } {
  const basis = labelWidthMm(sizes[section]);
  const printable = Math.max(paperWidthMm - marginMm * 2, 0);
  const columns = Math.max(1, Math.floor((printable + LABEL_GAP_MM) / (basis + LABEL_GAP_MM)));
  return { basisMm: Math.round(basis * 100) / 100, columns };
}

/** How many labels of `sizeMm` fill one sheet (columns × rows), plus the
 *  individual counts — drives the live “N per sheet” hint and the tests
 *  that guard paper usage. */
export function fitOnSheet(
  sizeMm: number,
  {
    paperWidthMm = PAPERS.a4.w,
    paperHeightMm = PAPERS.a4.h,
    marginMm = 8,
  }: LayoutOptions & { paperHeightMm?: number } = {},
): { columns: number; rows: number; perSheet: number } {
  const w = labelWidthMm(sizeMm);
  const h = labelHeightMm(sizeMm);
  const printableW = Math.max(paperWidthMm - marginMm * 2, 0);
  const printableH = Math.max(paperHeightMm - marginMm * 2, 0);
  const columns = Math.max(1, Math.floor((printableW + LABEL_GAP_MM) / (w + LABEL_GAP_MM)));
  const rows = Math.max(1, Math.floor((printableH + LABEL_GAP_MM) / (h + LABEL_GAP_MM)));
  return { columns, rows, perSheet: columns * rows };
}
