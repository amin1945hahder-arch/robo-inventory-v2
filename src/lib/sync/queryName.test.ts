import { describe, expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { queryNameOf } from "./queryName";
import { cacheKey } from "./queryCache";

/**
 * Regression tests for the bug that blanked every route on devices with a
 * populated offline cache: Convex function references expose their name only
 * through the `functionName` symbol, not a `url` property. Reading `.url`
 * returned `undefined` for every query, so all cache entries collapsed onto the
 * single key `<user>|unknown|<args>` and pages could hydrate from another
 * query's result (an object where an array was expected) and throw
 * `TypeError: (x ?? []) is not iterable`.
 */
describe("queryNameOf", () => {
  it("resolves generated api references (which have no `url`)", () => {
    expect(queryNameOf(api.notifications.listPeople)).toBe("notifications/listPeople");
    expect(queryNameOf(api.stats.overview)).toBe("stats/overview");
    expect(queryNameOf(api.parts.listMyRentals)).toBe("parts/listMyRentals");
  });

  it("resolves a bare function reference", () => {
    expect(queryNameOf(makeFunctionReference("parts:listMyRentals"))).toBe("parts/listMyRentals");
  });

  it("never collapses different queries onto one cache key", () => {
    const user = "user1";
    const people = cacheKey(queryNameOf(api.notifications.listPeople), {}, user);
    const overview = cacheKey(queryNameOf(api.stats.overview), {}, user);
    expect(people).not.toBe(overview);
    expect(people).toContain("notifications/listPeople");
    expect(overview).toContain("stats/overview");
  });

  it("falls back to a scoped key for non-references instead of throwing", () => {
    expect(queryNameOf(undefined)).toBe("unknown");
    expect(queryNameOf({})).toBe("unknown");
    // Convex accepts a plain "module:function" string as a reference too.
    expect(queryNameOf("parts:listMyRentals")).toBe("parts/listMyRentals");
  });
});
