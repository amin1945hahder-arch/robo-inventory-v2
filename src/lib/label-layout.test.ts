import { describe, expect, it } from "vitest";
import {
  computeColumns,
  DEFAULT_SIZES,
  HORIZONTAL_WIDTH_FACTOR,
  LABEL_GAP_MM,
  type SectionKey,
  type SectionSizes,
} from "@/lib/label-layout";
import { PAPERS } from "@/lib/label-layout";

describe("label sheet layout", () => {
  it("uses the widest shown size as the column basis", () => {
    const sizes: SectionSizes = { ...DEFAULT_SIZES, groups: 50, units: 12 };
    const basis = computeColumns("groups", sizes).basisMm;
    expect(basis).toBeGreaterThan(50 * HORIZONTAL_WIDTH_FACTOR);
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
});
