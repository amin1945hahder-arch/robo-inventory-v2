// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  boolCondition,
  buildCategoryListSql,
  buildClosetListSql,
  buildGroupListSql,
  buildListSql,
} from "./turso-sql";

describe("boolCondition", () => {
  it("treats NULL and 0 as not-deleted", () => {
    expect(boolCondition("deleted")).toBe('("deleted" IS NULL OR "deleted" = 0)');
  });
});

describe("buildGroupListSql", () => {
  it("always excludes deleted rows and orders by name", () => {
    const { sql, args } = buildGroupListSql();
    expect(sql).toContain('"deleted" IS NULL OR "deleted" = 0');
    expect(sql).toContain('ORDER BY "name" ASC');
    expect(args).toEqual([]);
  });

  it("binds closet and category filters rather than interpolating them", () => {
    const { sql, args } = buildGroupListSql({
      closetId: "c1",
      categoryId: "cat1",
    });
    expect(sql).toContain('"closetId" = ?');
    expect(sql).toContain('"categoryId" = ?');
    expect(args).toEqual(["c1", "cat1"]);
    // A hostile id must never reach the SQL text.
    const hostile = buildGroupListSql({ closetId: "x'; DROP TABLE groups; --" });
    expect(hostile.sql).not.toContain("DROP TABLE");
    expect(hostile.args).toEqual(["x'; DROP TABLE groups; --"]);
  });

  it("adds one LIKE per searchable column for a deep search", () => {
    const { sql, args } = buildGroupListSql({ search: "LDR" });
    expect(sql).toContain('"name" LIKE ?');
    expect(sql).toContain('"brand" LIKE ?');
    expect(sql).toContain('"model" LIKE ?');
    expect(args.every((a) => a === "%LDR%")).toBe(true);
    expect(args.length).toBeGreaterThan(1);
  });

  it("escapes LIKE wildcards so a search is a literal search", () => {
    const { sql, args } = buildGroupListSql({ search: "50%_x" });
    expect(sql).toContain("ESCAPE '\\'");
    expect(args.some((a) => String(a).includes("\\%"))).toBe(true);
  });

  it("ignores a whitespace-only search", () => {
    expect(buildGroupListSql({ search: "   " }).sql).not.toContain("LIKE");
  });
});

describe("list builders", () => {
  it("orders closets and categories by name", () => {
    expect(buildClosetListSql().sql).toContain('ORDER BY "name" ASC');
    expect(buildCategoryListSql().sql).toContain('ORDER BY "name" ASC');
  });

  it("defaults to _ts ordering and clamps the limit", () => {
    expect(buildListSql("parts").sql).toContain('ORDER BY "_ts"');
    expect(buildListSql("parts", { limit: 99999 }).args).toEqual([1000]);
    expect(buildListSql("parts", { limit: 0 }).args).toEqual([1]);
  });

  it("only allows ordering by a real column", () => {
    // `name` lives on groups, not parts — parts is identified by `tag`.
    expect(buildListSql("parts", { orderBy: "tag" }).sql).toContain('ORDER BY "tag"');
    expect(buildListSql("parts", { orderBy: "; DROP TABLE parts" }).sql).toContain(
      'ORDER BY "_ts"',
    );
  });

  it("refuses a table that is not in the migration spec", () => {
    expect(() => buildListSql("nope")).toThrow(/not in the migration spec/);
  });
});