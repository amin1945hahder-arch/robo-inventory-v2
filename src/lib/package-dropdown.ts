/**
 * Ordering + labeling for the package item dropdown.
 *
 * The dropdown in the package lending flow shows every lendable group,
 * sorted by CATEGORY (with a fixed, non-selectable category label between
 * each section), then by container path, then group name, brand, model.
 * Container groups (boxes that hold other groups, not circulating units)
 * are excluded — they can never be lent. Each row reads:
 *   "Container › Sub-container   Group name   Brand Model   (N free)"
 */

export type DropdownGroup = {
  _id: string;
  name: string;
  categoryId?: string;
  closetId?: string;
  parentGroupId?: string | null;
  brand?: string | null;
  model?: string | null;
  quantityTotal?: number;
  measure?: string | null;
  /** Display unit for weight/length groups ("kg", "m"…). */
  measureUnit?: string | null;
};

export type CategoryEntry = { _id: string; name: string };

/** "Box A › Drawer 2" — outermost first; "" when the group sits loose. */
export function containerPathOf(
  group: { parentGroupId?: string | null } | null | undefined,
  groupsById: Map<string, { _id: string; name: string; parentGroupId?: string | null }>,
): string {
  const parts: string[] = [];
  let cur = group?.parentGroupId ? groupsById.get(group.parentGroupId) : undefined;
  let depth = 0;
  while (cur && depth < 10) {
    parts.unshift(cur.name);
    cur = cur.parentGroupId ? groupsById.get(cur.parentGroupId) : undefined;
    depth += 1;
  }
  return parts.join(" › ");
}

/** True when a group is a container (holds groups, not circulating units). */
export function isContainerRow(g: {
  quantityTotal?: number;
  measure?: string | null;
} | null | undefined): boolean {
  return Boolean(g && g.quantityTotal === 0 && !g.measure);
}

/** "Arduino Uno — Arduino Uno R3" → brand+model in one line (may be empty). */
export function brandModelLine(g: { brand?: string | null; model?: string | null }): string {
  return [g.brand?.trim(), g.model?.trim()].filter(Boolean).join(" ");
}

export type DropdownSection = {
  categoryId: string;
  categoryName: string;
  items: (DropdownGroup & { containerPath: string })[];
};

/**
 * Build the dropdown content: lendable groups only (no containers),
 * sectioned by category (sections sorted by name) and inside each section
 * sorted by container path → group name → brand → model.
 */
export function buildPackageDropdown(
  groups: DropdownGroup[],
  categories: CategoryEntry[],
): DropdownSection[] {
  const byId = new Map(groups.map((g) => [g._id, g]));
  const lendable = groups.filter((g) => !isContainerRow(g));
  const catName = new Map(categories.map((c) => [c._id, c.name]));

  const sections = new Map<string, DropdownSection>();
  for (const g of lendable) {
    const cid = g.categoryId ?? "";
    if (!sections.has(cid)) {
      sections.set(cid, {
        categoryId: cid,
        categoryName: cid ? (catName.get(cid) ?? "Other") : "Other",
        items: [],
      });
    }
    sections.get(cid)!.items.push({ ...g, containerPath: containerPathOf(g, byId) });
  }

  const coll = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  // Loose groups (no container) sort AFTER boxed ones within their category.
  const pathKey = (p: string) => (p === "" ? "￿" : p);
  const out = [...sections.values()];
  for (const s of out) {
    s.items.sort((a, b) => {
      const path = coll(pathKey(a.containerPath), pathKey(b.containerPath));
      if (path !== 0) return path;
      const name = coll(a.name, b.name);
      if (name !== 0) return name;
      const brand = coll(a.brand ?? "", b.brand ?? "");
      if (brand !== 0) return brand;
      return coll(a.model ?? "", b.model ?? "");
    });
  }
  out.sort((a, b) => coll(a.categoryName, b.categoryName));
  return out;
}
