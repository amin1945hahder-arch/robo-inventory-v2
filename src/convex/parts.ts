import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireAdmin, requireNonGuest, requireUser, safeImage } from "./lib";
import { adminPhones, sendWhatsApp } from "./whatsapp";
import { telegramDM, telegramGroup, notifyTelegram } from "./notify";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Per-execution memo for joined docs.
 *
 * Profile pictures are stored as base64 data URLs on user docs (can be
 * hundreds of KB each). Queries that join a user doc once per rental row can
 * then re-read the same heavy doc dozens of times in one execution and blow
 * Convex's 16 MB read limit ("Too many bytes read in a single function
 * execution") — which crashed the admin Requests console and the unit detail
 * page. Caching each doc read once per execution fixes it and is much faster.
 */
export function docCache() {
  const cache = new Map<string, Promise<any>>();
  return {
    async get(ctx: any, id: string | undefined): Promise<any> {
      if (!id) return null;
      const existing = cache.get(id);
      if (existing) return existing;
      const promise: Promise<any> = ctx.db.get(id);
      cache.set(id, promise);
      return promise;
    },
  };
}

// Server-side read of the return-request cooldown (hours). Duplicated from
// settings.ts as an inline helper because queries can't be awaited from a
// mutation handler without scheduling; this reads the settings table directly.
async function returnCooldownHours(ctx: any): Promise<number> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q: any) => q.eq("key", "return_request_cooldown_hours"))
    .unique();
  return row?.value ? Number(JSON.parse(row.value)) : 24;
}

export const listPartsOfGroup = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await requireUser(ctx);
    const parts = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    return parts.sort((a, b) => a.tag.localeCompare(b.tag));
  },
});

// Units grouped by group id: { available: number, broken: number, pending: number,
// rented: number, onProject: number }. Used by the package builder to know how
// many units of each item can go into one request.
export const availabilityByGroup = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const byGroup: Record<string, { available: number; broken: number; pending: number; rented: number; onProject: number }> = {};
    for (const p of parts) {
      const row = (byGroup[p.groupId] ??= { available: 0, broken: 0, pending: 0, rented: 0, onProject: 0 });
      if (p.status === "available") row.available += 1;
      else if (p.status === "broken") row.broken += 1;
      else if (p.status === "pending") row.pending += 1;
      else if (p.status === "rented") row.rented += 1;
      else if (p.status === "on_project") row.onProject += 1;
    }
    return byGroup;
  },
});

export const getPart = query({
  args: { id: v.id("parts") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db.get(id);
  },
});

// Full detail payload for the part detail page: part + group + category + closet +
// the rental the viewer cares about (their own pending/active, or latest for admins)
// + recent history.
export const getPartWithRental = query({
  args: { id: v.id("parts") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const part = await ctx.db.get(id);
    if (!part) return null;
    const group = await ctx.db.get(part.groupId);
    const category = group ? await ctx.db.get(group.categoryId) : null;
    const closet = group ? await ctx.db.get(group.closetId) : null;

    const rentals = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", id))
      .collect();
    const sorted = rentals.sort((a, b) => b.requestedAt - a.requestedAt);

    const mine = sorted.find(
      (r) => r.userId === user._id && (r.status === "pending" || r.status === "active"),
    );
    const shown =
      mine ??
      (user.role === "admin"
        ? sorted.find((r) => r.status === "pending" || r.status === "active")
        : undefined);

    let shownRental = null;
    if (shown) {
      const holder = await ctx.db.get(shown.userId);
      const project = shown.projectId ? await ctx.db.get(shown.projectId) : null;
      shownRental = {
        _id: shown._id,
        status: shown.status,
        requestedAt: shown.requestedAt,
        note: shown.conditionReport,
        mine: shown.userId === user._id,
        holderName: holder?.name ?? holder?.email ?? "A member",
        holderId: holder?._id,
        holderImage: safeImage(holder?.image),
        studentId: holder?.studentId,
        projectName: project?.name,
        decidedAt: shown.decidedAt,
        pickedUpAt: shown.pickedUpAt,
        returnedAt: shown.returnedAt,
        rentBroken: Boolean(shown.rentBroken),
        returnRequestedAt: shown.returnRequestedAt,
      };
    }

    const cache = docCache();
    const history = [];
    for (const r of sorted.slice(0, 12)) {
      const holder = await cache.get(ctx, r.userId);
      const project = r.projectId ? await cache.get(ctx, r.projectId) : null;
      history.push({
        _id: r._id,
        status: r.status,
        requestedAt: r.requestedAt,
        returnedAt: r.returnedAt,
        returnDestination: r.returnDestination,
        functional: r.functional,
        conditionReport: r.conditionReport,
        holderName: holder?.name ?? holder?.email ?? "—",
        holderId: holder?._id,
        holderImage: safeImage(holder?.image),
        studentId: holder?.studentId,
        decidedAt: r.decidedAt,
        pickedUpAt: r.pickedUpAt,
        rentBroken: Boolean(r.rentBroken),
        projectName: project?.name,
      });
    }

    return {
      part,
      group,
      category,
      closet,
      shownRental,
      history,
      isAdmin: user.role === "admin",
      isMine: Boolean(mine),
    };
  },
});

export const getPartByTag = query({
  args: { tag: v.string() },
  handler: async (ctx, { tag }) => {
    await requireUser(ctx);
    const part = await ctx.db
      .query("parts")
      .withIndex("by_tag", (q) => q.eq("tag", tag.trim().toUpperCase()))
      .first();
    return part;
  },
});

