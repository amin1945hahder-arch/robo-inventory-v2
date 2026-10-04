/**
 * Pure SQL builders for the Turso-backed read path.
 *
 * Every value is a bound parameter (`?`), never interpolated — a caller can
 * pass any filter without being able to inject SQL. Only column names are
 * written into the string, and those come from the generated schema spec.
 *
 * These live apart from the node functions so the SQL can be unit-tested
 * without a database, a Convex runtime, or a network.
 */

import { MIGRATION_TABLES } from "./turso-schema.generated";

export type Bind = string | number | null;

/** Booleans are stored as 0/1, and an unset optional field is NULL. */
export function boolCondition(column: string): string {
  return `("${column}" IS NULL OR "${column}" = 0)`;
}

export type GroupListArgs = {
  closetId?: string;
  categoryId?: string;
  search?: string;
};

const SEARCHABLE_GROUP_COLUMNS = [
  "name",
  "brand",
  "model",
  "note",
  "datasheet",
  "imageUrl",
] as const;

/**
 * The groups list, mirroring catalog.listGroups: not-deleted, optional
 * closet/category filter, an optional deep text search, ordered by name.
 *
 * `search` matches any of the searchable text columns, which is what the
 * Convex version did by scanning every string field of the document.
 */
export function buildGroupListSql(
  args: GroupListArgs = {},
): { sql: string; args: Bind[] } {
  const columns = MIGRATION_TABLES.groups;
  if (!columns) throw new Error("groups is not in the migration spec");

  const where: string[] = [boolCondition("deleted")];
  const params: Bind[] = [];

  if (args.closetId) {
    where.push('"closetId" = ?');
    params.push(args.closetId);
  }
  if (args.categoryId) {
    where.push('"categoryId" = ?');
    params.push(args.categoryId);
  }
  const search = args.search?.trim();
  if (search) {
    const searchable = SEARCHABLE_GROUP_COLUMNS.filter((c) => c in columns);
    const like = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(${searchable.map((c) => `"${c}" LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    params.push(...searchable.map(() => like));
  }

  return {
    sql: `SELECT * FROM "groups" WHERE ${where.join(" AND ")} ORDER BY "name" ASC`,
    args: params,
  };
}

/** Closets ordered by name, matching the old `by_name` index. */
export function buildClosetListSql(): { sql: string; args: Bind[] } {
  return {
    sql: `SELECT * FROM "closets" ORDER BY "name" ASC`,
    args: [],
  };
}

/** Categories ordered by name. */
export function buildCategoryListSql(): { sql: string; args: Bind[] } {
  return {
    sql: `SELECT * FROM "categories" ORDER BY "name" ASC`,
    args: [],
  };
}

/**
 * Escape hatch for the many tables whose read is "the whole table": still
 * parameterised for the limit.
 */
export function buildListSql(
  table: string,
  opts: { orderBy?: string; limit?: number } = {},
): { sql: string; args: Bind[] } {
  const columns = MIGRATION_TABLES[table];
  if (!columns) throw new Error(`Table "${table}" is not in the migration spec`);
  const orderable =
    opts.orderBy !== undefined &&
    (opts.orderBy in columns || opts.orderBy === "_ts" || opts.orderBy === "_id");
  const order = orderable ? `ORDER BY "${opts.orderBy}"` : `ORDER BY "_ts"`;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return {
    sql: `SELECT * FROM "${table}" ${order} LIMIT ?`,
    args: [limit],
  };
}