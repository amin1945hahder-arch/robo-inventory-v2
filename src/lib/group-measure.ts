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
  /** Display unit for weight/length groups: "kg" | "g" | "m" | "cm" | "mm". */
  measureUnit?: string | null;
} | null | undefined;

/** Pack-measured group (whole packs of N pieces each). */
export function isPackGroup(
  group: GroupMeasureLite,
): group is { measure: "pack"; packSize?: number | null } {
  return group?.measure === "pack";
}

/**
 * Groups that follow the count-style rental flow (whole units with QR tags).
 * Packs rent like count units — only their display differs.
 */
export function isCountFlowGroup(group: GroupMeasureLite): boolean {
  const m = group?.measure;
  return !m || m === "count" || m === "pack";
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

/**
 * Pieces remaining INSIDE one pack unit (from its amount ledger). Falls back
 * to a full pack for legacy rows created before the ledger existed.
 */
export function piecesInUnit(
  unit: { amountRemaining?: string | number | null } | null | undefined,
  group: GroupMeasureLite,
): number {
  const raw = unit?.amountRemaining;
 // null/undefined/blank/NaN = legacy row without a ledger → full pack.
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return Math.max(0, Number(group?.packSize ?? 0));
}

/**
 * Trim float noise from bulk ledger sums: 2 decimals is plenty for kg/m and
 * keeps "1.1 + 2.2" from rendering as "3.3000000000000003".
 */
export function roundBulk(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * "2.5 kg" / "3×" — a package line's amount with its unit, for cards,
 * toasts and summaries. Bulk lines read "N unit"; count/pack lines read
 * "N×"; groups without a unit fall back to a plain number.
 */
export function formatLineAmount(
  line: { count: number },
  group: GroupMeasureLite,
): string {
  const n = Number(line.count ?? 0);
  if (isBulkMaterialGroup(group)) {
    const u = group?.measureUnit?.trim();
    return u ? `${roundBulk(n)} ${u}` : `${roundBulk(n)}`;
  }
  return `${Math.max(0, Math.round(n))}×`;
}

/**
 * Total pieces inside ALL given packs (Σ per-pack amounts). This is the
 * real stock of a pack group — a whole pack can still sit on the shelf
 * while being far from full.
 */
export function sumPiecesInUnits(
  units: { amountRemaining?: string | number | null }[],
  group: GroupMeasureLite,
): number {
  return units.reduce((s, u) => s + piecesInUnit(u, group), 0);
}
