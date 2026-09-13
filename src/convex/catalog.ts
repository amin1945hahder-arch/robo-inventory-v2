import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireInteractingMember, requireNonStudent } from "./lib";
import { telegramGroup } from "./notify";

// ===== Closets =====

export const listClosets = query({
  args: {},
  handler: async (ctx) => {
    await requireNonStudent(ctx);
    const rows = await ctx.db.query("closets").withIndex("by_name").collect();
    return rows;
  },
});

export const getCloset = query({
  args: { id: v.id("closets") },
  handler: async (ctx, { id }) => {
    await requireNonStudent(ctx);
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
    await requireNonStudent(ctx);
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
    await requireNonStudent(ctx);
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
    await requireNonStudent(ctx);
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
    // Counting mode: discrete units (default), or bulk stock tracked by
    // weight (kg/g) or length (m/cm/mm). Bulk groups skip per-unit tags.
    measure: v.optional(
      v.union(v.literal("count"), v.literal("weight"), v.literal("length")),
    ),
    measureUnit: v.optional(v.string()),
    measureStock: v.optional(v.string()),
    measureLowAt: v.optional(v.string()),
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
      measure,
      measureUnit,
      measureStock,
      measureLowAt,
    } = args;
    const isBulk = measure === "weight" || measure === "length";
    if (isBulk) {
      const validUnits: Record<string, string[]> = {
        weight: ["kg", "g"],
        length: ["m", "cm", "mm"],
      };
      if (!measureUnit || !validUnits[measure].includes(measureUnit)) {
        throw new Error(`Pick a unit for ${measure}: ${validUnits[measure].join(" or ")}`);
      }
      const stock = Number(measureStock);
      if (!Number.isFinite(stock) || stock < 0) {
        throw new Error("Stock must be a number ≥ 0");
      }
    }
    if (!id && !isBulk && quantityTotal <= 0) {
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
      quantityTotal: isBulk ? 0 : quantityTotal,
      measure: measure ?? "count",
      measureUnit: isBulk ? measureUnit : undefined,
      measureStock: isBulk ? String(Number(measureStock)) : undefined,
      measureLowAt: isBulk && measureLowAt?.trim() ? String(Number(measureLowAt)) : undefined,
    };
    if (id) {
      await ctx.db.patch(id, data as any);
      return id;
    }
    const groupId = await ctx.db.insert("groups", data as any);

    // Bulk groups (weight/length) have no discrete units to tag.
    if (isBulk) return groupId;

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

// ===== Bulk stock groups (weight / length) =====

/**
 * Request an amount of a bulk-stock group (kg/g or m/cm/mm). Creates a
 * pending rental row (no physical unit) carrying the amount; the admin's
 * approval flow and stock handling stay in one place.
 */
export const requestBulkRental = mutation({
  args: {
    groupId: v.id("groups"),
    amount: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, amount, note }) => {
    const user = await requireInteractingMember(ctx);
    const group = await ctx.db.get(groupId);
    if (!group || group.deleted) throw new Error("Group not found");
    if (group.measure !== "weight" && group.measure !== "length") {
      throw new Error("This group is counted in units, not by weight/length");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter the amount you need");
    }
    const stock = Number(group.measureStock ?? 0);
    if (amount > stock) {
      throw new Error(`Only ${stock} ${group.measureUnit} in stock`);
    }
    // A "placeholder" part row carries the rental ledger for bulk groups —
    // one per group, tagged BULK so it never appears as a physical unit.
    let part = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.eq(q.field("tag"), "BULK"))
      .first();
    if (!part) {
      const partId = await ctx.db.insert("parts", {
        groupId,
        tag: "BULK",
        status: "available",
        note: "Bulk stock holder (weight/length group)",
      });
      part = await ctx.db.get(partId);
    }
    const rentalId = await ctx.db.insert("rentals", {
      partId: part!._id,
      userId: user._id,
      status: "pending",
      requestedAt: Date.now(),
      amount,
    });
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "rental_request",
      text: `${user.name ?? user.email} requested ${amount} ${group.measureUnit} of ${group.name}`,
      link: "/admin/requests",
    });
    await telegramGroup(
      ctx,
      `📤 ${user.name ?? user.email} requested ${amount} ${group.measureUnit} of ${group.name}. Awaiting admin approval.`,
    );
    return { rentalId };
  },
});

/** Admin restocks/corrects the stock of a bulk group. */
export const adjustBulkStock = mutation({
  args: {
    groupId: v.id("groups"),
    newStock: v.number(),
  },
  handler: async (ctx, { groupId, newStock }) => {
    await requireAdmin(ctx);
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.measure !== "weight" && group.measure !== "length") {
      throw new Error("This group is not a bulk-stock group");
    }
    if (!Number.isFinite(newStock) || newStock < 0) throw new Error("Stock must be ≥ 0");
    await ctx.db.patch(groupId, { measureStock: String(newStock) });
    return { ok: true };
  },
});
