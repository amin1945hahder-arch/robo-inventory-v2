/** Safe list helpers for data that can be `undefined` during navigation/loading.

Lazily wrapping every `.filter`/`.map` is noisy and easy to forget, so we keep the
common cases here and use them only where a query can legitimately be missing while
the component is already rendering derived UI (e.g. a part page where a child list
renders before the parent doc settles).
*/

/** An empty, stable array when `value` is not an array. Preserves real arrays by
identity where possible (no copy), and never throws on objects/null/undefined. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

/** Filter a possibly-missing array without throwing. Equivalent to
`(value ?? []).filter(...)` but explicit about intent and safe for objects/null. */
export function filterArray<T>(value: T[] | undefined | null, predicate: (item: T) => boolean): T[] {
  return value == null || !Array.isArray(value) ? [] : value.filter(predicate);
}

/** Map over a possibly-missing array without throwing. */
export function mapArray<T, U>(value: T[] | undefined | null, fn: (item: T) => U): U[] {
  return value == null || !Array.isArray(value) ? [] : value.map(fn);
}

/** Read `.length` from a possibly-missing array without throwing. */
export function arrayLength(value: unknown[] | undefined | null): number {
  return value == null || !Array.isArray(value) ? 0 : value.length;
}