export const updatePart = mutation({
  args: {
    id: v.id("parts"),
    tag: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("available"),
        v.literal("pending"),
        v.literal("rented"),
        v.literal("on_project"),
        v.literal("broken"),
      ),
    ),
    note: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { id, tag, status, note, imageUrl }) => {
    await requireAdmin(ctx);
    const patch: Record<string, unknown> = {};
    if (tag !== undefined) patch.tag = tag.trim().toUpperCase();
    if (status !== undefined) patch.status = status;
    if (note !== undefined) patch.note = note.trim();
    if (imageUrl !== undefined) patch.imageUrl = imageUrl.trim() || undefined;
    await ctx.db.patch(id, patch);
  },
});

export const deletePart = mutation({
  args: { id: v.id("parts") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const part = await ctx.db.get(id);
    if (!part) return;
    if (part.status === "rented" || part.status === "on_project") {
      throw new Error("Part is out on rent or a project. Process a return first.");
    }
    await ctx.db.delete(id);
    const group = await ctx.db.get(part.groupId);
    if (group) {
      const remaining = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", part.groupId))
        .collect();
      await ctx.db.patch(group._id, { quantityTotal: remaining.length });
    }
  },
});

async function notifyAdmin(ctx: any, text: string, link?: string) {
  await ctx.db.insert("notifications", { forRole: "admin", type: "info", text, link });
}

/**
 * Push the printable rent card (PNG) for a rental to the Telegram club group.
 * Used whenever a return is requested or processed so the admins get the
 * receipt as an image right next to the usual text message. Fire-and-forget:
 * a render/send failure never blocks the mutation.
 */
async function scheduleRentCard(
  ctx: any,
  rental: any,
  part: any | null,
  group: any | null,
  student: any | null,
  statusLabel: string,
  caption: string,
  projectName?: string,
) {
  await ctx.scheduler.runAfter(0, internal.rentCardTelegram.sendRentCardToGroup, {
    card: {
      rentalId: rental._id,
      groupName: group?.name ?? "Part",
      tag: part?.tag ?? "?",
      holderName: student?.name ?? student?.email ?? "Member",
      studentId: student?.studentId,
      statusLabel,
      requestedAt: rental.requestedAt,
      decidedAt: rental.decidedAt,
      pickedUpAt: rental.pickedUpAt,
      returnedAt: rental.returnedAt,
      conditionReport: rental.conditionReport,
      projectName,
    },
    caption,
  });
}

async function notifyAdminsByEmail(
  ctx: any,
  student: string,
  partName: string,
  partTag: string,
  rentalId: string,
  note?: string,
) {
  await ctx.scheduler.runAfter(0, api.emails.sendRentalRequestEmail, {
    student,
    partName,
    partTag,
    rentalId,
    note,
  });
}

export const requestRental = mutation({
  args: {
    partId: v.id("parts"),
    groupId: v.id("groups"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { partId, groupId, note }) => {
    const user = await requireNonGuest(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("Part not found");
    if (part.status !== "available") {
      throw new Error("This unit is not available right now");
    }
    const existing = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) throw new Error("There is already a pending request for this unit");
    const group = await ctx.db.get(groupId);

    const rentalId = await ctx.db.insert("rentals", {
      partId,
      userId: user._id,
      status: "pending",
      requestedAt: Date.now(),
    });
    await ctx.db.patch(partId, { status: "pending" });
    const studentLabel = user.name ?? user.email ?? "A member";
    await notifyAdmin(
      ctx,
      `${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag})`,
      `/admin/requests`,
    );
    await notifyAdminsByEmail(
      ctx,
      studentLabel,
      group?.name ?? "a part",
      part.tag,
      rentalId,
      note,
    );
    // WhatsApp to every admin (no-op until TWILIO_* keys are set)
    for (const phone of await adminPhones(ctx)) {
      await sendWhatsApp(
        phone,
        `${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag}) — review it in the Requests console.`,
      );
    }
    // Telegram: post to the club group, tagging the admins who must act
    // (no-op until a bot token is configured in Settings or env).
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `📥 ${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag})${note ? `\n📝 ${note}` : ""}\n→ approve in the Requests console`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
    );
    return rentalId;
  },
});

// Member requests a quantity of one group (multi-unit rental in one shot).
// Picks concrete free units; rejects if not enough are available.
export const requestRentalQuantity = mutation({
  args: {
    groupId: v.id("groups"),
    count: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, count, note }) => {
    const user = await requireNonGuest(ctx);
    const wanted = Math.max(1, Math.min(50, Math.ceil(count)));
    const group = await ctx.db.get(groupId);
    if (!group || group.deleted) throw new Error("Group not found");
    const candidates = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const free = candidates.filter((p) => p.status === "available");
    if (free.length < wanted) {
      throw new Error(`Only ${free.length} unit(s) available (you asked for ${wanted})`);
    }
    const pool = free.slice(0, wanted);
    const label = user.name ?? user.email ?? "A member";
    for (const part of pool) {
      const existing = await ctx.db
        .query("rentals")
        .withIndex("by_part", (q) => q.eq("partId", part._id))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (existing) throw new Error(`Unit ${part.tag} already has a pending request`);
      await ctx.db.insert("rentals", {
        partId: part._id,
        userId: user._id,
        status: "pending",
        requestedAt: Date.now(),
      });
      await ctx.db.patch(part._id, { status: "pending" });
    }
    await notifyAdmin(
      ctx,
      `${label} requested ${wanted}× ${group.name}`,
      `/admin/requests`,
    );
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `📥 ${label} requested ${wanted}× ${group.name}${note ? `\n📝 ${note}` : ""}\n→ approve in the Requests console`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
    );
    return { created: pool.length };
  },
});

