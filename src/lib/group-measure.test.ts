import { describe, expect, it } from "vitest";
import {
  describePackSize,
  formatLineAmount,
  isBulkMaterialGroup,
  isCountFlowGroup,
  isPackGroup,
  piecesInPacks,
  piecesInUnit,
  roundBulk,
  sumPiecesInUnits,
} from "./group-measure";

describe("isPackGroup", () => {
  it("is true only for measure 'pack'", () => {
    expect(isPackGroup({ measure: "pack", packSize: 40 })).toBe(true);
    expect(isPackGroup({ measure: "count" })).toBe(false);
    expect(isPackGroup({ measure: "weight" })).toBe(false);
    expect(isPackGroup({ measure: "length" })).toBe(false);
    expect(isPackGroup(null)).toBe(false);
    expect(isPackGroup(undefined)).toBe(false);
  });
});

describe("isCountFlowGroup", () => {
  it("treats count, pack and unmarked groups as count-flow", () => {
    expect(isCountFlowGroup({ measure: "count" })).toBe(true);
    expect(isCountFlowGroup({ measure: "pack", packSize: 10 })).toBe(true);
    expect(isCountFlowGroup({})).toBe(true);
    expect(isCountFlowGroup(null)).toBe(true);
  });

  it("excludes bulk material groups", () => {
    expect(isCountFlowGroup({ measure: "weight" })).toBe(false);
    expect(isCountFlowGroup({ measure: "length" })).toBe(false);
  });
});

describe("isBulkMaterialGroup", () => {
  it("is true only for weight/length", () => {
    expect(isBulkMaterialGroup({ measure: "weight" })).toBe(true);
    expect(isBulkMaterialGroup({ measure: "length" })).toBe(true);
    expect(isBulkMaterialGroup({ measure: "pack" })).toBe(false);
    expect(isBulkMaterialGroup({ measure: "count" })).toBe(false);
    expect(isBulkMaterialGroup(undefined)).toBe(false);
  });
});

describe("describePackSize", () => {
  it("formats pieces per pack", () => {
    expect(describePackSize({ measure: "pack", packSize: 40 })).toBe("40 pieces/pack");
    expect(describePackSize({ measure: "pack", packSize: 1 })).toBe("1 pieces/pack");
  });

  it("falls back when the pack size is missing", () => {
    expect(describePackSize({ measure: "pack" })).toBe("pack");
    expect(describePackSize({ measure: "pack", packSize: 0 })).toBe("pack");
  });

  it("is empty for non-pack groups", () => {
    expect(describePackSize({ measure: "count" })).toBe("");
    expect(describePackSize({ measure: "weight" })).toBe("");
    expect(describePackSize(null)).toBe("");
  });
});

describe("piecesInPacks", () => {
  it("multiplies packs by the pack size", () => {
    expect(piecesInPacks({ measure: "pack", packSize: 40 }, 3)).toBe("120 pieces");
    expect(piecesInPacks({ measure: "pack", packSize: 30 }, 1)).toBe("30 pieces");
  });

  it("rounds fractional packs to whole pieces", () => {
    expect(piecesInPacks({ measure: "pack", packSize: 3 }, 2)).toBe("6 pieces");
  });

  it("is empty for non-pack groups or invalid input", () => {
    expect(piecesInPacks({ measure: "count" }, 3)).toBe("");
    expect(piecesInPacks({ measure: "pack", packSize: 0 }, 3)).toBe("");
    expect(piecesInPacks({ measure: "pack", packSize: 40 }, Number.NaN)).toBe("");
  });
});

describe("piecesInUnit", () => {
  it("reads the per-pack amount ledger", () => {
    expect(piecesInUnit({ amountRemaining: "37" }, { measure: "pack", packSize: 40 })).toBe(37);
    expect(piecesInUnit({ amountRemaining: "0" }, { measure: "pack", packSize: 40 })).toBe(0);
    expect(piecesInUnit({ amountRemaining: 12 }, { measure: "pack", packSize: 40 })).toBe(12);
  });

  it("falls back to a full pack for legacy units without a ledger", () => {
    expect(piecesInUnit({}, { measure: "pack", packSize: 40 })).toBe(40);
    expect(piecesInUnit({ amountRemaining: null }, { measure: "pack", packSize: 25 })).toBe(25);
  });

  it("is 0 without any pack size information", () => {
    expect(piecesInUnit({}, { measure: "pack" })).toBe(0);
    expect(piecesInUnit({}, null)).toBe(0);
  });
});

describe("sumPiecesInUnits", () => {
  it("sums the pieces inside every pack", () => {
    const g = { measure: "pack" as const, packSize: 40 };
    expect(
      sumPiecesInUnits(
        [{ amountRemaining: "40" }, { amountRemaining: "12" }, { amountRemaining: "0" }],
        g,
      ),
    ).toBe(52);
  });

  it("mixes legacy full packs with ledgered ones", () => {
    const g = { measure: "pack" as const, packSize: 30 };
    expect(sumPiecesInUnits([{}, { amountRemaining: "10" }], g)).toBe(40);
  });

  it("is 0 for an empty list", () => {
    expect(sumPiecesInUnits([], { measure: "pack", packSize: 40 })).toBe(0);
  });
});

describe("roundBulk", () => {
  it("trims float noise from ledger sums", () => {
    expect(roundBulk(1.1 + 2.2)).toBe(3.3);
    expect(roundBulk(0.1 + 0.2)).toBe(0.3);
    expect(roundBulk(2)).toBe(2);
    expect(roundBulk(0.005)).toBe(0.01);
  });
});

describe("formatLineAmount", () => {
  it("formats bulk lines as amount + measure unit", () => {
    expect(formatLineAmount({ count: 2.5 }, { measure: "weight", measureUnit: "kg" })).toBe("2.5 kg");
    expect(formatLineAmount({ count: 120 }, { measure: "length", measureUnit: "cm" })).toBe("120 cm");
    expect(formatLineAmount({ count: 2.555 }, { measure: "length", measureUnit: "m" })).toBe("2.56 m");
  });

  it("falls back to a plain number without a unit", () => {
    expect(formatLineAmount({ count: 1.25 }, { measure: "weight" })).toBe("1.25");
    expect(formatLineAmount({ count: 3 }, null)).toBe("3×");
  });

  it("formats count/pack lines as N×", () => {
    expect(formatLineAmount({ count: 3 }, { measure: "count" })).toBe("3×");
    expect(formatLineAmount({ count: 2 }, { measure: "pack", packSize: 40 })).toBe("2×");
    expect(formatLineAmount({ count: 2.7 }, { measure: "count" })).toBe("3×");
  });

  it("reads server list lines where the amount is named requested", () => {
    // listPackages/getPackage lines carry the amount as `requested`; before
    // this fallback every package row outside the dialogs rendered "0×".
    expect(formatLineAmount({ requested: 4 }, { measure: "count" })).toBe("4×");
    expect(formatLineAmount({ requested: 2.5 }, { measure: "weight", measureUnit: "kg" })).toBe("2.5 kg");
    expect(formatLineAmount({}, { measure: "count" })).toBe("0×");
  });
});
