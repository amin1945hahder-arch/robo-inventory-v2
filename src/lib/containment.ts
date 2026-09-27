import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Storage containment resolution (client-safe, unit-tested).
 *
 * A group's own closetId says where it was CREATED — but physically it sits
 * inside its container chain (parentGroupId boxes/bags). The club treats
 * containers as part of their storage, so a group belongs to a storage when
 * EITHER holds:
 *  - its own closetId matches the storage, or
 *  - any container in its parent chain lives in that storage.
 *
 * Then a storage page shows EVERYTHING set to be contained in it — including
 * groups sitting in a container that belongs to a different storage — with
 * the container path spelled out on each card.
 */

// Plain-string shape so tests can use simple literals; full Doc<"groups">
// rows are assignable to this (Convex ids are branded strings).
export type GroupLite = {
  _id: string;
  name: string;
  parentGroupId?: string | null;
  closetId?: string;
  measure?: "count" | "weight" | "length" | "pack" | null;
  quantityTotal?: number;
};

/** True when a group is a container (holds groups, not circulating units). */
export function isContainerLite(
  g: Partial<GroupLite> | null | undefined,
): boolean {
  return Boolean(g && g.quantityTotal === 0 && !g.measure);
}

/**
 * Chain of container NAMES above `group` (outermost first, excluding the
 * group itself), e.g. "Shelf box > Drawer 2".
 */
export function containerNamesOf<
  G extends { _id: string; name: string; parentGroupId?: string | null },
>(
  group: { parentGroupId?: string | null } | null | undefined,
  groups: G[],
): string[] {
  if (!group?.parentGroupId) return [];
  const idx = new Map(groups.map((g) => [g._id, g]));
  const parts: string[] = [];
  let cur = idx.get(group.parentGroupId);
  let depth = 0;
  while (cur && depth < 10) {
    parts.unshift(cur.name);
    cur = cur.parentGroupId ? idx.get(cur.parentGroupId) : undefined;
    depth += 1;
  }
  return parts;
}

/**
 * Groups that belong to `closetId`: their own closetId matches OR any
 * ancestor container's closetId matches. Containers themselves are excluded
 * from the result (a storage page lists content, not its boxes) unless the
 * container has no children anywhere — then it is kept so nothing disappears.
 */
export function groupsInStorage<
  G extends {
    _id: string;
    name: string;
    parentGroupId?: string | null;
    closetId?: string;
    measure?: "count" | "weight" | "length" | "pack" | null;
    quantityTotal?: number;
  },
>(closetId: string, groups: G[]): G[] {
  const byId = new Map(groups.map((g) => [g._id, g]));
  const hasChildren = new Set<string>();
  for (const g of groups) {
    if (g.parentGroupId) hasChildren.add(g.parentGroupId);
  }

  const isContainer = (g: {
    measure?: "count" | "weight" | "length" | "pack" | null;
    quantityTotal?: number;
  }) => Boolean(g.quantityTotal === 0 && !g.measure);

  // Walk up the parent chain collecting every ancestor's closetId.
  const ancestorClosetIds = (g: G): Set<string> => {
    const out = new Set<string>();
    let cur = g.parentGroupId ? byId.get(g.parentGroupId) : undefined;
    let depth = 0;
    while (cur && depth < 10) {
      if (cur.closetId) out.add(cur.closetId);
      cur = cur.parentGroupId ? byId.get(cur.parentGroupId) : undefined;
      depth += 1;
    }
    return out;
  };

  const inStorage: G[] = [];
  for (const g of groups) {
    const belongs =
      (g.closetId && g.closetId === closetId) ||
      ancestorClosetIds(g).has(closetId);
    if (!belongs) continue;
    // Hide containers that hold children (their content is listed instead);
    // keep childless containers so empty boxes stay visible.
    if (isContainer(g) && hasChildren.has(g._id)) continue;
    inStorage.push(g);
  }
  return inStorage;
}
