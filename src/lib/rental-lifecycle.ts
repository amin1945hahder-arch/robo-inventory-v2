/**
 * Pure rental-lifecycle rules.
 *
 * The Convex backend can't run inside vitest (no database), so the exact
 * state transitions and stock math that `parts.ts` implements are encoded
 * here as pure data + helpers, and `rental-lifecycle.test.ts` pins them.
 * If you change a lifecycle rule in `parts.ts`, change it here too — and
 * the tests will tell you exactly which rule moved.
 */

// ---------------------------------------------------------------------------
// Single rental transitions (rentals.status)
// ---------------------------------------------------------------------------

export type SingleRentalStatus =
  | "pending"
  | "approved"
  | "active"
  | "on_project"
  | "returned"
  | "denied"
  | "canceled";

/**
 * Allowed `rentals.status` transitions, matching `adminRentalAction` /
 * `decideRental` / `cancelMyRequest`:
 *  - approve/deny only act on `pending`
 *  - hand-over (`mark_taken`) is the ONLY path `pending → active` — approval
 *    always stops at `approved` (awaiting pick-up)
 *  - returns / project assignment only act on `active`
 */
export const SINGLE_TRANSITIONS: Record<SingleRentalStatus, SingleRentalStatus[]> = {
  pending: ["approved", "denied", "canceled"],
  approved: ["active"],
  active: ["returned", "on_project"],
  on_project: [],
  returned: [],
  denied: [],
  canceled: [],
};

export function canTransition(from: SingleRentalStatus, to: SingleRentalStatus): boolean {
  return SINGLE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Part status side (parts.status mirrors the open rental)
// ---------------------------------------------------------------------------

export type PartStatus = "available" | "pending" | "rented" | "on_project" | "broken";

/**
 * What the physical unit does while its rental row moves. The part is held
 * ("pending") from the request until hand-over; inventory is "out" only in
 * `rented` / `on_project`. Broken-unit requests (`rentBroken`) go back to
 * `broken` on deny/cancel instead of the shelf.
 */
export const PART_STATUS_BY_EVENT: Record<
  "requested" | "approved" | "denied" | "canceled" | "taken" | "returned_ok" | "returned_broken" | "assigned",
  PartStatus
> = {
  requested: "pending",
  approved: "pending", // reserved — NOT out of inventory yet
  denied: "available",
  canceled: "available",
  taken: "rented",
  returned_ok: "available",
  returned_broken: "broken",
  assigned: "on_project",
};

/** Deny/cancel restores a knowingly-rented broken unit to the broken pool. */
export function partStatusAfterRelease(rentBroken: boolean): PartStatus {
  return rentBroken ? "broken" : "available";
}

// ---------------------------------------------------------------------------
// Package rentals (all-or-nothing decisions, per-unit hand-over)
// ---------------------------------------------------------------------------

export type PackageStatus = "pending" | "approved" | "canceled";

/**
 * Approving a package moves it to `approved` and every unit to `approved`
 * (awaiting pick-up) — never straight to `active`. Deny/cancel releases all
 * reserved units.
 */
export function decidePackageUnits(
  approve: boolean,
  unitCount: number,
): { packageStatus: PackageStatus; unitStatuses: SingleRentalStatus[] } {
  if (approve) {
    return { packageStatus: "approved", unitStatuses: Array(unitCount).fill("approved") };
  }
  return { packageStatus: "canceled", unitStatuses: Array(unitCount).fill("denied") };
}

/**
 * Which badge a member sees for an approved package: it is NOT "active"
 * until at least one unit has actually been handed over — otherwise the UI
 * claims an approved (not picked up) bundle is already out.
 */
export function packageBadgeStatus(
  pkgStatus: PackageStatus,
  approvedUnits: number,
  activeUnits: number,
): "pending" | "canceled" | "approved" | "active" {
  if (pkgStatus === "canceled") return "canceled";
  if (pkgStatus === "pending") return "pending";
  return activeUnits > 0 ? "active" : "approved";
}

// ---------------------------------------------------------------------------
// Bulk (weight/length) amount math
// ---------------------------------------------------------------------------

const EPS = 1e-9;

/**
 * Approval-time guard for a bulk request: the amount must be positive and
 * must fit the current stock. Returns the error message the backend throws.
 */
export function validateBulkRequest(
  amount: number | undefined,
  stock: number,
): string | null {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) {
    return "Bulk request has no amount — deny it and ask the member to request again";
  }
  if (amount > stock + EPS) {
    return `Only ${stock} in stock — the request is for ${amount}`;
  }
  return null;
}

/**
 * Hand-over math for a bulk rental: deduct exactly once, and refuse when
 * stock has shrunk below the approved amount since approval. Returns the new
 * stock, or the error message the backend throws.
 */
export function deductBulkAmount(
  amount: number | undefined,
  stock: number,
): { stock: number } | { error: string } {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) {
    return { error: "This bulk rental has no amount set — deny it and ask the member to request again" };
  }
  if (amount > stock + EPS) {
    return { error: `Only ${stock} left in stock — cannot hand over ${amount}` };
  }
  return { stock: stock - amount };
}

/**
 * Bulk material is consumed at hand-over: returns do NOT restock the group
 * (the member keeps using the filament/wire). Documented here so a future
 * "restock on return" change is a conscious decision, not an accident.
 */
export const BULK_RESTOCKS_ON_RETURN = false;
