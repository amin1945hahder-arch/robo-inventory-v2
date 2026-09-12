// Pure helpers behind the package-builder dialog's QR scanning and line
// editing. Kept framework-free so they are unit-testable (package-scan.test.ts).

export type PackageLine = { groupId: string; count: number; note?: string };

/** A scanned category/closet label narrows the item dropdown to that scope. */
export type ScanFilter = { type: "category" | "closet"; id: string } | null;

/** Upsert a line for a group: bump the count when the group is already listed. */
export function upsertLine(lines: PackageLine[], groupId: string, count = 1): PackageLine[] {
  if (!groupId) return lines;
  const idx = lines.findIndex((l) => l.groupId === groupId);
  if (idx >= 0) {
    return lines.map((l, i) => (i === idx ? { ...l, count: l.count + Math.max(1, count) } : l));
  }
  return [...lines, { groupId, count: Math.max(1, count) }];
}

/** Does a group belong to the currently scanned category/closet filter? */
export function groupAllowedByFilter(
  g: { categoryId?: string; closetId?: string },
  filter: ScanFilter,
): boolean {
  if (!filter) return true;
  if (filter.type === "category") return g.categoryId === filter.id;
  return g.closetId === filter.id;
}

/**
 * Map a resolved QR payload (from api.lookup.resolve) onto package-builder
 * state:
 *  - unit  → add/bump a line for the unit's group (pick one of that unit type)
 *  - group → add/bump a line for the group
 *  - category / closet → narrow the dropdown filter to that scope
 *  - project / rental → not rentable, reported to the caller
 */
export type ScanOutcome =
  | { action: "add-line"; groupId: string }
  | { action: "set-filter"; filter: NonNullable<ScanFilter> }
  | { action: "ignored"; reason: string };

export function scanOutcome(
  resolved: { type: string; id: string; groupId?: string } | null,
): ScanOutcome {
  if (!resolved) return { action: "ignored", reason: "Unknown QR label" };
  switch (resolved.type) {
    case "unit":
      return resolved.groupId
        ? { action: "add-line", groupId: resolved.groupId }
        : { action: "ignored", reason: "Unit has no component group" };
    case "group":
      return { action: "add-line", groupId: resolved.id };
    case "category":
      return { action: "set-filter", filter: { type: "category", id: resolved.id } };
    case "closet":
      return { action: "set-filter", filter: { type: "closet", id: resolved.id } };
    case "project":
      return { action: "ignored", reason: "That's a project label — projects can't be rented" };
    case "rental":
      return { action: "ignored", reason: "That's a rent-card label — scan item labels instead" };
    default:
      return { action: "ignored", reason: "Unsupported QR label" };
  }
}
