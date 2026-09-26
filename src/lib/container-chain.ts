import type { Doc } from "@/convex/_generated/dataModel";

/**
 * "Box A > Box B" — the container chain a group sits inside (outermost
 * first), resolved against a full group index. Shared by every client that
 * prints a container path (rent cards, profile views).
 */
export function containerChainOf(
  group:
    | {
        parentGroupId?: string | null;
        quantityTotal?: number;
        measure?: string | null;
      }
    | null
    | undefined,
  groups: { _id: string; name: string; parentGroupId?: string | null }[],
): string {
  if (!group?.parentGroupId) return "";
  const idx = new Map<string, { _id: string; name: string; parentGroupId?: string | null }>(
    groups.map((g) => [g._id, g]),
  );
  const parts: string[] = [];
  let cur = idx.get(group.parentGroupId);
  let depth = 0;
  while (cur && depth < 10) {
    parts.unshift(cur.name);
    cur = cur.parentGroupId ? idx.get(cur.parentGroupId) : undefined;
    depth += 1;
  }
  return parts.join(" > ");
}

/** True when a group is a container (holds groups, not circulating units). */
export function isContainerGroup(g: Doc<"groups"> | { quantityTotal?: number; measure?: string | null } | null | undefined): boolean {
  return Boolean(g && g.quantityTotal === 0 && !g.measure);
}
