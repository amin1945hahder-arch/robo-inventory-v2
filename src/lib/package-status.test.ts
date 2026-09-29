import { describe, expect, it } from "vitest";
import { packageDisplayStatus } from "@/lib/package-status";

const counts = (approvedUnits = 0, activeUnits = 0, returnedUnits = 0) => ({
  approvedUnits,
  activeUnits,
  returnedUnits,
});

describe("packageDisplayStatus", () => {
  it("shows returned once every unit has been processed", () => {
    // The bug this helper exists for: a fully returned package still carries
    // status "approved" in the database and must not render as Active.
    expect(packageDisplayStatus("approved", counts(0, 0, 4))).toBe("returned");
  });

  it("shows active while any unit is still out with the member", () => {
    expect(packageDisplayStatus("approved", counts(0, 2, 1))).toBe("active");
  });

  it("shows approved · pick up when nothing is out but units await hand-over", () => {
    expect(packageDisplayStatus("approved", counts(3, 0, 0))).toBe("approved");
  });

  it("prefers active over approved when units are mixed (out + awaiting)", () => {
    expect(packageDisplayStatus("approved", counts(1, 1, 1))).toBe("active");
  });

  it("treats an approved package with zero attached units as finished", () => {
    expect(packageDisplayStatus("approved", counts(0, 0, 0))).toBe("returned");
  });

  it("maps pending and canceled packages straight through", () => {
    expect(packageDisplayStatus("pending", counts(0, 0, 0))).toBe("pending");
    expect(packageDisplayStatus("canceled", counts(0, 0, 0))).toBe("canceled");
  });

  it("falls back to canceled for unknown statuses", () => {
    expect(packageDisplayStatus(undefined, counts(0, 0, 0))).toBe("canceled");
    expect(packageDisplayStatus("weird", counts(0, 0, 0))).toBe("canceled");
  });
});
