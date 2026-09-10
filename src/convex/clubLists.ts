import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