// Member knowingly rents a unit flagged broken — only offered from the unit's
// own detail page (never from group/package flows).
export const rentBrokenPart = mutation({
  args: {
    partId: v.id("parts"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { partId, note }) => {
    const user = await requireNonGuest(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("Part not found");
    if (part.status !== "broken") {
      throw new Error("This unit is not flagged broken — use the normal request");
    }
    const existing = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) throw new Error("There is already a pending request for this unit");
    const group = await ctx.db.get(part.groupId);
    const label = user.name ?? user.email ?? "A member";
    await ctx.db.insert("rentals", {
      partId,
      userId: user._id,
      status: "pending",
      requestedAt: Date.now(),
      rentBroken: true,
    });
    await ctx.db.patch(partId, { status: "pending" });
    await notifyAdmin(
      ctx,
      `${label} requested the BROKEN unit ${group?.name ?? "part"} (${part.tag})`,
      `/admin/requests`,
    );
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `⚠️ ${label} requested the BROKEN unit ${group?.name ?? "part"} (${part.tag})${note ? `\n📝 ${note}` : ""} — for repair/refurb. Approve carefully.`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
    );
    return { ok: true };
  },
});

// Member deletes their own pending rental request (before approval).
export const deleteMyRentalRequest = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireNonGuest(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    if (rental.userId !== user._id) throw new Error("Not your request");
    if (rental.status !== "pending") {
      throw new Error("Only pending requests can be deleted — after approval use a return instead");
    }
    const part = await ctx.db.get(rental.partId);
    await ctx.db.delete(rentalId);
    if (part && part.status === "pending") {
      await ctx.db.patch(part._id, { status: "available" });
    }
    const group = part ? await ctx.db.get(part.groupId) : null;
    await telegramGroup(ctx, `🗑 ${user.name ?? user.email ?? "A member"} deleted their rental request for ${group?.name ?? "a part"}${part ? ` (${part.tag})` : ""}.`);
  },
});

// Member asks to return a rented part. One request per rental per cooldown
// period (admin-set, default 24h); the admin sees it in the Requests console.
export const requestReturn = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireNonGuest(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    if (rental.userId !== user._id) throw new Error("Not your rental");
    if (rental.status !== "active") {
      throw new Error("Only active rentals can be returned");
    }
    const cooldownHours = await returnCooldownHours(ctx);
    if (rental.returnRequestedAt) {
      const elapsedH = (Date.now() - rental.returnRequestedAt) / 36e5;
      if (elapsedH < cooldownHours) {
        const remaining = Math.ceil(cooldownHours - elapsedH);
        throw new Error(
          `You already requested a return for this rental — you can ask again in ${remaining}h`,
        );
      }
    }
    await ctx.db.patch(rentalId, { returnRequestedAt: Date.now() });
    const part = await ctx.db.get(rental.partId);
    const group = part ? await ctx.db.get(part.groupId) : null;
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `↩️ ${user.name ?? user.email ?? "A member"} wants to return ${group?.name ?? "a part"} (${part?.tag ?? "?"}) — process it in the Requests console.`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
    );
    // Attach the printable rent card image for this rental to the group.
    await scheduleRentCard(
      ctx,
      rental,
      part,
      group,
      user,
      "active · return requested",
      `↩️ Rent card — ${group?.name ?? "part"} (${part?.tag ?? "?"}) return requested by ${user.name ?? user.email ?? "a member"}.`,
    );
  },
});

