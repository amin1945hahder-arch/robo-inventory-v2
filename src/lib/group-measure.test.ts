import { describe, expect, it } from "vitest";
import {
  describePackSize,
  isBulkMaterialGroup,
  isCountFlowGroup,
  isPackGroup,
  piecesInPacks,
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
