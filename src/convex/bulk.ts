import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib";
import { touchPatch, recordTombstone } from "./sync";

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
    const packagesTouched = new Set<string>();
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
        await touchPatch(ctx, part._id, {
          status: "available",
          currentHolderId: undefined,
          currentProjectId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
      if (rental.packageId) packagesTouched.add(String(rental.packageId));
      await ctx.db.delete(rentalId);
      await recordTombstone(ctx, "rentals", rentalId);
      deleted++;
    }
    // Package bundles whose last unit record just vanished are ghosts (the
    // package row stays but renders zero units) — sweep them too.
    let packagesDeleted = 0;
    for (const packageId of packagesTouched) {
      const pkg = await ctx.db.get(packageId as any);
      if (!pkg) continue;
      const left = (
        await ctx.db
          .query("rentals")
          .withIndex("by_user", (q) => q.eq("userId", (pkg as any).userId))
          .collect()
      ).filter((r) => r.packageId === packageId);
      if (left.length > 0) continue;
      await ctx.db.delete(packageId as any);
      await recordTombstone(ctx, "rentalPackages", packageId);
      packagesDeleted++;
    }
    return { ok: true, deleted, skipped, packagesDeleted };
  },
});

/**
 * Delete a whole PACKAGE record with an explicit choice of what happens to
 * its units — the bundle-level twin of the per-record delete choice:
 *
 * - releaseUnits: false (default) → "record only": unit records that are
 *   merely history (returned / on project / transferred) are deleted, but
 *   records still HOLDING a unit are kept and reported, and every part
 *   status stays exactly as it is.
 * - releaseUnits: true → "delete + put everything back": the records and the
 *   package row are deleted AND every held unit is released back to the
 *   shelf (available again, holder/project cleared).
 */
export const deletePackageRecord = mutation({
  args: {
    packageId: v.id("rentalPackages"),
    releaseUnits: v.optional(v.boolean()),
  },
  handler: async (ctx, { packageId, releaseUnits }) => {
    await requireAdmin(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) return { ok: true, deleted: 0, skipped: [] };
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const unitRecords = mine.filter((r) => r.packageId === packageId);
    let deleted = 0;
    const skipped: { rentalId: string; tag?: string; partStatus?: string }[] = [];
    for (const r of unitRecords) {
      const part = r.partId ? await ctx.db.get(r.partId) : null;
      const holdsUnit =
        part &&
        (part.status === "rented" ||
          part.status === "on_project" ||
          (part.status === "pending" && r.status === "pending"));
      if (holdsUnit && !releaseUnits) {
        skipped.push({ rentalId: r._id, tag: part?.tag, partStatus: part?.status });
        continue;
      }
      if (holdsUnit && releaseUnits) {
        await touchPatch(ctx, part._id, {
          status: "available",
          currentHolderId: undefined,
          currentProjectId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
      await ctx.db.delete(r._id);
      await recordTombstone(ctx, "rentals", r._id);
      deleted++;
    }
    // The bundle row itself only survives when records were skipped — those
    // units still belong to the package. Otherwise it would linger as an
    // empty husk the Packages tab can never open meaningfully.
    if (skipped.length === 0) {
      await ctx.db.delete(packageId);
      await recordTombstone(ctx, "rentalPackages", String(packageId));
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
 * for live records the caller chooses whether their units are released back
 * to the shelf. With delNotifications: true rental records are NOT touched —
 * the call only clears the admin notification feed, so each category can be
 * deleted separately. The confirm flag is always required.
 */
export const clearRentalHistory = mutation({
  args: {
    userId: v.optional(v.id("users")),
    includeLive: v.optional(v.boolean()),
    releaseUnits: v.optional(v.boolean()),
    delNotifications: v.optional(v.boolean()),
    confirm: v.literal("DELETE"),
  },
  handler: async (ctx, { userId, includeLive, releaseUnits, delNotifications, confirm }) => {
    await requireAdmin(ctx);
    if (confirm !== "DELETE") throw new ConvexError("Type DELETE to confirm");

    // Notifications-only: wipe the admin feed without touching any records.
    if (delNotifications) {
      const notifs = await ctx.db.query("notifications").collect();
      for (const n of notifs) {
        await ctx.db.delete(n._id);
        await recordTombstone(ctx, "adminNotifications", n._id);
      }
      return { deleted: 0, packagesDeleted: 0, notifsDeleted: notifs.length };
    }

    const all = await ctx.db.query("rentals").collect();
    const rows = all.filter(
      (r) => (!userId || r.userId === userId) && (includeLive || PROCESSED.has(r.status)),
    );
    let deleted = 0;
    const packagesTouched = new Set<string>();
    for (const r of rows) {
      const part = r.partId ? await ctx.db.get(r.partId) : null;
      const holds =
        part &&
        (part.status === "rented" ||
          part.status === "on_project" ||
          (part.status === "pending" && r.status === "pending"));
      if (holds) {
        if (!releaseUnits) continue; // keep the record; it still holds its unit
        await touchPatch(ctx, part._id, {
          status: "available",
          currentHolderId: undefined,
          currentProjectId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
      if (r.packageId) packagesTouched.add(String(r.packageId));
      await ctx.db.delete(r._id);
      await recordTombstone(ctx, "rentals", r._id);
      deleted++;
    }
    // A package whose every unit record was cleared is an empty ghost row —
    // clear it as well so the Packages tab doesn't keep un-deletable husks.
    let packagesDeleted = 0;
    for (const packageId of packagesTouched) {
      const pkg = await ctx.db.get(packageId as any);
      if (!pkg) continue;
      const left = (
        await ctx.db
          .query("rentals")
          .withIndex("by_user", (q) => q.eq("userId", (pkg as any).userId))
          .collect()
      ).filter((x) => x.packageId === packageId);
      if (left.length > 0) continue;
      await ctx.db.delete(packageId as any);
      await recordTombstone(ctx, "rentalPackages", packageId);
      packagesDeleted++;
    }
    return { deleted, packagesDeleted, notifsDeleted: 0 };
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
