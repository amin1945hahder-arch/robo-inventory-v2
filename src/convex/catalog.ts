import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";

// ===== Closets =====

export const listClosets = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("closets").withIndex("by_name").collect();
    return rows;
  },
});

export const getCloset = query({
  args: { id: v.id("closets") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db.get(id);
  },
});

export const upsertCloset = mutation({
  args: {
    id: v.optional(v.id("closets")),
    name: v.string(),
    location: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, location, note }) => {
    await requireAdmin(ctx);
    const data = { name: name.trim(), location: location?.trim(), note: note?.trim() };
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("closets", data);
  },
});

export const deleteCloset = mutation({
  args: { id: v.id("closets") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_closet", (q) => q.eq("closetId", id))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    if (groups.length > 0) {
      throw new Error("Closet still contains groups. Move or delete them first.");
    }
    await ctx.db.delete(id);
  },
});

// ===== Categories =====

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("categories").withIndex("by_name").collect();
    return rows;
  },
});

export const upsertCategory = mutation({
  args: {
    id: v.optional(v.id("categories")),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, description }) => {
    await requireAdmin(ctx);
    const data = { name: name.trim(), description: description?.trim() };
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("categories", data);
  },
});

export const deleteCategory = mutation({
  args: { id: v.id("categories") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_category", (q) => q.eq("categoryId", id))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    if (groups.length > 0) {
      throw new Error("Category still contains groups. Move or delete them first.");
    }
    await ctx.db.delete(id);
  },
});

// ===== Groups (component types / cards) =====

export const listGroups = query({
  args: {
    categoryId: v.optional(v.id("categories")),
    closetId: v.optional(v.id("closets")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { categoryId, closetId, search }) => {
    await requireUser(ctx);
    let rows = await ctx.db
      .query("groups")
      .withIndex("by_category")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    if (closetId) {
      rows = rows.filter((g) => g.closetId === closetId);
    }
    if (categoryId) {
      rows = rows.filter((g) => g.categoryId === categoryId);
    }
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(
        (g) =>
          g.name.toLowerCase().includes(s) ||
          (g.brand ?? "").toLowerCase().includes(s) ||
          (g.model ?? "").toLowerCase().includes(s) ||
          (g.description ?? "").toLowerCase().includes(s),
      );
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getGroup = query({
  args: { id: v.id("groups") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db.get(id);
  },
});

export const upsertGroup = mutation({
  args: {
    id: v.optional(v.id("groups")),
    name: v.string(),
    categoryId: v.id("categories"),
    closetId: v.id("closets"),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    description: v.optional(v.string()),
    datasheetUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    quantityTotal: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const {
      id,
      name,
      categoryId,
      closetId,
      brand,
      model,
      description,
      datasheetUrl,
      imageUrl,
      quantityTotal,
    } = args;
    if (!id && quantityTotal <= 0) {
      throw new Error("Total quantity must be at least 1");
    }
    const data = {
      name: name.trim(),
      categoryId,
      closetId,
      brand: brand?.trim(),
      model: model?.trim(),
      description: description?.trim(),
      datasheetUrl: datasheetUrl?.trim(),
      imageUrl: imageUrl?.trim(),
      quantityTotal,
    };
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    const groupId = await ctx.db.insert("groups", data);

    // create physical parts (individual QR tags) for the group
    const prefix = name
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 3)
      .padEnd(3, "X");
    const existing = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    let n = existing.length + 1;
    for (let i = 0; i < quantityTotal; i++) {
      let tag = `${prefix}-${String(n).padStart(3, "0")}`;
      while (await ctx.db.query("parts").withIndex("by_tag", (q) => q.eq("tag", tag)).first()) {
        n += 1;
        tag = `${prefix}-${String(n).padStart(3, "0")}`;
      }
      await ctx.db.insert("parts", { groupId, tag, status: "available" });
      n += 1;
    }
    return groupId;
  },
});

export const deleteGroup = mutation({
  args: { id: v.id("groups") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_group", (q: any) => q.eq("groupId", id))
      .collect();
    for (const p of parts) {
      if (p.status === "rented" || p.status === "on_project") {
        throw new Error("This group has parts out on rent or projects. Process returns first.");
      }
      await ctx.db.delete((p as any)._id);
    }
    await ctx.db.delete(id);
  },
});

export const addPartToGroup = mutation({
  args: { groupId: v.id("groups"), count: v.optional(v.number()) },
  handler: async (ctx: any, args: any) => {
    const groupId = args.groupId as string;
    const count = args.count as number | undefined;
    await requireAdmin(ctx);
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    const n = Math.max(1, Math.min(count ?? 1, 50));
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
      .collect();
    let num = parts.length + 1;
    const prefix = (group as any).name
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .map((w: string) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 3)
      .padEnd(3, "X");
    for (let i = 0; i < n; i++) {
      let tag = `${prefix}-${String(num).padStart(3, "0")}`;
      while (
        await ctx.db
          .query("parts")
          .withIndex("by_tag", (q: any) => q.eq("tag", tag))
          .first()
      ) {
        num += 1;
        tag = `${prefix}-${String(num).padStart(3, "0")}`;
      }
      await ctx.db.insert("parts", { groupId, tag, status: "available" });
      num += 1;
    }
    await ctx.db.patch(groupId, { quantityTotal: parts.length + n });
    return parts.length + n;
  },
});
