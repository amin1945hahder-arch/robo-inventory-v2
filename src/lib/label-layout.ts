/**
 * Shared layout math for the QR label sheet (Print labels page).
 * Extracted so the page and the tests agree on exactly how wide a label is
 * and how many columns fit the paper — the source of the old overlap bug.
 */

export type SectionKey = "all" | "closets" | "categories" | "projects" | "groups" | "units";

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

/** Extra padding (borders) around a label, in mm. */
export const LABEL_PAD_MM = 4;

/** Gap between grid columns, in mm. */
export const LABEL_GAP_MM = 2;

export const SIZE_OPTIONS = [12, 15, 18, 20, 25, 30, 40, 50] as const;

export const DEFAULT_SIZES: SectionSizes = {
  closets: 30,
  categories: 25,
  projects: 25,
  groups: 20,
  units: 15,
};

/** Physical width of a label of `sizeMm`, in mm. */
export function labelWidthMm(sizeMm: number) {
  if (sizeMm >= HORIZONTAL_MIN_MM) return sizeMm * HORIZONTAL_WIDTH_FACTOR;
  return sizeMm; // stacked layout: the label is the QR square wide
}

export function labelHeightMm(sizeMm: number) {
  return sizeMm + LABEL_PAD_MM;
}

export type LayoutOptions = {
  /** Paper width in mm (default A4 portrait width). */
  paperWidthMm?: number;
  /** Page margin in mm on each side. */
  marginMm?: number;
};

/**
 * Grid description for one sheet:
 *  - `basisMm`: the widest label width among the shown sections (+ padding),
 *    so a column can always hold its label — no overlap when sizes change.
 *  - `columns`: how many such columns fit the printable width (≥ 1).
 */
export function computeColumns(
  section: Exclude<SectionKey, "all">,
  sizes: SectionSizes,
  { paperWidthMm = PAPERS.a4.w, marginMm = 8 }: LayoutOptions = {},
): { basisMm: number; columns: number } {
  const widest = sizes[section];
  const basis = labelWidthMm(widest) + LABEL_PAD_MM;
  const printable = Math.max(paperWidthMm - marginMm * 2, 0);
  const columns = Math.max(1, Math.floor((printable + LABEL_GAP_MM) / (basis + LABEL_GAP_MM)));
  return { basisMm: Math.round(basis * 100) / 100, columns };
}
