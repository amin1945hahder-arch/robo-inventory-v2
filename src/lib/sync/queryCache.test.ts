import { describe, expect, it } from "vitest";
import {
  cacheKey,
  decideFreshness,
  shouldSkipPersist,
  stableStringify,
  DEFAULT_MAX_AGE_MS,
} from "./queryCache";

describe("stableStringify", () => {
  it("is order-independent so the same args share one entry", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
    expect(stableStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it("sorts nested objects too", () => {
    expect(stableStringify({ f: { z: 1, a: 2 } })).toBe('{"f":{"a":2,"z":1}}');
  });

  it("treats undefined, null and arrays predictably", () => {
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify([1, "a"])).toBe('[1,"a"]');
  });

  it("drops undefined values instead of forking the key", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify({ a: 1 })).toBe(stableStringify({ a: 1, b: undefined }));
  });
});

describe("cacheKey", () => {
  it("scopes entries per user so shared devices never cross-read", () => {
    const a = cacheKey("parts/list", {}, "userA");
    const b = cacheKey("parts/list", {}, "userB");
    expect(a).not.toBe(b);
    expect(a.startsWith("userA|")).toBe(true);
  });

  it("is stable for the same query + args", () => {
    expect(cacheKey("parts/list", { a: 1 }, "u")).toBe(cacheKey("parts/list", { a: 1 }, "u"));
  });

  it("distinguishes different queries and different args", () => {
    expect(cacheKey("parts/list", {}, "u")).not.toBe(cacheKey("rentals/list", {}, "u"));
    expect(cacheKey("parts/list", { a: 1 }, "u")).not.toBe(cacheKey("parts/list", { a: 2 }, "u"));
  });

  it("falls back to an anonymous scope with no user", () => {
    expect(cacheKey("parts/list", {}, null).startsWith("anon|")).toBe(true);
    expect(shouldSkipPersist(cacheKey("parts/list", {}, null))).toBe(true);
    expect(shouldSkipPersist(cacheKey("parts/list", {}, "u1"))).toBe(false);
  });
});

describe("decideFreshness", () => {
  const now = 1_700_000_000_000;

  it("reports a miss when nothing is cached", () => {
    const d = decideFreshness(undefined, { now, online: true });
    expect(d.freshness).toBe("miss");
    expect(d.needsRevalidate).toBe(true);
  });

  it("treats a corrupt entry (no storedAt) as a miss", () => {
    const d = decideFreshness({ value: [], storedAt: undefined as never }, { now, online: true });
    expect(d.freshness).toBe("miss");
  });

  it("serves a recent entry as fresh with no refetch", () => {
    const d = decideFreshness({ value: [1], storedAt: now - 1000 }, { now, online: true });
    expect(d.freshness).toBe("fresh");
    expect(d.needsRevalidate).toBe(false);
  });

  it("serves an aged entry as stale AND asks for a refetch when online", () => {
    const d = decideFreshness(
      { value: [1], storedAt: now - (DEFAULT_MAX_AGE_MS + 1) },
      { now, online: true },
    );
    expect(d.freshness).toBe("stale");
    expect(d.needsRevalidate).toBe(true);
  });

  it("serves anything cached while offline, and never asks to refetch", () => {
    const ancient = { value: ["stale data"], storedAt: now - 10 * DEFAULT_MAX_AGE_MS };
    const d = decideFreshness(ancient, { now, online: false });
    expect(d.freshness).toBe("stale");
    expect(d.needsRevalidate).toBe(false);
  });

  it("clamps a future timestamp (clock skew) to age 0", () => {
    const d = decideFreshness({ value: 1, storedAt: now + 5_000 }, { now, online: true });
    expect(d.ageMs).toBe(0);
    expect(d.freshness).toBe("fresh");
  });

  it("honours a custom maxAge", () => {
    const d = decideFreshness(
      { value: 1, storedAt: now - 5_000 },
      { now, online: true, maxAgeMs: 1_000 },
    );
    expect(d.freshness).toBe("stale");
  });
});