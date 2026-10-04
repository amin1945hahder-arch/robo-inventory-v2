/**
 * Rank → app-role mapping helpers (pure, no Convex imports).
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * Club positions in this app are Arabic strings ("رئيس نادي الروبوت",
 * "عضو إداري", …). The mapping used to be a `Record<rank, role>` object,
 * and the Settings query returned it straight to the client. Convex encodes
 * object keys as JSON *field names*, and field names must be ASCII — so the
 * whole page died with:
 *
 *   Field name إداري has invalid character 'إ'
 *
 * The map itself is still the right shape INSIDE a Convex function (it's only
 * ever indexed in server memory), but anything crossing the wire must be an
 * ARRAY of `{ rank, role }` entries. That's what `parseRankRoleValues`
 * produces and what `getRankRoleMapQuery` now returns; the client rebuilds a
 * lookup with `rankRoleEntriesToMap` where non-ASCII keys are harmless.
 *
 * Storage stays a list of `"rank=>role"` strings so the mapping keeps living in
 * the same array-shaped `clubLists` row as every other admin-editable list.
 */

export type AppRoleKey = "admin" | "member" | "student";

export const APP_ROLE_KEYS: readonly AppRoleKey[] = ["admin", "member", "student"];

/** Priority when a person holds several mapped positions: the strongest wins. */
export const ROLE_RANK: Record<AppRoleKey, number> = {
  admin: 3,
  member: 2,
  student: 1,
};

export interface RankRoleEntry {
  rank: string;
  role: AppRoleKey;
}

export function isAppRole(value: unknown): value is AppRoleKey {
  return value === "admin" || value === "member" || value === "student";
}

/**
 * Parse the stored `"rank=>role"` strings into wire-safe entries.
 * - trims both sides and drops blanks
 * - ignores unknown roles instead of persisting junk
 * - later entries win for the same rank (last write wins, matching the
 *   previous object-assignment behaviour)
 * - the RESULT only ever has the ASCII keys "rank" and "role"
 */
export function parseRankRoleValues(values: readonly string[]): RankRoleEntry[] {
  const byRank = new Map<string, AppRoleKey>();
  for (const raw of values) {
    const sep = raw.indexOf("=>");
    if (sep < 0) continue;
    const rank = raw.slice(0, sep).trim();
    const role = raw.slice(sep + 2).trim();
    if (!rank || !isAppRole(role)) continue;
    byRank.set(rank, role);
  }
  return [...byRank].map(([rank, role]) => ({ rank, role }));
}

/** Serialize entries back to the stored `"rank=>role"` string form. */
export function serializeRankRoleEntries(entries: readonly RankRoleEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { rank, role } of entries) {
    const cleanRank = rank.trim();
    if (!cleanRank || !isAppRole(role)) continue;
    const value = `${cleanRank}=>${role}`;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Entries → server/client lookup. Only for in-memory indexing, never for the wire. */
export function rankRoleEntriesToMap(
  entries: readonly RankRoleEntry[],
): Record<string, AppRoleKey> {
  const out: Record<string, AppRoleKey> = {};
  for (const { rank, role } of entries) out[rank] = role;
  return out;
}

/** The strongest mapped role among a person's positions (undefined = no match). */
export function strongestMappedRole(
  map: Record<string, AppRoleKey>,
  positions: readonly string[] | undefined,
): AppRoleKey | undefined {
  if (!positions?.length) return undefined;
  let best: AppRoleKey | undefined;
  for (const position of positions) {
    const mapped = map[position];
    if (mapped && (!best || ROLE_RANK[mapped] > ROLE_RANK[best])) best = mapped;
  }
  return best;
}

/**
 * Every object field name a Convex payload would carry, recursively. Used by
 * the regression test that pins the bug this file documents.
 */
export function fieldNamesOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) fieldNamesOf(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      out.push(key);
      fieldNamesOf(nested, out);
    }
  }
  return out;
}

/** `true` when every field name is printable ASCII (what Convex accepts). */
export function hasOnlyAsciiFieldNames(value: unknown): boolean {
  return fieldNamesOf(value).every((name) => /^[\x20-\x7E]*$/.test(name));
}