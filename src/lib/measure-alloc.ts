/**
 * Allocation planner for measure-based groups (weight / length).
 *
 * A member may request any amount (e.g. 4 m of wire from a group that holds
 * three 3 m reels). The planner decides which physical units feed the take:
 *
 *  1. One unit can cover it alone  → take from that unit (never split needlessly).
 *     - Exact fit (remaining == request) wins: the unit goes out whole.
 *     - Otherwise a partial cut that leaves the unit at or above its minimum.
 *  2. No single unit covers it     → hand out whole units (largest first),
 *     then one partial cut for the remainder, again never below the minimum.
 *
 * A partial cut may NEVER leave a unit below its minimum amount (`lowAt`) —
 * only a whole-unit take may empty a unit. When the plan spans several units
 * the rental carries a note so the admin knows to hand over more than one
 * reel/spool.
 *
 * Pure + synchronous so it is fully unit-testable and reused by both the
 * request-time feasibility check and the hand-over mutation.
 */

export interface MeasureUnitInput {
  id: string;
  /** Remaining amount in the group's measure unit (e.g. meters, kg). */
  remaining: number;
  /** Minimum amount the unit may never drop below through a partial cut. */
  lowAt: number;
}

export interface MeasureTake {
  unitId: string;
  amount: number;
  /** True when the unit is taken in full (it leaves the shelf entirely). */
  whole: boolean;
}

export type MeasurePlan =
  | { ok: true; plan: MeasureTake[]; spansUnits: boolean }
  | { ok: false; error: string };

const EPS = 1e-9;
/** Keep amounts tidy: 0.333333333 → 0.3333. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function partialAllowed(unit: MeasureUnitInput, take: number): boolean {
  const leftover = unit.remaining - take;
  return leftover >= unit.lowAt - EPS;
}

/**
 * Build a take plan for `request` out of `units` (pass ONLY units that are
 * physically available in the lab — the caller filters broken/rented ones).
 */
export function planMeasureTake(
  units: MeasureUnitInput[],
  request: number,
): MeasurePlan {
  if (!Number.isFinite(request) || request <= 0) {
    return { ok: false, error: "Enter the amount you need" };
  }
  const pool = units
    .map((u) => ({ ...u, remaining: round4(u.remaining), lowAt: round4(u.lowAt) }))
    .filter((u) => u.remaining > EPS)
    .sort((a, b) => b.remaining - a.remaining); // fullest first
  const available = round4(pool.reduce((s, u) => s + u.remaining, 0));
  if (available + EPS < request) {
    return {
      ok: false,
      error: `Only ${available} in stock across all units — the request is for ${round4(request)}`,
    };
  }

  // 1) Exact single-unit fit: one reel goes out whole and untouched elsewhere.
  const exact = pool.find((u) => Math.abs(u.remaining - request) < EPS);
  if (exact) {
    return { ok: true, plan: [{ unitId: exact.id, amount: round4(request), whole: true }], spansUnits: false };
  }

  // 2) Single-unit partial cut (keeps every other unit intact).
  const singlePartial = pool.find((u) => u.remaining > request + EPS && partialAllowed(u, request));
  if (singlePartial) {
    return {
      ok: true,
      plan: [{ unitId: singlePartial.id, amount: round4(request), whole: false }],
      spansUnits: false,
    };
  }

  // 3) Whole units first (largest that fit entirely), then one partial cut.
  const plan: MeasureTake[] = [];
  let outstanding = round4(request);
  for (const u of pool) {
    if (outstanding <= EPS) break;
    if (u.remaining <= outstanding + EPS) {
      plan.push({ unitId: u.id, amount: u.remaining, whole: true });
      outstanding = round4(outstanding - u.remaining);
    }
  }
  if (outstanding > EPS) {
    // Remainder must come as a partial cut from a unit not fully taken.
    const taken = new Set(plan.map((p) => p.unitId));
    const donor = pool
      .filter((u) => !taken.has(u.id) && u.remaining > outstanding + EPS)
      .find((u) => partialAllowed(u, outstanding));
    if (!donor) {
      // Maybe an exact whole unit exists among the leftovers.
      const exactLeft = pool
        .filter((u) => !taken.has(u.id))
        .find((u) => Math.abs(u.remaining - outstanding) < EPS);
      if (exactLeft) {
        plan.push({ unitId: exactLeft.id, amount: exactLeft.remaining, whole: true });
        outstanding = 0;
      } else {
        return {
          ok: false,
          error: `Cannot split this take without dropping a unit below its minimum amount — largest usable cut leaves ${round4(available)} in stock; ask for less or lower the unit minimum`,
        };
      }
    } else {
      plan.push({ unitId: donor.id, amount: round4(outstanding), whole: false });
      outstanding = 0;
    }
  }
  return { ok: true, plan, spansUnits: plan.length > 1 };
}

/** Human-readable plan summary for Telegram / notifications: "WIR-001 3 m (whole) · WIR-002 1 m". */
export function describePlan(
  plan: MeasureTake[],
  tagName: (unitId: string) => string | undefined,
  unit: string | undefined,
): string {
  return plan
    .map((p) => `${tagName(p.unitId) ?? "unit"} ${p.amount}${unit ? ` ${unit}` : ""}${p.whole ? " (whole unit)" : ""}`)
    .join(" · ");
}
