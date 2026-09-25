/**
 * Shared deep-search helpers: a query matches an item when it appears in ANY
 * string value of the item (name, brand, model, description, unit tag,
 * unit note…). Case-insensitive substring matching — no field-by-field
 * boilerplate at the call sites, and new fields are searchable for free.
 */

/** Case-insensitive substring test. Non-strings (numbers, ids, objects) never match. */
export function contains(haystack: unknown, needle: string): boolean {
  return typeof haystack === "string" && haystack.toLowerCase().includes(needle);
}

/**
 * True when `q` (blank = match everything) is found in any string field of
 * the item, or in `extra` — a pre-joined blob of related text (e.g. the
 * group's units' tags and notes) that lives outside the item itself.
 */
export function matchesSearch(
  item: Record<string, unknown> | null | undefined,
  q: string,
  extra?: unknown,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (extra !== undefined && contains(extra, needle)) return true;
  if (!item) return false;
  for (const value of Object.values(item)) {
    if (contains(value, needle)) return true;
  }
  return false;
}
