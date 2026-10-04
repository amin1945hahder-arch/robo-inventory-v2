import { describe, expect, it } from "vitest";
import { convexToJson } from "convex/values";
import type { JSONValue } from "convex/values";
import {
  APP_ROLE_KEYS,
  hasOnlyAsciiFieldNames,
  isAppRole,
  parseRankRoleValues,
  rankRoleEntriesToMap,
  ROLE_RANK,
  serializeRankRoleEntries,
  strongestMappedRole,
} from "./rank-role-map";

/** The positions this club really uses — Arabic, i.e. non-ASCII field names. */
const RANKS = ["رئيس نادي الروبوت", "منسق النادي", "عضو إداري", "مدرب"];

describe("parseRankRoleValues", () => {
  it("returns entries, never an object keyed by rank", () => {
    const values = RANKS.map((rank, i) => `${rank}=>${APP_ROLE_KEYS[i] ?? "member"}`);
    const entries = parseRankRoleValues(values);

    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(RANKS.length);
    expect(entries[0]).toEqual({ rank: RANKS[0], role: "admin" });
    expect(Object.keys(entries[0]!)).toEqual(["rank", "role"]);
  });

  it("REGRESSION: every payload field name is ASCII for Arabic ranks", () => {
    // The bug: getRankRoleMapQuery returned a Record keyed by rank name, so
    // Convex hit `Field name إداري has invalid character 'إ'`.
    const entries = parseRankRoleValues(RANKS.map((r) => `${r}=>admin`));
    expect(hasOnlyAsciiFieldNames(entries)).toBe(true);
    // And the old shape is exactly what must never cross the wire.
    expect(hasOnlyAsciiFieldNames(rankRoleEntriesToMap(entries))).toBe(false);
  });

  it("survives a JSON round-trip with Arabic values intact", () => {
    const entries = parseRankRoleValues(["عضو إداري=>member"]);
    expect(JSON.parse(JSON.stringify(entries))).toEqual([
      { rank: "عضو إداري", role: "member" },
    ]);
  });

  it("trims whitespace and drops blanks / junk entries", () => {
    const entries = parseRankRoleValues([
      "  مدير  =>  admin  ",
      "   => member",
      "no-separator",
      "مدرب=>wizard",
      "   ",
      "member=>admin",
    ]);
    expect(entries).toEqual([
      { rank: "مدير", role: "admin" },
      { rank: "member", role: "admin" },
    ]);
  });

  it("lets the last entry win for a repeated rank", () => {
    expect(parseRankRoleValues(["مدرب=>student", "مدرب=>admin"])).toEqual([
      { rank: "مدرب", role: "admin" },
    ]);
  });

  it("is empty for an unset mapping", () => {
    expect(parseRankRoleValues([])).toEqual([]);
  });
});

describe("serializeRankRoleEntries", () => {
  it("round-trips through the stored string form", () => {
    const entries = parseRankRoleValues(RANKS.map((r) => `${r}=>member`));
    expect(parseRankRoleValues(serializeRankRoleEntries(entries))).toEqual(entries);
  });

  it("drops invalid roles and de-duplicates", () => {
    expect(
      serializeRankRoleEntries([
        { rank: "مدرب", role: "student" },
        { rank: "مدرب", role: "student" },
        { rank: "", role: "admin" },
        { rank: "x", role: "wizard" as never },
      ]),
    ).toEqual(["مدرب=>student"]);
  });
});

describe("strongestMappedRole", () => {
  const stored = (rank: string, role: string) => `${rank}=>${role}`;
  const map = rankRoleEntriesToMap(
    parseRankRoleValues([
      stored("رئيس", "admin"),
      stored("مدرب", "member"),
      stored("طالب", "student"),
    ]),
  );

  it("returns the strongest match when several positions are held", () => {
    expect(strongestMappedRole(map, ["مدرب", "رئيس"])).toBe("admin");
    expect(strongestMappedRole(map, ["طالب", "مدرب"])).toBe("member");
  });

  it("returns undefined with no positions or no match", () => {
    expect(strongestMappedRole(map, [])).toBeUndefined();
    expect(strongestMappedRole(map, undefined)).toBeUndefined();
    expect(strongestMappedRole(map, ["unknown"])).toBeUndefined();
  });

  it("ranks admin above member above student", () => {
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.member);
    expect(ROLE_RANK.member).toBeGreaterThan(ROLE_RANK.student);
  });
});

describe("Convex serialization (the real crash)", () => {
  it("reproduces the original server error with a rank-keyed object", () => {
    // Exactly what getRankRoleMapQuery used to return.
    expect(() =>
      convexToJson({ "عضو إداري": "member" } as unknown as JSONValue),
    ).toThrowError(/invalid character/);
  });

  it("serializes the new query payload without throwing", () => {
    const payload = parseRankRoleValues([
      `${RANKS[0]}=>admin`,
      `${RANKS[1]}=>member`,
      `${RANKS[2]}=>member`,
      `${RANKS[3]}=>student`,
    ]);
    // The same serializer that produced the Server Error on the Settings page.
    expect(() => convexToJson(payload as unknown as JSONValue)).not.toThrow();
    const json = convexToJson(payload as unknown as JSONValue);
    expect(Array.isArray(json)).toBe(true);
    expect((json as { rank: string }[]).map((e) => e.rank)).toEqual(RANKS);
  });
});

describe("isAppRole", () => {
  it("accepts only the three app roles", () => {
    expect(APP_ROLE_KEYS.every(isAppRole)).toBe(true);
    expect(isAppRole("wizard")).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });
});