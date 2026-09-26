/**
 * Group measure helpers (client-safe, unit-tested).
 *
 * A group carries one of these counting modes:
 *  - "count"   discrete units, each with its own QR tag (default; no field)
 *  - "weight"  bulk stock tracked per unit in kg/g
 *  - "length"  bulk stock tracked per unit in m/cm/mm
 *  - "pack"    whole packs of small pieces (jumper wires…): every pack is a
 *              QR-tagged unit that rents/returns WHOLE, and each pack holds
 *              the same number of pieces (groups.packSize).
 *
 * Rent/return flows treat "pack" exactly like "count" — the only differences
 * are presentation (packs + pieces-per-pack) and the container/block rules.
 */

export type GroupMeasureLite = {
  measure?: "count" | "weight" | "length" | "pack" | null;
  packSize?: number | null;
} | null | undefined;

/** Pack-measured group (whole packs of N pieces each). */
export function isPackGroup(group: GroupMeasureLite): boolean {
  return group?.measure === "pack";
}

/**
 * Groups that follow the count-style rental flow (whole units with QR tags).
 * Packs rent like count units — only their display differs.
 */
export function isCountFlowGroup(group: GroupMeasureLite): boolean {
  return !group?.measure || group.measure === "count" || group.measure === "pack";
}

/** Bulk material group (weight or length). */
export function isBulkMaterialGroup(group: GroupMeasureLite): boolean {
  return group?.measure === "weight" || group?.measure === "length";
}

/** "40 pieces/pack" — falls back to just "pack" when the size is unknown. */
export function describePackSize(group: GroupMeasureLite): string {
  if (!isPackGroup(group)) return "";
  const n = Number(group.packSize ?? 0);
  return n > 0 ? `${n} pieces/pack` : "pack";
}

/**
 * Pieces held by `packs` whole packs: 3 packs × 40 = "120 pieces".
 * Returns "" for non-pack groups or invalid sizes.
 */
export function piecesInPacks(group: GroupMeasureLite, packs: number): string {
  if (!isPackGroup(group)) return "";
  const n = Number(group.packSize ?? 0);
  if (!(n > 0) || !Number.isFinite(packs)) return "";
  return `${Math.round(n * packs)} pieces`;
}
