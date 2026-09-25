import { v } from "convex/values";
import { matchesSearch } from "../lib/searchText";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireInteractingMember, requireNonStudent } from "./lib";
import { telegramGroup } from "./notify";
import { planMeasureTake } from "../lib/measure-alloc";

/** Sum of a group's per-unit amounts (bulk groups keep stock per unit). */
export async function sumUnitStock(ctx: any, groupId: string): Promise<number> {
  const parts = await ctx.db
    .query("parts")
    .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
    .filter((q: any) => q.neq(q.field("deleted"), true))
    .collect();
  return parts.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0);
}

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

const normalizeName = (s: string) => s.trim().toLowerCase();

export const upsertCloset = mutation({
  args: {
    id: v.optional(v.id("closets")),
    name: v.string(),
    location: v.optional(v.string()),
    note: v.optional(v.string()),
    // Storage photo (compressed data URL or URL). "" clears; omit to keep.
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, location, note, imageUrl }) => {
    await requireAdmin(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("Name is required");
    // No duplicate storages: match case-insensitively against every closet.
    const dup = await ctx.db
      .query("closets")
      .withIndex("by_name", (q) => q.eq("name", clean))
      .first();
    if (dup && dup._id !== id) {
      throw new Error(`A storage named “${dup.name}” already exists`);
    }
    const all = await ctx.db.query("closets").collect();
    const dupLoose = all.find(
      (c) => normalizeName(c.name) === normalizeName(clean) && c._id !== id,
    );
    if (dupLoose) {
      throw new Error(`A storage named “${dupLoose.name}” already exists`);
    }
    const data: Record<string, unknown> = {
      name: clean,
      location: location?.trim(),
      note: note?.trim(),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl.trim() || undefined } : {}),
    };
    if (id) {
      await ctx.db.patch(id, data as any);
      return id;
    }
    return await ctx.db.insert("closets", data as any);
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
    // Consumables (filament, wire…) get consumption logging + recovered-amount
    // returns instead of strict unit returns. Omit to keep the current value.
    consumable: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, name, description, consumable }) => {
    await requireAdmin(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("Name is required");
    // No duplicate categories: exact + case-insensitive check.
    const dup = await ctx.db
      .query("categories")
      .withIndex("by_name", (q) => q.eq("name", clean))
      .first();
    if (dup && dup._id !== id) {
      throw new Error(`A category named “${dup.name}” already exists`);
    }
    const all = await ctx.db.query("categories").collect();
    const dupLoose = all.find(
      (c) => normalizeName(c.name) === normalizeName(clean) && c._id !== id,
    );
    if (dupLoose) {
      throw new Error(`A category named “${dupLoose.name}” already exists`);
    }
    const data = {
      name: clean,
      description: description?.trim(),
      ...(consumable !== undefined ? { consumable } : {}),
    };
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("categories", data);
  },
});

/** Toggle a category's consumable flag (Settings / Inventory structure). */
export const setCategoryConsumable = mutation({
  args: { id: v.id("categories"), consumable: v.boolean() },
  handler: async (ctx, { id, consumable }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, { consumable });
    return { ok: true };
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
      // Deep match: any string field counts — including datasheet URLs and
      // every field added to groups in the future.
      rows = rows.filter((g) => matchesSearch(g, search));
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

// Container (group-of-groups) picker options: every active group, shallow.
// The form filters out the current group's own subtree client-side.
export const childGroupOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireNonStudent(ctx);
    return await ctx.db
      .query("groups")
      .withIndex("by_category")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
  },
});

/**
 * Groups whose NAME matches a storage name (e.g. a group literally called
 * "Closet 1") are storage aliases: their printed QR resolves to the storage
 * itself, so lending through them would mislead — block new rentals but keep
 * editing, unit management and returns fully working.
 */
export async function assertGroupLendable(ctx: any, groupId: string): Promise<any> {
  const group = await ctx.db.get(groupId);
  if (!group) throw new Error("Group not found");
  const match = await ctx.db
    .query("closets")
    .withIndex("by_name", (q: any) => q.eq("name", group.name))
    .first();
  if (match) {
    throw new Error(
      `“${group.name}” is a storage alias (its QR opens the storage) — it cannot be lent. Give the group a different name or edit it instead.`,
    );
  }
  return group;
}