export const decideRental = mutation({
  args: {
    rentalId: v.id("rentals"),
    approve: v.boolean(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { rentalId, approve, token }) => {
    // allow via email action link (no session) when a valid token is supplied
    if (!token || token !== process.env.ADMIN_ACTION_TOKEN) {
      await requireAdmin(ctx);
    }
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    if (rental.status !== "pending") throw new Error("This request was already handled");
    const part = await ctx.db.get(rental.partId);
    if (!part) throw new Error("Part no longer exists");
    const group = part ? await ctx.db.get(part.groupId) : null;
    const student = await ctx.db.get(rental.userId);

    if (approve) {
      await ctx.db.patch(rentalId, { status: "active", decidedAt: Date.now(), pickedUpAt: Date.now() });
      await ctx.db.patch(part._id, { status: "rented", currentHolderId: rental.userId });
    } else {
      await ctx.db.patch(rentalId, { status: "denied", decidedAt: Date.now() });
      await ctx.db.patch(part._id, { status: "available" });
    }
    if (student?.email) {
      await ctx.scheduler.runAfter(0, api.emails.sendRentalDecisionEmail, {
        to: student.email,
        student: student.name ?? student.email,
        partName: group?.name ?? "a part",
        approved: approve,
      });
    }
    if (student?.phone) {
      await sendWhatsApp(
        student.phone,
        approve
          ? `✅ Your request was approved — ${group?.name ?? "a part"} (${part.tag}). You can pick it up from the lab.`
          : `❌ Your request for ${group?.name ?? "a part"} (${part.tag}) was denied.`,
      );
    }
    if (student?.telegramChatId || student?.telegramUsername) {
      // DM the member directly; the message already names the deciding admin.
      // We can't know the actor here (email link path), so it attributes to
      // "Club admin" unless the dashboard path (adminRentalAction) is used.
      await telegramDM(
        ctx,
        { name: student.name ?? student.email, telegramUsername: student.telegramUsername, telegramChatId: student.telegramChatId },
        approve
          ? `✅ Approved: ${group?.name ?? "a part"} (${part.tag}). You can pick it up from the lab.`
          : `❌ Denied: your request for ${group?.name ?? "a part"} (${part.tag}) was not approved.`,
      );
    }
    if (token && token === process.env.ADMIN_ACTION_TOKEN) return { ok: true };
    return { ok: true, group: group?.name, student: student?.name ?? student?.email };
  },
});

export const adminRentalAction = mutation({
  args: {
    rentalId: v.id("rentals"),
    action: v.union(
      v.literal("approve"),
      v.literal("deny"),
      v.literal("mark_returned"),
      v.literal("assign_project"),
      v.literal("mark_broken"),
    ),
    projectId: v.optional(v.id("projects")),
    functional: v.optional(v.boolean()),
    conditionReport: v.optional(v.string()),
  },
  handler: async (ctx, { rentalId, action, projectId, functional, conditionReport }) => {
    const admin = await requireAdmin(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    const part = await ctx.db.get(rental.partId);
    if (!part) throw new Error("Part no longer exists");
    const group = await ctx.db.get(part.groupId);
    const student = await ctx.db.get(rental.userId);
    const now = Date.now();

    if (action === "approve") {
      if (rental.status !== "pending") throw new Error("This request was already handled");
      await ctx.db.patch(rentalId, { status: "active", decidedAt: now, pickedUpAt: now });
      await ctx.db.patch(part._id, { status: "rented", currentHolderId: rental.userId });
      if (student?.email) {
        await ctx.scheduler.runAfter(0, api.emails.sendRentalDecisionEmail, {
          to: student.email,
          student: student.name ?? student.email,
          partName: group?.name ?? "a part",
          approved: true,
        });
      }
      if (student?.phone) {
        await sendWhatsApp(
          student.phone,
          `✅ Your request was approved — ${group?.name ?? "a part"} (${part.tag}). You can pick it up from the lab.`,
        );
      }
      if (student?.telegramChatId || student?.telegramUsername) {
        await telegramDM(
          ctx,
          { name: student.name ?? student.email, telegramUsername: student.telegramUsername, telegramChatId: student.telegramChatId },
          `✅ Approved: ${group?.name ?? "a part"} (${part.tag}). You can pick it up from the lab.`,
          { name: admin.name ?? admin.email },
        );
      }
      await telegramGroup(
        ctx,
        `✅ ${admin.name ?? admin.email} approved ${student?.name ?? student?.email ?? "a member"}'s rental of ${group?.name ?? "a part"} (${part.tag}).`,
      );
    } else if (action === "deny") {
      if (rental.status !== "pending") throw new Error("This request was already handled");
      await ctx.db.patch(rentalId, { status: "denied", decidedAt: now });
      if (part.status === "pending") await ctx.db.patch(part._id, { status: "available" });
      if (student?.email) {
        await ctx.scheduler.runAfter(0, api.emails.sendRentalDecisionEmail, {
          to: student.email,
          student: student.name ?? student.email,
          partName: group?.name ?? "a part",
          approved: false,
        });
      }
      if (student?.phone) {
        await sendWhatsApp(
          student.phone,
          `❌ Your request for ${group?.name ?? "a part"} (${part.tag}) was denied.`,
        );
      }
      if (student?.telegramChatId || student?.telegramUsername) {
        await telegramDM(
          ctx,
          { name: student.name ?? student.email, telegramUsername: student.telegramUsername, telegramChatId: student.telegramChatId },
          `❌ Denied: your request for ${group?.name ?? "a part"} (${part.tag}) was not approved.`,
          { name: admin.name ?? admin.email },
        );
      }
      await telegramGroup(
        ctx,
        `❌ ${admin.name ?? admin.email} denied ${student?.name ?? student?.email ?? "a member"}'s rental request for ${group?.name ?? "a part"} (${part.tag}).`,
      );
    } else if (action === "mark_returned") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      await ctx.db.patch(rentalId, {
        status: "returned",
        returnedAt: now,
        returnDestination: "shelf",
        functional,
        conditionReport: conditionReport?.trim(),
        returnRequestedAt: undefined,
      });
      if (functional === false) {
        await ctx.db.patch(part._id, { status: "broken", currentHolderId: undefined });
      } else {
        await ctx.db.patch(part._id, { status: "available", currentHolderId: undefined });
      }
      await telegramGroup(
        ctx,
        `↩️ ${admin.name ?? admin.email} processed the return of ${group?.name ?? "a part"} (${part.tag})${functional === false ? " — marked BROKEN" : " — back on the shelf"}.`,
      );
      await scheduleRentCard(
        ctx,
        { ...rental, returnedAt: now, conditionReport: conditionReport?.trim() },
        part,
        group,
        student,
        functional === false ? "returned · marked broken" : "returned to shelf",
        `↩️ Rent card — ${group?.name ?? "part"} (${part.tag}) returned to shelf by ${student?.name ?? student?.email ?? "a member"}.`,
      );
    } else if (action === "assign_project") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      if (!projectId) throw new Error("Select a project");
      const project = await ctx.db.get(projectId);
      if (!project || project.status !== "active") throw new Error("Project must be active");
      await ctx.db.patch(rentalId, {
        status: "on_project",
        returnedAt: now,
        returnDestination: "project",
        projectId,
        functional,
        conditionReport: conditionReport?.trim(),
        returnRequestedAt: undefined,
      });
      await ctx.db.patch(part._id, { status: "on_project", currentProjectId: projectId, currentHolderId: undefined });
      await telegramGroup(
        ctx,
        `🤖 ${admin.name ?? admin.email} assigned ${group?.name ?? "a part"} (${part.tag}) to project “${project.name}” until it is dismantled.`,
      );
      await scheduleRentCard(
        ctx,
        { ...rental, returnedAt: now, projectId, conditionReport: conditionReport?.trim() },
        part,
        group,
        student,
        "assigned to project",
        `🤖 Rent card — ${group?.name ?? "part"} (${part.tag}) assigned to “${project.name}”.`,
        project.name,
      );
    } else if (action === "mark_broken") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      await ctx.db.patch(rentalId, { status: "returned", returnedAt: now, returnDestination: "shelf", functional: false, conditionReport: conditionReport?.trim(), returnRequestedAt: undefined });
      await ctx.db.patch(part._id, { status: "broken", currentHolderId: undefined });
      await scheduleRentCard(
        ctx,
        { ...rental, returnedAt: now, conditionReport: conditionReport?.trim() },
        part,
        group,
        student,
        "returned · marked broken",
        `⚠️ Rent card — ${group?.name ?? "part"} (${part.tag}) returned and marked BROKEN.`,
      );
    }
    return { ok: true };
  },
});

