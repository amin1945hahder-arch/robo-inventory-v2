import { describe, expect, it } from "vitest";
import {
  BULK_RESTOCKS_ON_RETURN,
  PART_STATUS_BY_EVENT,
  SINGLE_TRANSITIONS,
  canTransition,
  decidePackageUnits,
  deductBulkAmount,
  packageBadgeStatus,
  partStatusAfterRelease,
  validateBulkRequest,
} from "@/lib/rental-lifecycle";

// ---------------------------------------------------------------------------
// Single-rental lifecycle
// ---------------------------------------------------------------------------

describe("single rental transitions", () => {
  it("approval stops at approved — the hand-over is a separate admin step", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    // The bug that showed approved bundles as "active": nothing may jump
    // pending → active without the physical hand-over.
    expect(canTransition("pending", "active")).toBe(false);
  });

  it("hand-over is the only path to active, then return / project", () => {
    expect(canTransition("approved", "active")).toBe(true);
    expect(canTransition("active", "returned")).toBe(true);
    expect(canTransition("active", "on_project")).toBe(true);
    expect(canTransition("approved", "returned")).toBe(false);
  });

  it("terminal states are terminal", () => {
    for (const s of ["returned", "denied", "canceled", "on_project"] as const) {
      expect(SINGLE_TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it("deny and cancel release the unit to the shelf — or back to broken for broken-unit requests", () => {
    expect(canTransition("pending", "denied")).toBe(true);
    expect(canTransition("pending", "canceled")).toBe(true);
    expect(partStatusAfterRelease(false)).toBe("available");
    expect(partStatusAfterRelease(true)).toBe("broken");
  });

  it("the part mirrors the rental: reserved while pending/approved, out only after hand-over", () => {
    expect(PART_STATUS_BY_EVENT.requested).toBe("pending");
    expect(PART_STATUS_BY_EVENT.approved).toBe("pending");
    expect(PART_STATUS_BY_EVENT.taken).toBe("rented");
    expect(PART_STATUS_BY_EVENT.returned_ok).toBe("available");
    expect(PART_STATUS_BY_EVENT.returned_broken).toBe("broken");
    expect(PART_STATUS_BY_EVENT.assigned).toBe("on_project");
  });
});

// ---------------------------------------------------------------------------
// Package lifecycle
// ---------------------------------------------------------------------------

describe("package decisions", () => {
  it("approve reserves every unit as approved — never straight to active", () => {
    const res = decidePackageUnits(true, 3);
    expect(res.packageStatus).toBe("approved");
    expect(res.unitStatuses).toEqual(["approved", "approved", "approved"]);
    expect(res.unitStatuses).not.toContain("active");
  });

  it("deny/cancel releases all units", () => {
    const res = decidePackageUnits(false, 2);
    expect(res.packageStatus).toBe("canceled");
    expect(res.unitStatuses).toEqual(["denied", "denied"]);
  });

  it("an approved package with nothing handed over is NOT active", () => {
    // The "says active even though it is not" bug — the badge must read
    // "Approved · pick up" until the first hand-over.
    expect(packageBadgeStatus("approved", 3, 0)).toBe("approved");
    expect(packageBadgeStatus("approved", 1, 2)).toBe("active");
    expect(packageBadgeStatus("pending", 0, 0)).toBe("pending");
    expect(packageBadgeStatus("canceled", 0, 0)).toBe("canceled");
  });
});

// ---------------------------------------------------------------------------
// Bulk (weight/length) amounts
// ---------------------------------------------------------------------------

describe("bulk amount math", () => {
  it("approval validates the amount against current stock", () => {
    expect(validateBulkRequest(undefined, 5)).toMatch(/no amount/);
    expect(validateBulkRequest(0, 5)).toMatch(/no amount/);
    expect(validateBulkRequest(-1, 5)).toMatch(/no amount/);
    expect(validateBulkRequest(2, 5)).toBeNull();
    expect(validateBulkRequest(6, 5)).toMatch(/Only 5 in stock/);
  });

  it("hand-over deducts exactly the approved amount, once", () => {
    expect(deductBulkAmount(0.25, 1.5)).toEqual({ stock: 1.25 });
    expect(deductBulkAmount(120, 120)).toEqual({ stock: 0 });
  });

  it("hand-over refuses when stock shrank below the approved amount", () => {
    expect(deductBulkAmount(2, 1)).toMatchObject({ error: expect.stringMatching(/Only 1 left/) });
    expect(deductBulkAmount(undefined, 5)).toMatchObject({ error: expect.stringMatching(/no amount/) });
  });

  it("float drift cannot trigger a false stock shortage at exact amounts", () => {
    // 0.3 - 0.1 style drift: 0.30000000000000004 must still pass for 0.3.
    const drifted = 0.1 + 0.2;
    expect(deductBulkAmount(0.3, drifted)).toEqual({ stock: expect.closeTo(drifted - 0.3, 12) });
  });

  it("bulk material does not restock on return (consumed at hand-over)", () => {
    expect(BULK_RESTOCKS_ON_RETURN).toBe(false);
  });
});
