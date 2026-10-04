import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";

/**
 * Admin-editable club lists, stored in the clubLists table as one row per
 * list. Members' UI selects (profile, People editor) read these lists, and
 * the Settings page can fully add/edit/delete every entry.
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

export type RankRoleMap = Record<string, "admin" | "member" | "student">;

// Priority when a person holds several mapped ranks: the strongest wins.
const ROLE_RANK: Record<string, number> = { admin: 3, member: 2, student: 1 };

/** Server-side read of the map (settings-style row in clubLists). */
export async function getRankRoleMap(ctx: QueryCtx): Promise<RankRoleMap> {
  const row = await ctx.db
    .query("clubLists")
    .withIndex("by_list_key", (q) => q.eq("listKey", RANK_ROLE_MAP_KEY))
    .unique();
  if (!row) return {};
  const out: RankRoleMap = {};
  // Values are stored as "rank=>role" strings so they live in the same
  // array-shaped list row as every other club list.
  for (const entry of row.values) {
    const [rank, role] = entry.split("=>");
    if (rank && role && ROLE_RANK[role]) {
      out[rank.trim()] = role.trim() as RankRoleMap[string];
    }
  }
  return out;
}

/** The strongest mapped role among a person's ranks (undefined = no match). */
export function mappedRoleFor(
  map: RankRoleMap,
  roles: string[] | undefined,
): "admin" | "member" | "student" | undefined {
  if (!roles?.length) return undefined;
  let best: "admin" | "member" | "student" | undefined;
  for (const r of roles) {
    const mapped = map[r];
    if (mapped && (!best || ROLE_RANK[mapped] > ROLE_RANK[best])) best = mapped;
  }
  return best;
}

/** Current rank → role assignments (admin: the settings editor). */
export const getRankRoleMapQuery = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await getRankRoleMap(ctx);
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
    const values = [
      ...new Set(
        entries
          .map((e) => `${e.rank.trim()}=>${e.role}`)
          .filter((s) => s.split("=>")[0].length > 0),
      ),
    ];
    const row = await ctx.db
      .query("clubLists")
      .withIndex("by_list_key", (q) => q.eq("listKey", RANK_ROLE_MAP_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { values });
    else await ctx.db.insert("clubLists", { listKey: RANK_ROLE_MAP_KEY, values });
    return { ok: true };
  },
});
