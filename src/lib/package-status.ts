/**
 * Package display status — derived from the package's unit counts instead of
 * the stored `rentalPackages.status`.
 *
 * Why: a package row is "approved" forever once an admin approves it — the
 * stored status has no "returned"/"finished" value. Deriving the badge from
 * the actual unit states keeps it truthful: when every unit is processed
 * (returned or on a project), the package IS returned, even though
 * `pkg.status` still says "approved".
 */

export type PackageUnitCounts = {
  /** Units waiting for the admin decision (pending) or pick-up (approved). */
  approvedUnits: number;
  /** Units physically with the member. */
  activeUnits: number;
  /** Units processed: returned to the shelf or assigned to a project. */
  returnedUnits: number;
};

/**
 * One of the StatusBadge keys:
 * - "active"    — some units are still out with the member
 * - "approved"  — none out, but some are approved and awaiting pick-up
 * - "returned"  — the whole bundle has been processed
 * - "pending"   — the request itself is still waiting for approval
 * - "canceled"  — denied or canceled
 */
export type PackageDisplayStatus = "active" | "approved" | "returned" | "pending" | "canceled";

export function packageDisplayStatus(
  pkgStatus: string | undefined | null,
  counts: PackageUnitCounts,
): PackageDisplayStatus {
  if (pkgStatus === "pending") return "pending";
  if (pkgStatus === "canceled") return "canceled";
  if (counts.activeUnits > 0) return "active";
  if (counts.approvedUnits > 0) return "approved";
  if (counts.returnedUnits > 0) return "returned";
  // Approved with no units at all (e.g. admin removed them) — treat like a
  // finished bundle, not an active one.
  return pkgStatus === "approved" ? "returned" : "canceled";
}