export const setPartStatusDirect = mutation({
  args: {
    partId: v.id("parts"),
    functional: v.boolean(),
    conditionReport: v.optional(v.string()),
  },
  handler: async (ctx, { partId, functional, conditionReport }) => {
    await requireAdmin(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("Part not found");
    if (part.status !== "rented") {
      throw new Error("Only rented parts can be returned here");
    }
    await ctx.db.patch(part._id, {
      status: functional ? "available" : "broken",
      currentHolderId: undefined,
    });
    const open = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    for (const r of open) {
      await ctx.db.patch(r._id, {
        status: "returned",
        returnedAt: Date.now(),
        returnDestination: "shelf",
        functional,
        conditionReport: conditionReport?.trim(),
      });
    }
    return { ok: true };
  },
});

export const assignPartToProject = mutation({
  args: {
    partId: v.id("parts"),
    projectId: v.id("projects"),
    functional: v.boolean(),
    conditionReport: v.optional(v.string()),
  },
  handler: async (ctx, { partId, projectId, functional, conditionReport }) => {
    await requireAdmin(ctx);
    const part = await ctx.db.get(partId);
    if (!part) throw new Error("Part not found");
    if (part.status !== "rented") {
      throw new Error("Only rented parts can be assigned to a project");
    }
    const project = await ctx.db.get(projectId);
    if (!project || project.status !== "active") throw new Error("Project must be active");
    await ctx.db.patch(part._id, {
      status: "on_project",
      currentHolderId: undefined,
      currentProjectId: projectId,
    });
    const open = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    for (const r of open) {
      await ctx.db.patch(r._id, {
        status: "on_project",
        returnedAt: Date.now(),
        returnDestination: "project",
        projectId,
        functional,
        conditionReport: conditionReport?.trim(),
      });
    }
    return { ok: true };
  },
});

// ===== Rentals listing =====

export const listMyRentals = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const cache = docCache();
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      const project = r.projectId ? await cache.get(ctx, r.projectId) : null;
      out.push({
        rental: r,
        part,
        group,
        projectName: project?.name,
      });
    }
    return out;
  },
});

// Request counts the dashboard needs (used for the notification dot on My Rentals)
export const myRequestCounts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return {
      pending: rows.filter((r) => r.status === "pending").length,
      active: rows.filter((r) => r.status === "active").length,
      onProject: rows.filter((r) => r.status === "on_project").length,
      total: rows.length,
    };
  },
});

export const listAllRentals = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    let rows;
    if (status) {
      rows = await ctx.db
        .query("rentals")
        .withIndex("by_status", (q) => q.eq("status", status as any))
        .collect();
    } else {
      rows = await ctx.db.query("rentals").collect();
    }
    // Cached joins: a user with a big base64 avatar appears on many rental
    // rows — without the cache their doc is re-read per row and can exceed
    // the per-execution read limit (this exact bug crashed the Requests
    // console and unit detail pages).
    const cache = docCache();
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      const student = await cache.get(ctx, r.userId);
      out.push({
        rental: r,
        part,
        group,
        student: student
          ? {
              _id: student._id,
              name: student.name,
              email: student.email,
              studentId: student.studentId,
              image: safeImage(student.image),
            }
          : null,
      });
    }
    return out;
  },
});

export const cancelMyRequest = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireNonGuest(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    if (rental.userId !== user._id) throw new Error("Not your request");
    if (rental.status !== "pending") throw new Error("Only pending requests can be canceled");
    await ctx.db.patch(rentalId, { status: "canceled", decidedAt: Date.now() });
    const part = await ctx.db.get(rental.partId);
    if (part && part.status === "pending") {
      await ctx.db.patch(part._id, { status: "available" });
    }
  },
});

