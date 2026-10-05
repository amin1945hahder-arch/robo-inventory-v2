import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";
import {
  isAppRole,
  parseRankRoleValues,
  serializeRankRoleEntries,
  strongestMappedRole,
  type AppRoleKey,
  type RankRoleEntry,
} from "../lib/rank-role-map";

/**
 * Admin-editable club lists, stored in the clubLists table as one row per
 * list. Members' UI selects (profile, People editor) read these lists, and
 * the Settings page can fully add/edit/delete every entry.
 *
 * WHY THIS MODULE IS STILL 100% CONVEX
 * ------------------------------------
 * `clubLists` looks like an easy first table to move to Turso: its reads are
 * all here, and two mutations is a small diff. It is NOT, because of the rank →
 * role mapping.
 *
 * `getRankRoleMap` is read *inside three Convex mutations in `users.ts`*
 * (person edit, person create, rank-request approval) to decide whether
 * granting a club position should also grant the mapped app role. A Convex
 * MUTATION context has no `ctx.runAction` — only queries and actions do — so
 * those mutations cannot reach Turso at all. Moving the writes without also
 * converting those three mutations would leave them reading a frozen Convex
 * copy of the map, silently breaking the auto-role-grant rule.
 *
 * So the table is kept whole on Convex: one source of truth, no staleness. It
 * moves when `users.ts` moves, as one unit. See TURSO_CUTOVER.md §1.21.
 */

export type ListKey = "clubRoles" | "academicStates";

const DEFAULTS: Record<ListKey, string[]> = {
  clubRoles: [
    "رئيس نادي الروبوت",
    "منسق النادي",
    "عضو علمي",
    "عضو إداري",
    "مدرب",
    "عضو إعلامي",
  ],
  academicStates: ["دكتوراه", "ماجستير", "جامعي", "مُتخرج"],
};

// Any signed-in user may read (profile + People editor both need the lists).
export const getList = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("clubLists")
      .withIndex("by_list_key", (q) => q.eq("listKey", key))
      .unique();
    return row?.values ?? DEFAULTS[key as ListKey] ?? [];
  },
});

export const setList = mutation({
  args: { key: v.string(), values: v.array(v.string()) },
  handler: async (ctx, { key, values }) => {
    await requireAdmin(ctx);
    const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
    const row = await ctx.db
      .query("clubLists")
      .withIndex("by_list_key", (q) => q.eq("listKey", key))
      .unique();
    if (row) await ctx.db.patch(row._id, { values: clean });
    else await ctx.db.insert("clubLists", { listKey: key, values: clean });
    return { ok: true, count: clean.length };
  },
});

// ===== Rank → app-role mapping =============================================

// The admin can MARK a club rank/position (e.g. "manager") as one of the
// app's main roles. Whenever that rank is requested and approved — or set on
// a person directly — the mapped role is applied automatically (skipped when
// the person already holds it).

export const RANK_ROLE_MAP_KEY = "rankRoleMap";

/**
 * In-memory lookup of rank → role. NEVER return this from a query: the rank
 * names are Arabic, and Convex encodes object keys as JSON field names (ASCII
 * only) — returning it crashed the Settings page with
 * "Field name إداري has invalid character 'إ'". Query results must use the
 * `{ rank, role }[]` entry list instead.
 */
export type RankRoleMap = Record<string, AppRoleKey>;

/** The stored `"rank=>role"` strings, parsed into wire-safe entries. */
export function rankRoleEntries(ctx: QueryCtx): Promise<RankRoleEntry[]> {
  return ctx.db
    .query("clubLists")
    .withIndex("by_list_key", (q) => q.eq("listKey", RANK_ROLE_MAP_KEY))
    .unique()
    .then((row) => parseRankRoleValues(row?.values ?? []));
}

/** Server-side read of the map (settings-style row in clubLists). */
export async function getRankRoleMap(ctx: QueryCtx): Promise<RankRoleMap> {
  const entries = await rankRoleEntries(ctx);
  const out: RankRoleMap = {};
  for (const { rank, role } of entries) out[rank] = role;
  return out;
}

/** The strongest mapped role among a person's ranks (undefined = no match). */
export function mappedRoleFor(
  map: RankRoleMap,
  roles: string[] | undefined,
): AppRoleKey | undefined {
  return strongestMappedRole(map, roles);
}

/**
 * Current rank → role assignments for the Settings editor.
 *
 * Returns an ARRAY of `{ rank, role }` — never a map keyed by rank. Arabic
 * rank names used as object keys make Convex throw on serialization, which
 * took the whole page down. See src/lib/rank-role-map.ts.
 */
export const getRankRoleMapQuery = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await rankRoleEntries(ctx);
  },
});

/** Save the whole rank → role map (admin). */
export const setRankRoleMap = mutation({
  args: {
    entries: v.array(
      v.object({
        rank: v.string(),
        role: v.union(v.literal("admin"), v.literal("member"), v.literal("student")),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    await requireAdmin(ctx);
    // Same clean-up the parser does, applied before writing: trimmed ranks,
    // no blanks, no duplicates.
    const values = serializeRankRoleEntries(
      entries.filter((e) => e.rank.trim().length > 0 && isAppRole(e.role)),
    );
    const row = await ctx.db
      .query("clubLists")
      .withIndex("by_list_key", (q) => q.eq("listKey", RANK_ROLE_MAP_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { values });
    else await ctx.db.insert("clubLists", { listKey: RANK_ROLE_MAP_KEY, values });
    return { ok: true };
  },
});