import { describe, expect, it } from "vitest";
import { planMeasureTake } from "./measure-alloc";

const u = (id: string, remaining: number, lowAt = 0) => ({ id, remaining, lowAt });

describe("planMeasureTake", () => {
  it("rejects non-positive requests", () => {
    expect(planMeasureTake([u("a", 5)], 0).ok).toBe(false);
    expect(planMeasureTake([u("a", 5)], -1).ok).toBe(false);
  });

  it("rejects when stock is insufficient", () => {
    const res = planMeasureTake([u("a", 2), u("b", 1)], 4);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Only 3/);
  });

  it("prefers an exact whole-unit fit over splitting a fuller unit", () => {
    const res = planMeasureTake([u("a", 5), u("b", 3)], 3);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan).toEqual([{ unitId: "b", amount: 3, whole: true }]);
      expect(res.spansUnits).toBe(false);
    }
  });

  it("takes a partial cut from the fullest unit when no unit is exact", () => {
    const res = planMeasureTake([u("a", 3), u("b", 3), u("c", 3)], 4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 4 > 3 so no single unit covers it: hand out one whole reel, cut 1 m
      // from another — never touching the third.
      expect(res.plan).toEqual([
        { unitId: "a", amount: 3, whole: true },
        { unitId: "b", amount: 1, whole: false },
      ]);
      expect(res.spansUnits).toBe(true);
    }
  });

  it("never leaves a unit below its minimum through a partial cut", () => {
    // A 2.5 m cut from a 3 m reel is fine when the minimum is 0.5…
    const loose = planMeasureTake([u("a", 3, 0.5)], 2.5);
    expect(loose.ok).toBe(true);
    if (loose.ok) {
      expect(loose.plan).toEqual([{ unitId: "a", amount: 2.5, whole: false }]);
    }
    // …but blocked when the minimum is 1 (0.5 would be left behind).
    const bad = planMeasureTake([u("a", 3, 1), u("b", 3, 1), u("c", 3, 1)], 2.5);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/minimum/);
  });

  it("a whole-unit take may empty a unit even when below-min cuts are blocked", () => {
    const res = planMeasureTake([u("a", 3, 1), u("b", 3, 1)], 6);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan).toEqual([
        { unitId: "a", amount: 3, whole: true },
        { unitId: "b", amount: 3, whole: true },
      ]);
    }
  });

  it("fills the remainder from the fullest donor that respects its minimum", () => {
    // Reels: 3+2 (min 1.5 each). Request 4 → whole 3 m reel + 1 m cut from
    // the 2 m reel leaves 1 m ≥ 1.5? No — 1 < 1.5, so the plan must fail
    // rather than violate the minimum.
    const res = planMeasureTake([u("a", 3, 1.5), u("b", 2, 1.5)], 4);
    expect(res.ok).toBe(false);
  });

  it("handles floating-point dust", () => {
    const res = planMeasureTake([u("a", 0.1 + 0.2)], 0.3);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan).toEqual([{ unitId: "a", amount: 0.3, whole: true }]);
  });

  it("ignores empty units and treats a zero-stock group as unavailable", () => {
    const res = planMeasureTake([u("a", 0), u("b", 0)], 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Only 0/);
  });

  it("scales to many units", () => {
    const res = planMeasureTake(
      [u("a", 3), u("b", 3), u("c", 3), u("d", 3), u("e", 3)],
      9.5,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const total = res.plan.reduce((s, p) => s + p.amount, 0);
      expect(Math.abs(total - 9.5) < 1e-9).toBe(true);
      expect(res.plan.length).toBe(4); // 3 whole + 0.5 cut, one reel untouched
    }
  });
});
