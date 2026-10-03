import { describe, expect, it } from "vitest";
import {
  computeColumns,
  DEFAULT_SIZES,
  fitOnSheet,
  HORIZONTAL_WIDTH_FACTOR,
  labelWidthMm,
  LABEL_GAP_MM,
  type SectionSizes,
} from "@/lib/label-layout";
import { PAPERS } from "@/lib/label-layout";

describe("label sheet layout", () => {
  it("uses the EXACT label width as the column basis (no wasted padding)", () => {
    const sizes: SectionSizes = { ...DEFAULT_SIZES, groups: 50, units: 12 };
    const basis = computeColumns("groups", sizes).basisMm;
    // The column is exactly the label width — anything larger pushed labels
    // onto extra sheets instead of filling the paper.
    expect(basis).toBeCloseTo(50 * HORIZONTAL_WIDTH_FACTOR, 2);
    expect(basis).toBe(labelWidthMm(50));
  });

  it("scales the basis when a section size grows (no overlap after resize)", () => {
    const small = computeColumns("units", { ...DEFAULT_SIZES, units: 15 }).basisMm;
    const large = computeColumns("units", { ...DEFAULT_SIZES, units: 40 }).basisMm;
    expect(large).toBeGreaterThan(small);
    // basis grows linearly with the size factor, not a fixed constant
    expect(large - small).toBeGreaterThan((40 - 15) * (HORIZONTAL_WIDTH_FACTOR - 1));
  });

  it("small stacked labels get a compact basis (qr + gap, not the horizontal width)", () => {
    const sizes: SectionSizes = { ...DEFAULT_SIZES, units: 12 };
    const basis = computeColumns("units", sizes).basisMm;
    expect(basis).toBeGreaterThanOrEqual(12 + LABEL_GAP_MM);
    expect(basis).toBeLessThan(12 * HORIZONTAL_WIDTH_FACTOR);
  });

  it("computes columns that fit inside the printable width of the paper", () => {
    const paper = PAPERS.a4; // 210mm wide
    const margin = 8;
    const printable = paper.w - margin * 2;
    const { columns, basisMm } = computeColumns("units", { ...DEFAULT_SIZES, units: 15 }, {
      paperWidthMm: paper.w,
      marginMm: margin,
    });
    expect(printable).toBeGreaterThan(0);
    expect(columns).toBeGreaterThanOrEqual(1);
    // columns of the basis width (+ gap) must fit the printable area
    expect(columns * basisMm + (columns - 1) * LABEL_GAP_MM).toBeLessThanOrEqual(printable + 0.01);
  });

  it("keeps at least one column even for huge labels on small paper", () => {
    const { columns } = computeColumns(
      "closets",
      { ...DEFAULT_SIZES, closets: 50 },
      { paperWidthMm: PAPERS.a4.w, marginMm: 25 },
    );
    expect(columns).toBeGreaterThanOrEqual(1);
  });

  it("defaults cover every section", () => {
    const sections = ["closets", "categories", "projects", "groups", "units"] as const;
    for (const s of sections) expect(DEFAULT_SIZES[s]).toBeGreaterThan(0);
  });

  it("fills the printable width: the leftover can never hold another label", () => {
    for (const size of [15, 25, 40, 60]) {
      const { columns, basisMm } = computeColumns("units", { ...DEFAULT_SIZES, units: size }, {
        paperWidthMm: PAPERS.a4.w,
        marginMm: 8,
      });
      const used = columns * basisMm + (columns - 1) * LABEL_GAP_MM;
      const printable = PAPERS.a4.w - 16;
      expect(used).toBeLessThanOrEqual(printable + 0.01);
      // one more column would not fit → the row is genuinely full
      expect(used + LABEL_GAP_MM + basisMm).toBeGreaterThan(printable);
    }
  });

  it("packs the whole sheet (columns × rows) for the physical label size", () => {
    // 15mm stacked unit tags on A4, 8mm margins: 19mm wide / 24mm tall cells.
    const fit = fitOnSheet(15, { paperWidthMm: 210, paperHeightMm: 297, marginMm: 8 });
    expect(fit.columns).toBe(9); // 9×19 + 8×2 = 187 ≤ 194mm printable
    expect(fit.rows).toBe(10); // 10×24 + 9×2 = 258 ≤ 281mm printable
    expect(fit.perSheet).toBe(90);
    // Landscape swaps what fits (wider, shorter).
    const land = fitOnSheet(15, { paperWidthMm: 297, paperHeightMm: 210, marginMm: 8 });
    expect(land.columns).toBeGreaterThan(fit.columns);
    expect(land.rows).toBeLessThan(fit.rows);
  });

  it("keeps at least one label per sheet even with huge margins", () => {
    const fit = fitOnSheet(60, { paperWidthMm: 210, paperHeightMm: 297, marginMm: 60 });
    expect(fit.columns).toBeGreaterThanOrEqual(1);
    expect(fit.rows).toBeGreaterThanOrEqual(1);
  });
});