// Admin sends a one-off Telegram group post about an action (used by the admin
// package console to mirror what the member already gets).
export const adminDmMember = mutation({
  args: { userId: v.id("users"), text: v.string() },
  handler: async (ctx, { userId, text }) => {
    const admin = await requireAdmin(ctx);
    const clean = text.trim();
    if (!clean) throw new Error("Message is empty");
    await ctx.scheduler.runAfter(0, internal.telegram.dmMember, {
      userId,
      text: clean.slice(0, 3000),
      fromName: admin.name ?? admin.email ?? "Club admin",
    });
    return { ok: true };
  },
});

// ===== Package rentals (multi-unit bundles in one request) =====
//
// A package = one request row in `rentalPackages` + one `rentals` row per
// concrete unit. Approvals are all-or-nothing; returns are handled per-unit by
// admins (mark_returned / assign_project on each `rentals` row), with the
// package's returnRequestedAt flagging the whole bundle.

const MAX_PACKAGE_LINES = 20;
const MAX_UNITS_PER_LINE = 20;

/** Members with a pending profile or without an approved profile are still
 *  allowed to browse; requesting a package follows the same rules as single
 *  rentals (requireNonGuest). */
export const listPackages = query({
  args: { scope: v.optional(v.union(v.literal("mine"), v.literal("all"))) },
  handler: async (ctx, { scope }) => {
    let userId: any;
    if (scope === "all") {
      await requireAdmin(ctx);
    } else {
      const u = await requireNonGuest(ctx);
      userId = u._id;
    }
    const rows =
      scope === "all"
        ? await ctx.db.query("rentalPackages").collect()
        : await ctx.db
            .query("rentalPackages")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect();
    const cache = docCache();
    const out = [];
    for (const pkg of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const rentals = await ctx.db
        .query("rentals")
        .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
        .collect();
      const pkgRentals = rentals.filter((r) => r.packageId === pkg._id);
      const requester = await cache.get(ctx, pkg.userId);
      const lines = [];
      for (const line of pkg.lines) {
        const group = await cache.get(ctx, line.groupId);
        const units = [];
        for (const r of pkgRentals) {
          const part = r.partId ? await cache.get(ctx, r.partId) : null;
          if (part && part.groupId === line.groupId) {
            units.push({
              rentalId: r._id,
              partId: part._id,
              tag: part.tag,
              status: r.status,
              rentBroken: Boolean(r.rentBroken),
              returnRequestedAt: r.returnRequestedAt,
            });
          }
        }
        lines.push({
          groupId: line.groupId,
          groupName: group?.name ?? "(deleted group)",
          requested: line.count,
          note: line.note,
          units,
        });
      }
      out.push({
        package: pkg,
        requester: requester
          ? {
              _id: requester._id,
              name: requester.name,
              email: requester.email,
              studentId: requester.studentId,
              image: safeImage(requester.image),
            }
          : null,
        lines,
        // Package is "open" while any unit still needs admin handling.
        openUnits: pkgRentals.filter((r) => r.status === "active" || r.status === "pending").length,
        returnedUnits: pkgRentals.filter((r) => r.status === "returned" || r.status === "on_project").length,
        totalUnits: pkgRentals.length,
      });
    }
    return out;
  },
});

export const getPackage = query({
  args: { id: v.id("rentalPackages") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const pkg = await ctx.db.get(id);
    if (!pkg) return null;
    if (pkg.userId !== user._id && user.role !== "admin") {
      throw new Error("Not your package");
    }
    const requester = await ctx.db.get(pkg.userId);
    const rentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const pkgRentals = rentals.filter((r) => r.packageId === id);
    const lines = [];
    for (const line of pkg.lines) {
      const group = await ctx.db.get(line.groupId);
      const units = [];
      for (const r of pkgRentals) {
        const part = r.partId ? await ctx.db.get(r.partId) : null;
        if (part && part.groupId === line.groupId) {
          units.push({
            rentalId: r._id,
            partId: part._id,
            tag: part.tag,
            status: r.status,
            rentBroken: Boolean(r.rentBroken),
            returnRequestedAt: r.returnRequestedAt,
          });
        }
      }
      lines.push({ groupId: line.groupId, groupName: group?.name ?? "(deleted group)", requested: line.count, note: line.note, units });
    }
    return {
      package: pkg,
      requester: requester ? { _id: requester._id, name: requester.name, email: requester.email } : null,
      lines,
    };
  },
});

/** Create a package request: N units of each line's group are claimed
 *  (status -> pending, like single requests). Editable/cancellable while
 *  pending. */