/** Does this group have child groups (i.e. is it a master container)? */
export async function hasChildGroups(ctx: any, groupId: string): Promise<boolean> {
  const all = await ctx.db
    .query("groups")
    .withIndex("by_category")
    .filter((q: any) => q.neq(q.field("deleted"), true))
    .collect();
  return all.some((g: any) => g.parentGroupId === groupId);
}

/**
 * A master container holds GROUPS only, never units. The moment a container
 * gains its first child group it is converted: its stray auto-created
 * available units are removed; units that are lent out/broken etc. block the
 * conversion until the admin deals with them.
 */
async function becomeMasterContainer(ctx: any, containerId: string): Promise<void> {
  if (await hasChildGroups(ctx, containerId)) return; // already a master
  const units = await ctx.db
    .query("parts")
    .withIndex("by_group", (q: any) => q.eq("groupId", containerId))
    .filter((q: any) => q.neq(q.field("deleted"), true))
    .collect();
  const name = (await ctx.db.get(containerId))?.name ?? "This container";
  for (const u of units) {
    if (u.status !== "available") {
      throw new Error(
        `“${name}” still has units that are not available — deal with them first. Master containers hold groups only, not units.`,
      );
    }
    await ctx.db.delete(u._id);
  }
}

export const upsertGroup = mutation({
  args: {
    id: v.optional(v.id("groups")),
    name: v.string(),
    categoryId: v.id("categories"),
    closetId: v.id("closets"),
    // Group-of-groups: put this group inside a container group (a box of
    // mixed components). null clears; omit to keep the current value.
    parentGroupId: v.optional(v.union(v.id("groups"), v.null())),
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
      parentGroupId,
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
        // A blank starting stock is fine — units carry the real amounts.
        throw new Error("Stock must be a number ≥ 0");
      }
    }
    if (!id && !isBulk && quantityTotal <= 0) {
      throw new Error("Total quantity must be at least 1");
    }
    // Container (parent group) validation: must exist, not be the group
    // itself, and must not create a cycle (a box inside its own box).
    if (parentGroupId) {
      if (id && parentGroupId === id) {
        throw new Error("A group cannot contain itself");
      }
      let cursor: any = await ctx.db.get(parentGroupId);
      if (!cursor || cursor.deleted) throw new Error("Container group not found");
      if (cursor.measure === "weight" || cursor.measure === "length") {
        throw new Error("Weight/length stock groups hold material, not groups — pick a different container");
      }
      let depth = 0;
      while (cursor?.parentGroupId && depth < 10) {
        if (id && cursor.parentGroupId === id) {
          throw new Error("That container is inside this group — it would create a loop");
        }
        cursor = await ctx.db.get(cursor.parentGroupId);
        depth += 1;
      }
    }
    const data: Record<string, unknown> = {
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
      ...(parentGroupId !== undefined
        ? { parentGroupId: (parentGroupId || undefined) as any }
        : {}),
    };
    // Gaining its first child turns the container into a master (groups only).
    if (parentGroupId) {
      await becomeMasterContainer(ctx, parentGroupId);
    }
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

/**
 * Move a group into a container group (or out to the top level with
 * parentGroupId = null). Validates cycles and converts the container into a
 * master (groups only) when it gains its first child.
 */
export const moveGroupToContainer = mutation({
  args: {
    groupId: v.id("groups"),
    // Target container; null moves the group to the top level.
    parentGroupId: v.optional(v.union(v.id("groups"), v.null())),
  },
  handler: async (ctx, { groupId, parentGroupId }) => {
    await requireAdmin(ctx);
    const group = await ctx.db.get(groupId);
    if (!group || group.deleted) throw new Error("Group not found");
    if (parentGroupId) {
      if (parentGroupId === groupId) {
        throw new Error("A group cannot contain itself");
      }
      let cursor: any = await ctx.db.get(parentGroupId);
      if (!cursor || cursor.deleted) throw new Error("Container group not found");
      if (cursor.measure === "weight" || cursor.measure === "length") {
        throw new Error("Weight/length stock groups hold material, not groups — pick a different container");
      }
      let depth = 0;
      while (cursor?.parentGroupId && depth < 10) {
        if (cursor.parentGroupId === groupId) {
          throw new Error("That container is inside this group — it would create a loop");
        }
        cursor = await ctx.db.get(cursor.parentGroupId);
        depth += 1;
      }
      // Gaining its first child turns the container into a master.
      await becomeMasterContainer(ctx, parentGroupId);
    }
    await ctx.db.patch(groupId, { parentGroupId: (parentGroupId || undefined) as any });
    return { ok: true };
  },
});

export const deleteGroup = mutation({
  args: { id: v.id("groups") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    if (await hasChildGroups(ctx, id)) {
      throw new Error("This container holds groups — move or delete them first.");
    }
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
  args: {
    groupId: v.id("groups"),
    count: v.optional(v.number()),
    // Weight/length groups: the amount the new unit holds, in the group's
    // measureUnit (e.g. 3 meters). Required so every unit starts with stock.
    amount: v.optional(v.number()),
    // Per-unit minimum — pre-filled from the group's measureLowAt.
    lowAt: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    const groupId = args.groupId as string;
    const count = args.count as number | undefined;
    await requireAdmin(ctx);
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    // Master containers hold groups, not units.
    if (await hasChildGroups(ctx, groupId)) {
      throw new Error("Master containers hold groups, not units — add groups inside it instead");
    }
    const isBulk = group.measure === "weight" || group.measure === "length";
    const n = Math.max(1, Math.min(count ?? 1, 50));
    if (isBulk && n > 1) {
      throw new Error("Add bulk units one at a time — each holds its own amount");
    }
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
      const partData: any = { groupId, tag, status: "available" };
      if (isBulk) {
        // Bulk groups also carry the hidden BULK placeholder for the rental
        // ledger — never re-create or number it here.
        if (tag === "BULK") continue;
        const amount = Number(args.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error(`Set the amount this unit holds (in ${group.measureUnit ?? "units"})`);
        }
        partData.amountRemaining = String(amount);
        partData.lowAt = String(
          Number.isFinite(Number(args.lowAt)) && Number(args.lowAt) >= 0
            ? Number(args.lowAt)
            : Number(group.measureLowAt ?? 0),
        );
      }
      await ctx.db.insert("parts", partData);
      num += 1;
    }
    if (isBulk) {
      // Keep the group's headline stock in sync with the per-unit ledger.
      const stock = await sumUnitStock(ctx, groupId);
      await ctx.db.patch(groupId, { measureStock: String(stock) });
    } else {
      await ctx.db.patch(groupId, { quantityTotal: parts.length + n });
    }
    return parts.length + n;
  },
});

/** Admin edits a bulk unit's remaining amount / minimum (re-weighed reel…). */
export const updateBulkUnit = mutation({
  args: {
    partId: v.id("parts"),
    amountRemaining: v.number(),
    lowAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { partId, amountRemaining, lowAt, note }) => {
    const admin = await requireAdmin(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("Unit not found");
    const group = await ctx.db.get(part.groupId);
    if (!group || (group.measure !== "weight" && group.measure !== "length")) {
      throw new Error("Only weight/length group units carry amounts");
    }
    if (!Number.isFinite(amountRemaining) || amountRemaining < 0) {
      throw new Error("Amount must be ≥ 0");
    }
    const previous = Number(part.amountRemaining ?? 0);
    const delta = Math.round((amountRemaining - previous) * 10000) / 10000;
    await ctx.db.patch(partId, {
      amountRemaining: String(amountRemaining),
      // Stock came back → the unit is no longer "fully consumed".
      ...(amountRemaining > 0 ? { consumedAt: undefined } : {}),
      ...(lowAt !== undefined ? { lowAt: String(lowAt) } : {}),
      ...(note !== undefined ? { note: note.trim() } : {}),
      ...(delta !== 0
        ? {
            consumptionLog: [
              ...(part.consumptionLog ?? []).slice(-49),
              {
                amount: delta,
                at: Date.now(),
                byId: admin._id,
                byName: admin.name ?? admin.email,
                via: "adjust" as const,
              },
            ],
          }
        : {}),
    });
    const stock = await sumUnitStock(ctx, part.groupId);
    await ctx.db.patch(group._id, { measureStock: String(stock) });
    return { ok: true };
  },
});

/**
 * Routine-consumption writes for weight/length units (NOT rentals): log that
 * some amount was used up in the lab and deduct it from the unit, or mark the
 * unit FULLY consumed in one click. The minimum (lowAt) does not apply here —
 * that guard only protects rental cuts.
 */
export const consumeBulkUnit = mutation({
  args: {
    partId: v.id("parts"),
    // Amount consumed now; omit when `fully` is set (the whole remainder).
    amount: v.optional(v.number()),
    fully: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { partId, amount, fully, note }) => {
    const admin = await requireAdmin(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("Unit not found");
    const group = await ctx.db.get(part.groupId);
    if (!group || (group.measure !== "weight" && group.measure !== "length")) {
      throw new Error("Only weight/length group units carry amounts");
    }
    const remaining = Number(part.amountRemaining ?? 0);
    const entry = {
      at: Date.now(),
      byId: admin._id,
      byName: admin.name ?? admin.email,
      via: (fully ? "full" : "manual") as "full" | "manual",
      note: note?.trim() || undefined,
    };
    if (fully) {
      // Fully consumed: everything still on the unit is written off.
      if (remaining <= 0) throw new Error("This unit is already empty");
      await ctx.db.patch(partId, {
        amountRemaining: "0",
        consumedAt: Date.now(),
        consumptionLog: [
          ...(part.consumptionLog ?? []).slice(-49),
          { ...entry, amount: -remaining },
        ],
      });
      const stock = await sumUnitStock(ctx, part.groupId);
      await ctx.db.patch(group._id, { measureStock: String(stock) });
      return { consumed: remaining };
    }
    if (!Number.isFinite(amount) || (amount ?? 0) <= 0) {
      throw new Error(`Enter the consumed amount (in ${group.measureUnit ?? "units"})`);
    }
    if (amount! > remaining + 1e-9) {
      throw new Error(
        `Only ${remaining} ${group.measureUnit ?? "units"} left on this unit — use “Fully consumed” to write it all off`,
      );
    }
    const left = Math.max(0, Math.round((remaining - amount!) * 10000) / 10000);
    await ctx.db.patch(partId, {
      amountRemaining: String(left),
      // Emptied by hand == fully consumed as well.
      consumedAt: left <= 0 ? Date.now() : undefined,
      consumptionLog: [
        ...(part.consumptionLog ?? []).slice(-49),
        { ...entry, amount: -Math.round(amount! * 10000) / 10000 },
      ],
    });
    const stock = await sumUnitStock(ctx, part.groupId);
    await ctx.db.patch(group._id, { measureStock: String(stock) });
    return { consumed: amount };
  },
});

/** The consumption audit trail of one unit (for the detail dialog). */
export const consumptionLog = query({
  args: { partId: v.id("parts") },
  handler: async (ctx, { partId }) => {
    await requireNonStudent(ctx);
    const part = await ctx.db.get(partId);
    return (part?.consumptionLog ?? []).slice().reverse();
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
    // Master containers hold groups, not material to lend.
    if (await hasChildGroups(ctx, groupId)) {
      throw new Error("Master containers hold groups, not material — request from the groups inside it");
    }
    // Storage-alias groups cannot be lent, not even bulk amounts.
    await assertGroupLendable(ctx, groupId);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter the amount you need");
    }
    // Feasibility check against the per-unit ledger: the take must be
    // splittable across available units without dropping any below its
    // minimum. The concrete allocation happens at hand-over (mark_taken).
    const units = (
      await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect()
    ).filter((p: any) => p.status === "available" && p.tag !== "BULK");
    const plan = planMeasureTake(
      units.map((p: any) => ({
        id: p._id,
        remaining: Number(p.amountRemaining ?? 0),
        lowAt: Number(p.lowAt ?? group.measureLowAt ?? 0),
      })),
      amount,
    );
    if (!plan.ok) throw new Error(plan.error);
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
      undefined,
      "requests",
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
    // The per-unit ledger is the source of truth for bulk groups: a manual
    // group-level stock set would desync it. Point admins to the units.
    throw new Error(
      "Bulk groups keep stock per unit — edit each unit's amount in the unit list instead",
    );
  },
});

/**
 * Bulk edit several groups at once from the inventory multi-select. Only the
 * fields the admin actually changes are applied; per-group QR identity and
 * names are untouched (name edits stay in the single-group dialog).
 */
export const bulkUpdateGroups = mutation({
  args: {
    groupIds: v.array(v.id("groups")),
    categoryId: v.optional(v.id("categories")),
    closetId: v.optional(v.id("closets")),
    // Move the whole set inside a container group; null lifts them to top level.
    parentGroupId: v.optional(v.union(v.id("groups"), v.null())),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    datasheetUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { groupIds, categoryId, closetId, parentGroupId, brand, model, datasheetUrl, imageUrl }) => {
    await requireAdmin(ctx);
    let moved = 0;
    for (const groupId of groupIds) {
      const group = await ctx.db.get(groupId);
      if (!group || group.deleted) continue;
      const patch: Record<string, unknown> = {};
      if (categoryId !== undefined && categoryId !== group.categoryId) patch.categoryId = categoryId;
      if (closetId !== undefined && closetId !== group.closetId) patch.closetId = closetId;
      if (brand !== undefined) patch.brand = brand.trim() || undefined;
      if (model !== undefined) patch.model = model.trim() || undefined;
      if (datasheetUrl !== undefined) patch.datasheetUrl = datasheetUrl.trim() || undefined;
      if (imageUrl !== undefined) patch.imageUrl = imageUrl.trim() || undefined;
      if (parentGroupId !== undefined && (parentGroupId ?? null) !== (group.parentGroupId ?? null)) {
        if (parentGroupId) {
          if (parentGroupId === groupId) continue; // skip self
          let cursor: any = await ctx.db.get(parentGroupId);
          if (!cursor || cursor.deleted || cursor.measure) continue; // skip invalid
          let depth = 0;
          let cycle = false;
          while (cursor?.parentGroupId && depth < 10) {
            if (cursor.parentGroupId === groupId) { cycle = true; break; }
            cursor = await ctx.db.get(cursor.parentGroupId);
            depth += 1;
          }
          if (!cycle) {
            await becomeMasterContainer(ctx, parentGroupId);
            patch.parentGroupId = parentGroupId;
            moved += 1;
          }
        } else {
          patch.parentGroupId = undefined;
          moved += 1;
        }
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(groupId, patch as any);
    }
    return { ok: true, moved };
  },
});

/**
 * Bulk delete several groups at once (inventory multi-select). Same safety
 * rules as single delete: containers must be emptied first; groups with
 * units out on rent/projects are skipped and reported back.
 */
export const bulkDeleteGroups = mutation({
  args: { groupIds: v.array(v.id("groups")) },
  handler: async (ctx, { groupIds }) => {
    await requireAdmin(ctx);
    let deleted = 0;
    const skipped: string[] = [];
    for (const groupId of groupIds) {
      const group = await ctx.db.get(groupId);
      if (!group || group.deleted) continue;
      if (await hasChildGroups(ctx, groupId)) {
        skipped.push(`${group.name} (holds groups)`);
        continue;
      }
      const parts = await ctx.db
        .query("parts")
        .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
        .collect();
      const blocked = parts.some(
        (p: any) => p.status === "rented" || p.status === "on_project",
      );
      if (blocked) {
        skipped.push(`${group.name} (units out on rent/project)`);
        continue;
      }
      for (const p of parts) await ctx.db.delete((p as any)._id);
      await ctx.db.delete(groupId);
      deleted += 1;
    }
    return { ok: true, deleted, skipped };
  },
});
