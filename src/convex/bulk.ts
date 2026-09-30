import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib";

/**
 * Bulk record operations + the "seen" ledger behind the Updates tab.
 *
 * - bulkDeleteRentalRecords: multi-select delete with the same RENTAL_HOLDING_UNIT
 *   guard as the single delete (rows still holding a unit are reported back).
 * - clearRentalHistory: wipe the processed tail (returned/on_project/denied/canceled)
 *   or everything, for one member or the whole club.
 * - seen keys: any admin action records a key so the Updates tab only shows
 *   what is genuinely NEW.
 */

const PROCESSED = new Set(["returned", "on_project", "denied", "canceled"]);

/** Delete several rental records at once. Same guard as the single delete. */
export const bulkDeleteRentalRecords = mutation({
  args: {
    rentalIds: v.array(v.id("rentals")),
    alsoFreePart: v.optional(v.boolean()),
  },
  handler: async (ctx, { rentalIds, alsoFreePart }) => {
    await requireAdmin(ctx);
    let deleted = 0;
    const skipped: { rentalId: string; tag?: string; partStatus?: string }[] = [];
    for (const rentalId of rentalIds) {
      const rental = await ctx.db.get(rentalId);
      if (!rental) {
        deleted++;
        continue;
      }
      const part = rental.partId ? await ctx.db.get(rental.partId) : null;
      const holdsUnit =
        part &&
        (part.status === "rented" ||
          part.status === "on_project" ||
          (part.status === "pending" && rental.status === "pending"));
      if (holdsUnit && !alsoFreePart) {
        skipped.push({ rentalId, tag: part?.tag, partStatus: part?.status });
        continue;
      }
      if (holdsUnit && alsoFreePart) {
        await ctx.db.patch(part._id, {
          status: "available",
          currentHolderId: undefined,
          currentProjectId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
      await ctx.db.delete(rentalId);
      deleted++;
    }
    return { ok: true, deleted, skipped };
  },
});

/** What would clearRentalHistory remove, so the dialog can confirm precisely. */
export const historyStats = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("rentals").collect();
    const rows = userId ? all.filter((r) => r.userId === userId) : all;
    return {
      processed: rows.filter((r) => PROCESSED.has(r.status)).length,
      live: rows.filter((r) => !PROCESSED.has(r.status)).length,
    };
  },
});

/**
 * Clear rental history. Default: every processed record (returned, on a
 * project, denied or canceled). With includeLive: true it wipes EVERYTHING —
 * the caller must pass the explicit confirm flag and, for live records,
 * choose whether their units are released back to the shelf.
 */
export const clearRentalHistory = mutation({
  args: {
    userId: v.optional(v.id("users")),
    includeLive: v.optional(v.boolean()),
    releaseUnits: v.optional(v.boolean()),
    confirm: v.literal("DELETE"),
  },
  handler: async (ctx, { userId, includeLive, releaseUnits, confirm }) => {
    await requireAdmin(ctx);
    if (confirm !== "DELETE") throw new ConvexError("Type DELETE to confirm");
    const all = await ctx.db.query("rentals").collect();
    const rows = all.filter(
      (r) => (!userId || r.userId === userId) && (includeLive || PROCESSED.has(r.status)),
    );
    let deleted = 0;
    for (const r of rows) {
      const part = r.partId ? await ctx.db.get(r.partId) : null;
      const holds =
        part &&
        (part.status === "rented" ||
          part.status === "on_project" ||
          (part.status === "pending" && r.status === "pending"));
      if (holds) {
        if (!releaseUnits) continue; // keep the record; it still holds its unit
        await ctx.db.patch(part._id, {
          status: "available",
          currentHolderId: undefined,
          currentProjectId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
      // Package units are deleted with their records — packages keep their
      // own row; a fully-erased package simply shows zero units.
      await ctx.db.delete(r._id);
      deleted++;
    }
    return { deleted };
  },
});

// ---- Seen ledger (Updates tab) ----------------------------------------------

const seenKeys = async (ctx: any, keys: string[]) => {
  const out = new Set<string>();
  for (const key of keys) {
    const row = await ctx.db
      .query("seenRequests")
      .withIndex("by_key", (q: any) => q.eq("key", key))
      .unique();
    if (row) out.add(key);
  }
  return out;
};

/** Which of the given keys are already seen (client filters Updates with it). */
export const seenForKeys = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    await requireAdmin(ctx);
    return [...(await seenKeys(ctx, keys))];
  },
});

/** All seen keys (the Updates tab requests it once per mount). */
export const allSeenKeys = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("seenRequests").collect();
    return rows.map((r) => r.key);
  },
});

/** Mark rows seen (idempotent) — done automatically when an action is applied. */
export const markRequestsSeen = mutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const me = await requireAdmin(ctx);
    for (const key of keys) {
      const row = await ctx.db
        .query("seenRequests")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row) continue;
      await ctx.db.insert("seenRequests", { key, seenAt: now, seenBy: me._id });
    }
    return { ok: true, marked: keys.length };
  },
});

/** Wipe the whole ledger (everything counts as unseen again). */
export const clearSeenRequests = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("seenRequests").collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { ok: true, cleared: rows.length };
  },
});

/** Internal: auto-seen after successful admin actions (decide/deny/delete). */
export const markSeenInternal = internalMutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const now = Date.now();
    for (const key of keys) {
      const row = await ctx.db
        .query("seenRequests")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row) continue;
      await ctx.db.insert("seenRequests", { key, seenAt: now });
    }
    return { ok: true };
  },
});

/**
 * Push to all admins — convenience wrapper used by request mutations so new
 * requests ping every admin device. Lives here to avoid a parts.ts → push.ts
 * import cycle; delegates to push.pushToAdmins.
 */
export const notifyAdminsPush = internalMutation({
  args: { title: v.string(), body: v.string(), tag: v.optional(v.string()), url: v.optional(v.string()) },
  handler: async (ctx, { title, body, tag, url }) => {
    await ctx.runMutation(internal.push.pushToAdmins, { title, body, tag, url });
    return { ok: true };
  },
});