export const createPackage = mutation({
  args: {
    lines: v.array(
      v.object({
        groupId: v.id("groups"),
        count: v.number(),
        note: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { lines, note }) => {
    const user = await requireNonGuest(ctx);
    if (!lines.length) throw new Error("Add at least one item");
    if (lines.length > MAX_PACKAGE_LINES) throw new Error(`Packages are limited to ${MAX_PACKAGE_LINES} items`);

    // Resolve units up front: enough available units per group, skipping
    // broken ones unless the member explicitly opts in (rent-broken feature).
    const chosen: { partId: Id<"parts">; groupId: Id<"groups"> }[] = [];
    for (const line of lines) {
      if (line.count < 1) throw new Error("Each line needs at least 1 unit");
      if (line.count > MAX_UNITS_PER_LINE) throw new Error(`Max ${MAX_UNITS_PER_LINE} units per item`);
      const group = await ctx.db.get(line.groupId);
      if (!group || group.deleted) throw new Error(`"${group?.name ?? "item"}" no longer exists`);
      const candidates = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect();
      const wanted = Math.ceil(line.count);
      const free = candidates.filter((p) => p.status === "available");
      const broken = candidates.filter((p) => p.status === "broken");
      if (free.length < wanted) {
        throw new Error(
          `Not enough free units of ${group.name}: need ${wanted}, only ${free.length} available` +
            (broken.length ? ` (${broken.length} broken — ask an admin or rent them from the unit's own page)` : ""),
        );
      }
      const pool = free.slice(0, wanted);
      for (const part of pool) chosen.push({ partId: part._id, groupId: line.groupId });
    }

    const packageId = await ctx.db.insert("rentalPackages", {
      userId: user._id,
      note: note?.trim() || undefined,
      status: "pending",
      lines: lines.map((l) => ({
        groupId: l.groupId,
        count: Math.ceil(l.count),
        note: l.note?.trim() || undefined,
      })),
      requestedAt: Date.now(),
    });

    for (const { partId } of chosen) {
      const part = await ctx.db.get(partId);
      if (!part) continue;
      await ctx.db.insert("rentals", {
        partId,
        userId: user._id,
        packageId,
        status: "pending",
        requestedAt: Date.now(),
        rentBroken: part.status === "broken" ? true : undefined,
      });
      await ctx.db.patch(partId, { status: "pending" });
    }

    const label = user.name ?? user.email ?? "A member";
    const summary = await summarize(ctx, lines.map((l) => ({ groupId: l.groupId, count: Math.ceil(l.count) })));
    await notifyAdmin(ctx, `${label} requested a package rental (${summary})`, `/admin/requests`);
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `📦 ${label} requested a package rental: ${summary}${note ? `\n📝 ${note}` : ""}\n→ approve in the Requests console`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
    );
    return packageId;
  },
});

/** Member edits their still-pending package: replaces lines + re-picks units. */
export const editPackage = mutation({
  args: {
    packageId: v.id("rentalPackages"),
    lines: v.array(
      v.object({
        groupId: v.id("groups"),
        count: v.number(),
        note: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { packageId, lines, note }) => {
    const user = await requireNonGuest(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Package not found");
    if (pkg.userId !== user._id) throw new Error("Not your package");
    if (pkg.status !== "pending") throw new Error("Only pending packages can be edited");
    if (!lines.length) throw new Error("Add at least one item");

    // Release every claimed unit, then re-claim for the new lines.
    const oldRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const r of oldRentals.filter((r) => r.packageId === packageId)) {
      const part = await ctx.db.get(r.partId);
      if (part && part.status === "pending") await ctx.db.patch(part._id, { status: "available" });
      await ctx.db.delete(r._id);
    }

    const chosen: { partId: Id<"parts">; groupId: Id<"groups"> }[] = [];
    for (const line of lines) {
      if (line.count < 1) throw new Error("Each line needs at least 1 unit");
      if (line.count > MAX_UNITS_PER_LINE) throw new Error(`Max ${MAX_UNITS_PER_LINE} units per item`);
      const group = await ctx.db.get(line.groupId);
      if (!group || group.deleted) throw new Error(`"${group?.name ?? "item"}" no longer exists`);
      const candidates = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect();
      const wanted = Math.ceil(line.count);
      const free = candidates.filter((p) => p.status === "available");
      if (free.length < wanted) {
        throw new Error(`Not enough free units of ${group.name}: need ${wanted}, only ${free.length} available`);
      }
      const pool = free.slice(0, wanted);
      for (const part of pool) chosen.push({ partId: part._id, groupId: line.groupId });
    }

    await ctx.db.patch(packageId, {
      note: note?.trim() || undefined,
      lines: lines.map((l) => ({
        groupId: l.groupId,
        count: Math.ceil(l.count),
        note: l.note?.trim() || undefined,
      })),
    });
    for (const { partId } of chosen) {
      const part = await ctx.db.get(partId);
      if (!part) continue;
      await ctx.db.insert("rentals", {
        partId,
        userId: user._id,
        packageId,
        status: "pending",
        requestedAt: Date.now(),
        rentBroken: part.status === "broken" ? true : undefined,
      });
      await ctx.db.patch(partId, { status: "pending" });
    }
    await telegramGroup(ctx, `✏️ ${user.name ?? user.email ?? "A member"} edited their pending package rental request.`);
    return { ok: true };
  },
});

/** Member cancels their pending package entirely (units go back to available). */
export const cancelPackage = mutation({
  args: { packageId: v.id("rentalPackages") },
  handler: async (ctx, { packageId }) => {
    const user = await requireNonGuest(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Package not found");
    if (pkg.userId !== user._id) throw new Error("Not your package");
    if (pkg.status !== "pending") throw new Error("Only pending packages can be canceled");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const r of mine.filter((r) => r.packageId === packageId)) {
      const part = await ctx.db.get(r.partId);
      if (part && part.status === "pending") await ctx.db.patch(part._id, { status: "available" });
      await ctx.db.patch(r._id, { status: "canceled", decidedAt: Date.now() });
    }
    await ctx.db.patch(packageId, { status: "canceled", decidedAt: Date.now() });
    await telegramGroup(ctx, `🗑 ${user.name ?? user.email ?? "A member"} canceled their pending package rental request.`);
    return { ok: true };
  },
});

/** Admin approves or denies a pending package (all-or-nothing). */
export const decidePackage = mutation({
  args: { packageId: v.id("rentalPackages"), approve: v.boolean() },
  handler: async (ctx, { packageId, approve }) => {
    const admin = await requireAdmin(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Package not found");
    if (pkg.status !== "pending") throw new Error("This package was already handled");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const pkgRentals = mine.filter((r) => r.packageId === packageId);
    const member = await ctx.db.get(pkg.userId);
    const memberRef = { name: member?.name ?? member?.email, telegramUsername: member?.telegramUsername, telegramChatId: member?.telegramChatId };
    const now = Date.now();

    await ctx.db.patch(packageId, {
      status: approve ? "approved" : "canceled",
      decidedAt: now,
      returnRequestedAt: undefined,
    });
    for (const r of pkgRentals) {
      const part = await ctx.db.get(r.partId);
      const group = part ? await ctx.db.get(part.groupId) : null;
      if (approve) {
        await ctx.db.patch(r._id, { status: "active", decidedAt: now, pickedUpAt: now });
        if (part) await ctx.db.patch(part._id, { status: "rented", currentHolderId: pkg.userId });
      } else {
        await ctx.db.patch(r._id, { status: "denied", decidedAt: now });
        if (part && part.status === "pending") await ctx.db.patch(part._id, { status: "available" });
      }
    }

    const summaryText = await summarize(ctx, pkg.lines);

    if (member?.telegramChatId || member?.telegramUsername) {
      await telegramDM(
        ctx,
        memberRef,
        approve
          ? `✅ Package approved: ${summaryText}. Pick everything up from the lab.`
          : `❌ Package denied: ${summaryText}.`,
        { name: admin.name ?? admin.email },
      );
    }
    await telegramGroup(
      ctx,
      approve
        ? `✅ ${admin.name ?? admin.email} approved ${member?.name ?? member?.email ?? "a member"}'s package rental (${summaryText}).`
        : `❌ ${admin.name ?? admin.email} denied ${member?.name ?? member?.email ?? "a member"}'s package rental (${summaryText}).`,
    );
    if (member?.email) {
      await ctx.scheduler.runAfter(0, api.emails.sendRentalDecisionEmail, {
        to: member.email,
        student: member.name ?? member.email,
        partName: `package (${summaryText})`,
        approved: approve,
      });
    }
    return { ok: true };
  },
});

async function summarize(ctx: any, lines: { groupId: any; count: number }[]) {
  const parts: string[] = [];
  for (const l of lines) {
    const g = await ctx.db.get(l.groupId);
    parts.push(`${l.count}× ${g?.name ?? "item"}`);
  }
  return parts.join(", ");
}

/** Member asks to return the whole package (admin then processes units one by
 *  one). Same cooldown rules as single rentals. */
export const requestPackageReturn = mutation({
  args: { packageId: v.id("rentalPackages") },
  handler: async (ctx, { packageId }) => {
    const user = await requireNonGuest(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Package not found");
    if (pkg.userId !== user._id) throw new Error("Not your package");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = mine.filter((r) => r.packageId === packageId && r.status === "active");
    if (!active.length) throw new Error("No active units in this package");
    const cooldownHours = await returnCooldownHours(ctx);
    if (pkg.returnRequestedAt) {
      const elapsedH = (Date.now() - pkg.returnRequestedAt) / 36e5;
      if (elapsedH < cooldownHours) {
        const remaining = Math.ceil(cooldownHours - elapsedH);
        throw new Error(`You already requested a return — ask again in ${remaining}h`);
      }
    }
    await ctx.db.patch(packageId, { returnRequestedAt: Date.now() });
    for (const r of active) await ctx.db.patch(r._id, { returnRequestedAt: Date.now() });
    const summaryText = await summarize(ctx, pkg.lines);
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `↩️ ${user.name ?? user.email ?? "A member"} wants to return their package (${summaryText}) — process it in the Requests console.`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
    );
    // Attach a printable card per unit (capped so a 20-unit package doesn't
    // spam the group).
    const cache = docCache();
    for (const r of active.slice(0, 5)) {
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      await scheduleRentCard(
        ctx,
        r,
        part,
        group,
        user,
        "active · return requested",
        `↩️ Rent card (package) — ${group?.name ?? "part"} (${part?.tag ?? "?"}) return requested.`,
      );
    }
    return { ok: true };
  },
});

export async function ensureAdminUser(ctx: any, email: string) {
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q: any) => q.eq("email", email))
    .first();
  if (existing) {
    if (existing.role !== "admin") {
      await ctx.db.patch(existing._id, { role: "admin" });
    }
    return;
  }
  await ctx.db.insert("users", { email, name: "Dr. Essa", role: "admin", active: true });
}

export const promoteByEmail = mutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, { email, role }) => {
    await requireAdmin(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!user) throw new Error("No user found with that email — they must sign in once first");
    await ctx.db.patch(user._id, { role });
    if (role === "admin") {
      await ctx.db.insert("notifications", {
        forRole: "admin",
        type: "info",
        text: `${user.name ?? user.email} was promoted to admin`,
      });
    }
  },
});

export type PartId = Id<"parts">;
