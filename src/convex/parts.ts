import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireAdmin, requireNonGuest, requireInteractingMember, requireUser, safeImage } from "./lib";
import { adminPhones } from "./whatsapp";
import { telegramDM, telegramGroup, notifyTelegram } from "./notify";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { planMeasureTake, describePlan } from "../lib/measure-alloc";
import { sumUnitStock } from "./catalog";

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
        // Manual lend dates (admin-set) mirrored from the unit itself.
        takenAt: part.rentedAt,
        dueAt: part.dueAt ?? shown.dueAt,
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
        transferToName: r.transferToName,
        recoveredAmount: r.recoveredAmount,
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
        v.literal("transferred"),
        v.literal("consumed"),
      ),
    ),
    note: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    // Full-control editing: move the unit to a project (or off one with null),
    // and/or hand it to a member (or release the holder with null). The
    // open rental row — if any — is kept in sync so the ledger stays true.
    projectId: v.optional(v.union(v.id("projects"), v.null())),
    holderId: v.optional(v.union(v.id("users"), v.null())),
    // Lend dates for a manual hand-over: takenAt = when the member got it,
    // dueAt = when it should come back. Optional; "" clears.
    rentedAt: v.optional(v.union(v.number(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { id, tag, status, note, imageUrl, projectId, holderId, rentedAt, dueAt }) => {
    await requireAdmin(ctx);
    const part = await ctx.db.get(id);
    if (!part) throw new Error("Part not found");
    const patch: Record<string, unknown> = {};
    if (tag !== undefined) patch.tag = tag.trim().toUpperCase();
    if (note !== undefined) patch.note = note.trim();
    if (imageUrl !== undefined) patch.imageUrl = imageUrl.trim() || undefined;

    // Lend dates only make sense on a rented unit.
    if (rentedAt !== undefined) patch.rentedAt = rentedAt || undefined;
    if (dueAt !== undefined) patch.dueAt = dueAt || undefined;

    const wantsProject = projectId !== undefined;
    const wantsHolder = holderId !== undefined;
    const toProject = projectId ?? null;
    const toHolder = holderId ?? null;

    // Resolve the effective next status when the caller didn't set one
    // explicitly: project assignment wins, then a holder, then the chosen
    // status (or the current one).
    let nextStatus:
      | "available"
      | "pending"
      | "rented"
      | "on_project"
      | "broken"
      | "transferred"
      | "consumed" =
      status ?? (part.status as typeof nextStatus);
    if (wantsProject && toProject) {
      const project = await ctx.db.get(toProject);
      if (!project || project.deleted) throw new Error("Project not found");
      if (project.status !== "active") throw new Error("Project must be active");
      nextStatus = "on_project";
    } else if (wantsHolder) {
      if (toHolder) {
        const holder = await ctx.db.get(toHolder);
        if (!holder) throw new Error("Member not found");
        nextStatus = "rented";
      } else if (nextStatus === "rented" || nextStatus === "on_project") {
        // Releasing the holder with no explicit status → back on the shelf.
        nextStatus = "available";
      }
    }
    patch.status = nextStatus;

    // Sync the open rental row (pending/active for this unit) so history and
    // returns keep working after the manual edit.
    const openRental = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", id))
      .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "active")))
      .first();

    const now = Date.now();
    if (nextStatus === "on_project") {
      patch.currentHolderId = undefined;
      patch.currentProjectId = toProject ?? undefined;
      if (openRental) {
        await ctx.db.patch(openRental._id, {
          status: "on_project",
          projectId: toProject ?? openRental.projectId,
          returnedAt: now,
          returnDestination: "project",
          returnRequestedAt: undefined,
        });
      }
    } else if (nextStatus === "rented") {
      patch.currentHolderId = toHolder ?? undefined;
      patch.currentProjectId = undefined;
      if (openRental) {
        if (openRental.status === "pending") {
          await ctx.db.patch(openRental._id, {
            status: "active",
            userId: toHolder ?? openRental.userId,
            decidedAt: now,
            pickedUpAt: now,
            dueAt: (patch.dueAt as number | undefined) ?? undefined,
            returnRequestedAt: undefined,
          });
        } else if (toHolder) {
          await ctx.db.patch(openRental._id, {
            userId: toHolder,
            dueAt: (patch.dueAt as number | undefined) ?? openRental.dueAt,
          });
        }
      } else if (toHolder) {
        await ctx.db.insert("rentals", {
          partId: id,
          userId: toHolder,
          status: "active",
          requestedAt: now,
          decidedAt: now,
          pickedUpAt: (patch.rentedAt as number | undefined) ?? now,
          dueAt: patch.dueAt as number | undefined,
        });
      }
    } else {
      // available / broken / pending: no holder, no project; close any open
      // rental row unless the status is exactly "pending" (a live request).
      patch.currentHolderId = undefined;
      patch.currentProjectId = undefined;
      patch.rentedAt = undefined;
      patch.dueAt = undefined;
      if (openRental && nextStatus !== "pending") {
        await ctx.db.patch(openRental._id, {
          status: "returned",
          returnedAt: now,
          // Terminal admin edits keep the truth on the ledger too.
          returnDestination:
            nextStatus === "transferred" ? ("transferred" as const) : ("shelf" as const),
          returnRequestedAt: undefined,
        });
      }
    }

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
 * Queue the printable rent card (PDF) for the Telegram club group.
 * ONE message: the PDF document + every detail on its own caption line.
 * The PDF is rendered by the RentCardRelay client using the EXACT same card
 * component as the manual "Send PDF to group" button (perfect Arabic).
 * Fire-and-forget: queueing never blocks the mutation.
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
  extraUnits?: { tag: string; groupName: string }[],
) {
  await ctx.db.insert("rentCardJobs", {
    card: {
      rentalId: rental?._id,
      groupName: group?.name ?? "Part",
      tag: part?.tag ?? "?",
      holderName: student?.name ?? student?.email ?? "Member",
      studentId: student?.studentId,
      statusLabel,
      requestedAt: rental?.requestedAt,
      decidedAt: rental?.decidedAt,
      pickedUpAt: rental?.pickedUpAt,
      returnedAt: rental?.returnedAt,
      conditionReport: rental?.conditionReport,
      amount: rental?.amount,
      amountUnit: group?.measureUnit,
      projectName,
      extraUnits,
    },
    caption,
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
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
    const user = await requireInteractingMember(ctx);
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
    // WhatsApp to every admin (no-op until TWILIO_* keys are set). Sends run
    // in a scheduled action — fetch is not allowed inside mutations.
    for (const phone of await adminPhones(ctx)) {
      await ctx.scheduler.runAfter(0, internal.whatsapp.sendWhatsAppAction, {
        to: phone,
        body: `${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag}) — review it in the Requests console.`,
      });
    }
    // Telegram: post to the club group, tagging the admins who must act
    // (no-op until a bot token is configured in Settings or env).
    const admins = await ctx.db.query("users").collect();
    await telegramGroup(
      ctx,
      `📥 ${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag})${note ? `\n📝 ${note}` : ""}\n→ approve in the Requests console`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
      "requests",
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
    const user = await requireInteractingMember(ctx);
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
      "requests",
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
    const user = await requireInteractingMember(ctx);
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
      `⚠️ ${label} requested the BROKEN-unit rental ${group?.name ?? "part"} (${part.tag})${note ? `\n📝 ${note}` : ""} — for repair/refurb. Approve carefully.`,
      admins.filter((a) => a.role === "admin" && a.telegramUsername).map((a) => ({ name: a.name, telegramUsername: a.telegramUsername })),
      "requests",
    );
    return { ok: true };
  },
});

// Member deletes their own pending rental request (before approval).
export const deleteMyRentalRequest = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireInteractingMember(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    if (rental.userId !== user._id) throw new Error("Not your request");
    if (rental.status !== "pending") {
      throw new Error("Only pending requests can be deleted — after approval use a return instead");
    }
    const part = await ctx.db.get(rental.partId);
    await ctx.db.delete(rentalId);
    if (part && part.status === "pending") {
      // Deleted broken-unit requests restore the broken flag, not the shelf.
      await ctx.db.patch(part._id, { status: rental.rentBroken ? "broken" : "available" });
    }
    const group = part ? await ctx.db.get(part.groupId) : null;
    await telegramGroup(ctx, `🗑 ${user.name ?? user.email ?? "A member"} deleted their rental request for ${group?.name ?? "a part"}${part ? ` (${part.tag})` : ""}.`, undefined, "requests");
  },
});

// Member asks to return a rented part. One request per rental per cooldown
// period (admin-set, default 24h); the admin sees it in the Requests console.
export const requestReturn = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireInteractingMember(ctx);
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
    // ONE Telegram message: the printable rent-card PDF with every detail on
    // its own caption line (the old extra text post is gone).
    await scheduleRentCard(
      ctx,
      rental,
      part,
      group,
      user,
      "active · return requested",
      `↩️ ${user.name ?? user.email ?? "A member"} requested to return ${group?.name ?? "part"} (${part?.tag ?? "?"}) — process it in the Requests console.`,
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
      // Approval does NOT hand the unit over — the admin confirms the physical
      // handover separately ("Taken" step), which decrements inventory.
      await ctx.db.patch(rentalId, { status: "approved", decidedAt: Date.now() });
    } else {
      await ctx.db.patch(rentalId, { status: "denied", decidedAt: Date.now() });
      // A denied broken-unit request goes back to broken, NOT available —
      // the unit was flagged broken before the request and still is.
      if (part.status === "pending") {
        await ctx.db.patch(part._id, { status: rental.rentBroken ? "broken" : "available" });
      }
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
      await ctx.scheduler.runAfter(0, internal.whatsapp.sendWhatsAppAction, {
        to: student.phone,
        body: approve
          ? `✅ Your request was approved — ${group?.name ?? "a part"} (${part.tag}). You can pick it up from the lab.`
          : `❌ Your request for ${group?.name ?? "a part"} (${part.tag}) was denied.`,
      });
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
        undefined,
        "rentals",
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
      v.literal("mark_taken"),
      v.literal("mark_broken"),
      // Return → hand the unit over to another department / lab / person.
      v.literal("transfer"),
    ),
    projectId: v.optional(v.id("projects")),
    functional: v.optional(v.boolean()),
    conditionReport: v.optional(v.string()),
    // Transfer: destination name, details and an optional documentation
    // file/image (small data URL) attached to the return record.
    transferToName: v.optional(v.string()),
    transferDetails: v.optional(v.string()),
    transferDoc: v.optional(
      v.object({
        name: v.string(),
        mime: v.string(),
        size: v.number(),
        dataUrl: v.string(),
      }),
    ),
    // Bulk (weight/length) consumable returns: how much of the taken amount
    // physically came back and is re-shelved. The remainder is logged as
    // consumed on each affected unit. Defaults to the full taken amount.
    recoveredAmount: v.optional(v.number()),
    // Approvals: when the member should come pick the unit up. The approving
    // admin picks a date+time (or reuses an existing scheduled pickup).
    pickupAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      rentalId,
      action,
      projectId,
      functional,
      conditionReport,
      transferToName,
      transferDetails,
      transferDoc,
      recoveredAmount,
      pickupAt,
    },
  ) => {
    const admin = await requireAdmin(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    const part = await ctx.db.get(rental.partId);
    if (!part) throw new Error("Part no longer exists");
    const group = await ctx.db.get(part.groupId);
    const student = await ctx.db.get(rental.userId);
    const now = Date.now();

    if (action === "approve") {
      // Approval reserves the unit (or bulk amount) for the member; the
      // physical handover is a separate admin step ("Taken"/"Picked up"),
      // which decrements inventory.
      if (rental.status !== "pending") throw new Error("This request was already handled");
      const isBulk = group?.measure === "weight" || group?.measure === "length";
      if (isBulk) {
        const amt = rental.amount;
        if (amt === undefined || !Number.isFinite(amt) || amt <= 0) {
          throw new Error("Bulk request has no amount — deny it and ask the member to request again");
        }
        // Stock may have drifted since the request: re-check that a feasible
        // per-unit split still exists before saying yes.
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q: any) => q.eq("groupId", group!._id))
            .filter((q: any) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p: any) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p: any) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? group!.measureLowAt ?? 0),
          })),
          amt,
        );
        if (!plan.ok) throw new Error(plan.error);
      }
      await ctx.db.patch(rentalId, { status: "approved", decidedAt: now, pickupAt });
      const amountLabel = rental.amount !== undefined ? ` (${rental.amount} ${group?.measureUnit ?? ""})` : "";
      const pickupLabel = pickupAt
        ? new Date(pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
        : "as soon as the lab is open";
      if (student?.email) {
        await ctx.scheduler.runAfter(0, api.emails.sendRentalDecisionEmail, {
          to: student.email,
          student: student.name ?? student.email,
          partName: group?.name ?? "a part",
          approved: true,
        });
      }
      if (student?.phone) {
        await ctx.scheduler.runAfter(0, internal.whatsapp.sendWhatsAppAction, {
          to: student.phone,
          body: `✅ Your request was approved — ${group?.name ?? "a part"} (${part.tag})${amountLabel}. Pick it up ${pickupLabel}.`,
        });
      }
      if (student?.telegramChatId || student?.telegramUsername) {
        await telegramDM(
          ctx,
          { name: student.name ?? student.email, telegramUsername: student.telegramUsername, telegramChatId: student.telegramChatId },
          `✅ Approved: ${group?.name ?? "a part"} (${part.tag}).\\n📅 Pick-up time: ${pickupLabel}.\\nThe admin hands it over when you arrive — then it counts as rented.`,
          { name: admin.name ?? admin.email },
          "rentals",
        );
      }
      await telegramGroup(
        ctx,
        `✅ ${admin.name ?? admin.email} approved ${student?.name ?? student?.email ?? "a member"}'s rental of ${group?.name ?? "a part"} (${part.tag}).\\n📅 Scheduled pick-up: ${pickupLabel} — waiting for handover.`,
        undefined,
        "rentals",
      );
      // PDF rent card follows the approval, same as returns do.
      await scheduleRentCard(
        ctx,
        { ...rental, status: "approved", decidedAt: now, pickupAt },
        part,
        group,
        student,
        "approved · awaiting pickup",
        `✅ ${admin.name ?? admin.email} approved ${student?.name ?? student?.email ?? "a member"}'s rental of ${group?.name ?? "a part"} (${part.tag}) — pick-up ${pickupLabel}.`,
      );
    } else if (action === "deny") {
      if (rental.status !== "pending") throw new Error("This request was already handled");
      await ctx.db.patch(rentalId, { status: "denied", decidedAt: now });
      // Broken-unit requests return the unit to the broken pool, not the shelf.
      if (part.status === "pending") {
        await ctx.db.patch(part._id, { status: rental.rentBroken ? "broken" : "available" });
      }
      if (student?.email) {
        await ctx.scheduler.runAfter(0, api.emails.sendRentalDecisionEmail, {
          to: student.email,
          student: student.name ?? student.email,
          partName: group?.name ?? "a part",
          approved: false,
        });
      }
      if (student?.phone) {
        await ctx.scheduler.runAfter(0, internal.whatsapp.sendWhatsAppAction, {
          to: student.phone,
          body: `❌ Your request for ${group?.name ?? "a part"} (${part.tag}) was denied.`,
        });
      }
      if (student?.telegramChatId || student?.telegramUsername) {
        await telegramDM(
          ctx,
          { name: student.name ?? student.email, telegramUsername: student.telegramUsername, telegramChatId: student.telegramChatId },
          `❌ Denied: your request for ${group?.name ?? "a part"} (${part.tag}) was not approved.`,
          { name: admin.name ?? admin.email },
          "rentals",
        );
      }
      await telegramGroup(
        ctx,
        `❌ ${admin.name ?? admin.email} denied ${student?.name ?? student?.email ?? "a member"}'s rental request for ${group?.name ?? "a part"} (${part.tag}).`,
        undefined,
        "rentals",
      );
    } else if (action === "mark_taken") {
      // The admin physically hands the approved unit to the member (picked
      // up) — THIS is the moment the unit leaves the inventory (status →
      // rented, holder set, pickup timestamp recorded).
      if (rental.status !== "approved") {
        throw new Error("Only approved (not yet picked up) rentals can be marked taken");
      }
      const isBulk = group?.measure === "weight" || group?.measure === "length";
      if (isBulk) {
        // Bulk (weight/length) rental: cut the approved amount across the
        // group's physical units at hand-over. Whole units go out first; a
        // remainder is cut from the fullest unit that stays at/above its
        // minimum. The BULK placeholder part never becomes "rented".
        const amt = rental.amount;
        if (amt === undefined || !Number.isFinite(amt) || amt <= 0) {
          throw new Error("This bulk rental has no amount set — deny it and ask the member to request again");
        }
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q: any) => q.eq("groupId", group!._id))
            .filter((q: any) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p: any) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p: any) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? group!.measureLowAt ?? 0),
          })),
          amt,
        );
        if (!plan.ok) throw new Error(plan.error);
        const tagName = new Map(units.map((p: any) => [p._id, p.tag as string]));
        const allocationNote = describePlan(plan.plan, (id) => tagName.get(id), group!.measureUnit);
        for (const take of plan.plan) {
          const unit = units.find((p: any) => p._id === take.unitId);
          if (!unit) continue;
          const remaining = Number(unit.amountRemaining ?? 0) - take.amount;
          await ctx.db.patch(unit._id, {
            amountRemaining: String(Math.max(0, Number(remaining.toFixed(4)))),
            // A fully-drained unit is out of the shelf until it returns.
            status: take.whole ? "rented" : unit.status,
            currentHolderId: take.whole ? rental.userId : unit.currentHolderId,
          });
        }
        await ctx.db.patch(rentalId, {
          status: "active",
          pickedUpAt: now,
          allocations: plan.plan.map((p) => ({ partId: p.unitId as any, amount: p.amount })),
        });
        // Keep the group's headline stock in sync with the per-unit ledger.
        const stock = await sumUnitStock(ctx, group!._id);
        await ctx.db.patch(group!._id, { measureStock: String(stock) });
        // Multi-unit takes (e.g. 4 m from 3 m reels) tell the admin what to
        // physically hand over and note it on the rental for the record.
        if (plan.spansUnits) {
          await ctx.db.patch(rentalId, {
            conditionReport: `Multi-unit take: ${allocationNote}`,
          });
        }
        const amountNote = plan.spansUnits ? ` — split: ${allocationNote}` : "";
        await telegramDM(
          ctx,
          { name: student?.name ?? student?.email, telegramUsername: student?.telegramUsername, telegramChatId: student?.telegramChatId },
          `📦 Taken: ${group?.name ?? "a part"} (${rental.amount} ${group?.measureUnit ?? ""}) was handed to you. Return it to the lab when done.`,
          { name: admin.name ?? admin.email },
          "rentals",
        );
        await telegramGroup(
          ctx,
          `📦 ${admin.name ?? admin.email} handed ${student?.name ?? student?.email ?? "a member"} ${rental.amount} ${group?.measureUnit ?? ""} of ${group?.name ?? "a part"} (${part.tag})${amountNote} — stock deducted.`,
          undefined,
          "rentals",
        );
      } else {
        await ctx.db.patch(rentalId, { status: "active", pickedUpAt: now });
        await ctx.db.patch(part._id, { status: "rented", currentHolderId: rental.userId });
      }
      if (student?.telegramChatId || student?.telegramUsername) {
        await telegramDM(
          ctx,
          { name: student.name ?? student.email, telegramUsername: student.telegramUsername, telegramChatId: student.telegramChatId },
          `📦 Taken: ${group?.name ?? "a part"} (${part.tag})${rental.amount !== undefined ? ` (${rental.amount} ${group?.measureUnit ?? ""})` : ""} was handed to you. Return it to the lab when done.`,
          { name: admin.name ?? admin.email },
          "rentals",
        );
      }
      await telegramGroup(
        ctx,
        `📦 ${admin.name ?? admin.email} marked ${group?.name ?? "a part"} (${part.tag})${rental.amount !== undefined ? ` (${rental.amount} ${group?.measureUnit ?? ""})` : ""} as TAKEN by ${student?.name ?? student?.email ?? "a member"} — ${rental.amount !== undefined ? "stock deducted" : "inventory updated"}.`,
        undefined,
        "rentals",
      );
    } else if (action === "mark_returned") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      const isBulk = group?.measure === "weight" || group?.measure === "length";
      // Bulk consumable returns: the admin re-measures what physically came
      // back; the taken-but-not-returned remainder is consumed stock. Only
      // consumable categories can report "nothing came back".
      let recovered = Math.round((recoveredAmount ?? NaN) * 10000) / 10000;
      const takenTotal = (rental.allocations ?? []).reduce(
        (s: number, a: any) => s + Number(a.amount),
        0,
      );
      if (isBulk) {
        if (recoveredAmount === undefined) {
          recovered = takenTotal;
        }
        if (!Number.isFinite(recovered) || recovered < 0) {
          throw new Error("Recovered amount must be ≥ 0");
        }
        if (recovered > takenTotal + 1e-9) {
          throw new Error(
            `Recovered (${recovered}) cannot exceed the taken amount (${takenTotal} ${group?.measureUnit ?? ""})`,
          );
        }
      }
      await ctx.db.patch(rentalId, {
        status: "returned",
        returnedAt: now,
        returnDestination: "shelf",
        recoveredAmount: isBulk ? recovered : undefined,
        functional,
        conditionReport: conditionReport?.trim(),
        returnRequestedAt: undefined,
      });
      if (isBulk) {
        // Distribute the recovered amount across the taken units in take
        // order; whatever a unit doesn't get back is logged as consumed.
        let leftToRestore = recovered;
        for (const alloc of rental.allocations ?? []) {
          const unit = await ctx.db.get(alloc.partId);
          if (!unit) continue;
          const restore = Math.min(Number(alloc.amount), Math.max(0, leftToRestore));
          leftToRestore = Math.round((leftToRestore - restore) * 10000) / 10000;
          const consumedHere = Math.round((Number(alloc.amount) - restore) * 10000) / 10000;
          const base = Number(unit.amountRemaining ?? 0);
          await ctx.db.patch(unit._id, {
            amountRemaining: String(
              Math.round((base + restore) * 10000) / 10000,
            ),
            status: "available",
            currentHolderId: undefined,
            consumedAt: undefined,
            ...(consumedHere > 0
              ? {
                  consumptionLog: [
                    ...(unit.consumptionLog ?? []).slice(-49),
                    {
                      amount: -consumedHere,
                      at: now,
                      byId: admin._id,
                      byName: admin.name ?? admin.email,
                      via: "return" as const,
                      note: `Return of rental: ${recovered} of ${takenTotal} ${group?.measureUnit ?? ""} came back`,
                    },
                  ],
                }
              : {}),
          });
        }
        const stock = await sumUnitStock(ctx, group!._id);
        await ctx.db.patch(group!._id, { measureStock: String(stock) });
      } else if (functional === false) {
        await ctx.db.patch(part._id, { status: "broken", currentHolderId: undefined, rentedAt: undefined, dueAt: undefined });
      } else {
        await ctx.db.patch(part._id, { status: "available", currentHolderId: undefined, rentedAt: undefined, dueAt: undefined });
      }
      // ONE Telegram message: PDF card + details as its caption (with the
      // acting admin), replacing the previous text+card double post.
      const bulkNote =
        isBulk && recovered < takenTotal
          ? ` — recovered ${recovered} ${group?.measureUnit ?? ""}, ${Math.round((takenTotal - recovered) * 10000) / 10000} ${group?.measureUnit ?? ""} logged as consumed`
          : "";
      await scheduleRentCard(
        ctx,
        { ...rental, returnedAt: now, conditionReport: conditionReport?.trim() },
        part,
        group,
        student,
        functional === false ? "returned · marked broken" : "returned to shelf",
        `↩️ ${admin.name ?? admin.email} processed the return of ${group?.name ?? "part"} (${part.tag}) from ${student?.name ?? student?.email ?? "a member"}${bulkNote}${functional === false ? " — marked BROKEN" : " — back on the shelf"}.`,
      );
    } else if (action === "transfer") {
      // The unit does NOT come back to the club: it is handed over to another
      // department / lab / person. Requires a destination name; details and a
      // documentation file/photo are optional. Kept on the ledger so the QR
      // still resolves and the audit trail shows where it went.
      if (rental.status !== "active") throw new Error("Rental is not active");
      const destName = transferToName?.trim();
      if (!destName) throw new Error("Enter the transfer destination name");
      await ctx.db.patch(rentalId, {
        status: "returned",
        returnedAt: now,
        returnDestination: "transferred",
        transferToName: destName,
        transferDetails: transferDetails?.trim() || undefined,
        transferDoc: transferDoc ?? undefined,
        functional: functional ?? true,
        conditionReport: conditionReport?.trim(),
        returnRequestedAt: undefined,
      });
      const isBulkTransfer = group?.measure === "weight" || group?.measure === "length";
      if (isBulkTransfer) {
        // Transferred bulk stock is gone from the club — drop the taken
        // amount from every affected unit and log it as transferred out.
        for (const alloc of rental.allocations ?? []) {
          const unit = await ctx.db.get(alloc.partId);
          if (!unit) continue;
          const base = Number(unit.amountRemaining ?? 0);
          const left = Math.max(0, base - Number(alloc.amount));
          await ctx.db.patch(unit._id, {
            amountRemaining: String(left),
            currentHolderId: undefined,
            consumedAt: left <= 0 ? now : undefined,
            consumptionLog: [
              ...(unit.consumptionLog ?? []).slice(-49),
              {
                amount: -Number(alloc.amount),
                at: now,
                byId: admin._id,
                byName: admin.name ?? admin.email,
                via: "return" as const,
                note: `Transferred to ${destName}`,
              },
            ],
          });
        }
        const stock = await sumUnitStock(ctx, group!._id);
        await ctx.db.patch(group!._id, { measureStock: String(stock) });
      } else {
        await ctx.db.patch(part._id, {
          status: "transferred",
          currentHolderId: undefined,
          currentProjectId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
      await telegramGroup(
        ctx,
        `📤 ${admin.name ?? admin.email} transferred ${group?.name ?? "part"} (${part.tag}) from ${student?.name ?? student?.email ?? "a member"} to “${destName}”${transferDetails?.trim() ? ` — ${transferDetails.trim()}` : ""}. The unit stays on record with its QR.`,
        undefined,
        "inventory",
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
      const isBulkAssign = group?.measure === "weight" || group?.measure === "length";
      if (isBulkAssign) {
        // Bulk stock assigned to a project stays deducted until the project
        // is dismantled — the units were consumed into the build.
        for (const alloc of rental.allocations ?? []) {
          const unit = await ctx.db.get(alloc.partId);
          if (!unit) continue;
          const left = Math.max(0, Number(unit.amountRemaining ?? 0) - Number(alloc.amount));
          await ctx.db.patch(unit._id, {
            amountRemaining: String(left),
            currentHolderId: undefined,
          });
        }
        const stock = await sumUnitStock(ctx, group!._id);
        await ctx.db.patch(group!._id, { measureStock: String(stock) });
      } else {
        await ctx.db.patch(part._id, { status: "on_project", currentProjectId: projectId, currentHolderId: undefined, rentedAt: undefined, dueAt: undefined });
      }
      // ONE Telegram message: PDF card + details as its caption.
      await scheduleRentCard(
        ctx,
        { ...rental, returnedAt: now, projectId, conditionReport: conditionReport?.trim() },
        part,
        group,
        student,
        "assigned to project",
        `🤖 ${admin.name ?? admin.email} assigned ${group?.name ?? "part"} (${part.tag}) to project “${project.name}” until it is dismantled.`,
        project.name,
      );
    } else if (action === "mark_broken") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      await ctx.db.patch(rentalId, { status: "returned", returnedAt: now, returnDestination: "shelf", functional: false, conditionReport: conditionReport?.trim(), returnRequestedAt: undefined });
      const isBulkBroken = group?.measure === "weight" || group?.measure === "length";
      if (isBulkBroken) {
        // Broken bulk stock is written off — nothing is restored.
        for (const alloc of rental.allocations ?? []) {
          const unit = await ctx.db.get(alloc.partId);
          if (!unit) continue;
          const left = Math.max(0, Number(unit.amountRemaining ?? 0) - Number(alloc.amount));
          await ctx.db.patch(unit._id, { amountRemaining: String(left), currentHolderId: undefined });
        }
        const stock = await sumUnitStock(ctx, group!._id);
        await ctx.db.patch(group!._id, { measureStock: String(stock) });
      } else {
        await ctx.db.patch(part._id, { status: "broken", currentHolderId: undefined });
      }
      await scheduleRentCard(
        ctx,
        { ...rental, returnedAt: now, conditionReport: conditionReport?.trim() },
        part,
        group,
        student,
        "returned · marked broken",
        `⚠️ ${admin.name ?? admin.email} returned ${group?.name ?? "part"} (${part.tag}) from ${student?.name ?? student?.email ?? "a member"} and marked it BROKEN.`,
      );
    }
    return { ok: true };
  },
});

/**
 * Admin processes the return of EVERY active unit of a package in one click.
 * All units go to the same destination (shelf or project) with the same
 * condition; per-unit fine-tuning can follow via the normal unit returns.
 */
export const returnWholePackage = mutation({
  args: {
    packageId: v.id("rentalPackages"),
    destination: v.union(v.literal("shelf"), v.literal("project"), v.literal("transferred")),
    projectId: v.optional(v.id("projects")),
    functional: v.boolean(),
    conditionReport: v.optional(v.string()),
    transferToName: v.optional(v.string()),
    transferDetails: v.optional(v.string()),
    recoveredAmount: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { packageId, destination, projectId, functional, conditionReport, transferToName, transferDetails, recoveredAmount },
  ) => {
    const admin = await requireAdmin(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Package not found");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const active = mine.filter((r) => r.packageId === packageId && r.status === "active");
    if (active.length === 0) throw new Error("No active units left in this package");

    let project: any = null;
    if (destination === "project") {
      if (!projectId) throw new Error("Select a project");
      project = await ctx.db.get(projectId);
      if (!project || project.status !== "active") throw new Error("Project must be active");
    }
    if (destination === "transferred" && !transferToName?.trim()) {
      throw new Error("Enter the transfer destination name");
    }

    const now = Date.now();
    const member = await ctx.db.get(pkg.userId);
    const units: { tag: string; groupName: string }[] = [];
    for (const r of active) {
      const part = await ctx.db.get(r.partId);
      if (!part) continue;
      const group = await ctx.db.get(part.groupId);
      units.push({ tag: part.tag, groupName: group?.name ?? "Part" });
      if (destination === "transferred") {
        // Every unit of the bundle goes to the same external destination.
        await ctx.db.patch(r._id, {
          status: "returned",
          returnedAt: now,
          returnDestination: "transferred",
          transferToName: transferToName!.trim(),
          transferDetails: transferDetails?.trim() || undefined,
          functional,
          conditionReport: conditionReport?.trim(),
          returnRequestedAt: undefined,
        });
        const isBulkX = group?.measure === "weight" || group?.measure === "length";
        if (isBulkX) {
          for (const alloc of r.allocations ?? []) {
            const unit = await ctx.db.get(alloc.partId);
            if (!unit) continue;
            const left = Math.max(0, Number(unit.amountRemaining ?? 0) - Number(alloc.amount));
            await ctx.db.patch(unit._id, {
              amountRemaining: String(left),
              currentHolderId: undefined,
              consumedAt: left <= 0 ? now : undefined,
              consumptionLog: [
                ...(unit.consumptionLog ?? []).slice(-49),
                {
                  amount: -Number(alloc.amount),
                  at: now,
                  byId: admin._id,
                  byName: admin.name ?? admin.email,
                  via: "return" as const,
                  note: `Transferred to ${transferToName!.trim()}`,
                },
              ],
            });
          }
          const stock = await sumUnitStock(ctx, group!._id);
          await ctx.db.patch(group!._id, { measureStock: String(stock) });
        } else {
          await ctx.db.patch(part._id, {
            status: "transferred",
            currentHolderId: undefined,
            currentProjectId: undefined,
            rentedAt: undefined,
            dueAt: undefined,
          });
        }
      } else if (destination === "shelf") {
        await ctx.db.patch(r._id, {
          status: "returned",
          returnedAt: now,
          returnDestination: "shelf",
          functional,
          conditionReport: conditionReport?.trim(),
          returnRequestedAt: undefined,
        });
        await ctx.db.patch(part._id, {
          status: functional ? "available" : "broken",
          currentHolderId: undefined,
        });
      } else {
        await ctx.db.patch(r._id, {
          status: "on_project",
          returnedAt: now,
          returnDestination: "project",
          projectId,
          functional,
          conditionReport: conditionReport?.trim(),
          returnRequestedAt: undefined,
        });
        await ctx.db.patch(part._id, {
          status: "on_project",
          currentProjectId: projectId,
          currentHolderId: undefined,
        });
      }
    }
    // Package row: mark the return flag cleared and log the batch decision.
    await ctx.db.patch(packageId, { returnRequestedAt: undefined, returnDecidedAt: now });

    const summaryText = await summarize(ctx, pkg.lines);
    // ONE combined PDF card for the whole bundle (details in its caption —
    // no separate text post).
    const first = active[0];
    const firstPart = await ctx.db.get(first.partId);
    const firstGroup = firstPart ? await ctx.db.get(firstPart.groupId) : null;
    await scheduleRentCard(
      ctx,
      { ...first, returnedAt: now, conditionReport: conditionReport?.trim() },
      firstPart,
      firstGroup,
      member,
      destination === "project"
        ? "assigned to project (package)"
        : destination === "transferred"
          ? "transferred (package)"
          : functional
            ? "returned to shelf (package)"
            : "returned · marked broken (package)",
      `↩️ ${admin.name ?? admin.email} processed the package return of ${member?.name ?? member?.email ?? "a member"} (${summaryText}) — ${units.length} unit${units.length === 1 ? "" : "s"} ${destination === "transferred" ? `transferred to “${transferToName!.trim()}”` : destination === "shelf" ? (functional ? "back on the shelf" : "marked BROKEN") : `assigned to “${project?.name}”`}.`,
      project?.name,
      units,
    );
    return { ok: true, processed: units.length };
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
      rentedAt: undefined,
      dueAt: undefined,
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
      rentedAt: undefined,
      dueAt: undefined,
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

// Request counts the dashboard needs (used for the notification dot on My
// Rentals). Pending packages are counted ONCE per package (the member sees one
// bundle card), not once per claimed unit — otherwise the bubble shows a
// number far bigger than the list actually renders.
export const myRequestCounts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const packageIds = new Set(
      rows.filter((r) => r.status === "pending" && r.packageId).map((r) => r.packageId!),
    );
    const pendingPackages = packageIds.size;
    const pendingSingles = rows.filter((r) => r.status === "pending" && !r.packageId).length;
    return {
      pending: pendingPackages + pendingSingles,
      active: rows.filter((r) => r.status === "active").length,
      onProject: rows.filter((r) => r.status === "on_project").length,
      total: rows.length,
    };
  },
});

export const cancelMyRequest = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireInteractingMember(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    if (rental.userId !== user._id) throw new Error("Not your request");
    if (rental.status !== "pending") throw new Error("Only pending requests can be canceled");
    await ctx.db.patch(rentalId, { status: "canceled", decidedAt: Date.now() });
    const part = await ctx.db.get(rental.partId);
    if (part && part.status === "pending") {
      // Broken-unit requests put the unit back into the broken pool.
      await ctx.db.patch(part._id, { status: rental.rentBroken ? "broken" : "available" });
    }
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

// Groups the admin's pending rentals into display rows: single requests stay
// one row each, while units claimed by the same pending package collapse into
// ONE row per package — so the Pending tab badge and the list always agree.
export const pendingRentalRows = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const cache = docCache();
    const out: any[] = [];
    for (const r of rows.sort((a, b) => a.requestedAt - b.requestedAt)) {
      if (r.packageId) continue;
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      const student = await cache.get(ctx, r.userId);
      out.push({
        kind: "single" as const,
        key: r._id,
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
    // One row per pending package, with its units attached.
    const pkgIds = [...new Set(rows.filter((r) => r.packageId).map((r) => r.packageId!))];
    for (const packageId of pkgIds) {
      const pkg = await ctx.db.get(packageId);
      if (!pkg) continue;
      const units = [];
      for (const r of rows.filter((x) => x.packageId === packageId)) {
        const part = await cache.get(ctx, r.partId);
        const group = part ? await cache.get(ctx, part.groupId) : null;
        units.push({ rentalId: r._id, partId: part?._id, tag: part?.tag, groupName: group?.name });
      }
      const student = await cache.get(ctx, pkg.userId);
      out.push({
        kind: "package" as const,
        key: packageId,
        package: pkg,
        packageId,
        packageNote: pkg.note,
        units,
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
      const u = await requireInteractingMember(ctx);
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
        // Split the "open" units by pickup stage: awaiting hand-over vs handed out.
        approvedUnits: pkgRentals.filter((r) => r.status === "approved").length,
        activeUnits: pkgRentals.filter((r) => r.status === "active").length,
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
    const user = await requireInteractingMember(ctx);
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
      "requests",
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
    const user = await requireInteractingMember(ctx);
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
    await telegramGroup(ctx, `✏️ ${user.name ?? user.email ?? "A member"} edited their pending package rental request.`, undefined, "requests");
    return { ok: true };
  },
});

/** Member cancels their pending package entirely (units go back to available). */
export const cancelPackage = mutation({
  args: { packageId: v.id("rentalPackages") },
  handler: async (ctx, { packageId }) => {
    const user = await requireInteractingMember(ctx);
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
    await telegramGroup(ctx, `🗑 ${user.name ?? user.email ?? "A member"} canceled their pending package rental request.`, undefined, "requests");
    return { ok: true };
  },
});

/** Admin approves or denies a pending package (all-or-nothing). */
export const decidePackage = mutation({
  args: { packageId: v.id("rentalPackages"), approve: v.boolean(), pickupAt: v.optional(v.number()) },
  handler: async (ctx, { packageId, approve, pickupAt }) => {
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

    if (approve) {
      await ctx.db.patch(packageId, { status: "approved", decidedAt: now, pickupAt });
      for (const r of pkgRentals) {
        // Units stay reserved: rental -> "approved" (awaiting pick-up), the
        // part keeps its open request; inventory decrements only at the
        // physical hand-over (mark_taken) — same stages as single rentals.
        await ctx.db.patch(r._id, { status: "approved", decidedAt: now, pickupAt });
      }
    } else {
      await ctx.db.patch(packageId, { status: "canceled", decidedAt: now });
      for (const r of pkgRentals) {
        const part = await ctx.db.get(r.partId);
        await ctx.db.patch(r._id, { status: "denied", decidedAt: now });
        if (part && part.status === "pending") await ctx.db.patch(part._id, { status: "available" });
      }
    }

    const summaryText = await summarize(ctx, pkg.lines);
    const pickupLabel = pickupAt
      ? new Date(pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
      : "as soon as the lab is open";

    if (member?.telegramChatId || member?.telegramUsername) {
      await telegramDM(
        ctx,
        memberRef,
        approve
          ? `✅ Package approved: ${summaryText}.\n📅 Pick-up time: ${pickupLabel} — units are handed over at the lab.`
          : `❌ Package denied: ${summaryText}.`,
        { name: admin.name ?? admin.email },
        "rentals",
      );
    }
    await telegramGroup(
      ctx,
      approve
        ? `✅ ${admin.name ?? admin.email} approved ${member?.name ?? member?.email ?? "a member"}'s package rental (${summaryText}).\n📅 Scheduled pick-up: ${pickupLabel} — waiting for handover.`
        : `❌ ${admin.name ?? admin.email} denied ${member?.name ?? member?.email ?? "a member"}'s package rental (${summaryText}).`,
      undefined,
      "rentals",
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
    const user = await requireInteractingMember(ctx);
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
    // ONE combined package card: a single PDF listing every unit of the
    // bundle (no per-unit message spam).
    const cache = docCache();
    const first = active[0];
    const firstPart = await cache.get(ctx, first.partId);
    const firstGroup = firstPart ? await cache.get(ctx, firstPart.groupId) : null;
    const units: { tag: string; groupName: string }[] = [];
    for (const r of active) {
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      units.push({ tag: part?.tag ?? "?", groupName: group?.name ?? "Part" });
    }
    await scheduleRentCard(
      ctx,
      first,
      firstPart,
      firstGroup,
      user,
      "active · return requested",
      `↩️ ${user.name ?? user.email ?? "A member"} requested to return their package (${summaryText}) — process it in the Requests console.`,
      undefined,
      units,
    );
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
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("student")),
  },
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

// ===== Pickup scheduling (approval → handover stage) =====

/**
 * Approved rentals with a scheduled pick-up the member has NOT taken yet.
 * The admin console shows these so they can reuse an existing slot for a new
 * request ("same date as the other pickup") or chase no-shows.
 */
export const scheduledPickups = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const cache = docCache();
    const out = [];
    for (const r of rows.sort((a, b) => (a.pickupAt ?? Infinity) - (b.pickupAt ?? Infinity))) {
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      const student = await cache.get(ctx, r.userId);
      out.push({
        rentalId: r._id,
        pickupAt: r.pickupAt,
        groupName: group?.name ?? "Part",
        tag: part?.tag,
        studentName: student?.name ?? student?.email,
      });
    }
    return out;
  },
});

/**
 * Reminder sweep, run by the cron every 15 minutes: approved rentals with a
 * scheduled pick-up get a Telegram nudge 24h before and again 1h before.
 * Each stage fires once (flagged on the rental row).
 */
export const pickupReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const now = Date.now();
    let sent = 0;
    for (const r of rows) {
      if (!r.pickupAt || r.pickupAt < now) continue;
      const untilMs = r.pickupAt - now;
      const part = await ctx.db.get(r.partId);
      const group = part ? await ctx.db.get(part.groupId) : null;
      const student = await ctx.db.get(r.userId);
      const when = new Date(r.pickupAt).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const dm = async (text: string) => {
        if (student?.telegramChatId || student?.telegramUsername) {
          await telegramDM(
            ctx,
            {
              name: student.name ?? student.email,
              telegramUsername: student.telegramUsername,
              telegramChatId: student.telegramChatId,
            },
            text,
            undefined,
            "rentals",
          );
          sent += 1;
        }
      };
      if (untilMs <= 26 * 36e5 && untilMs > 23 * 36e5 && !r.pickupRemindedDay) {
        await ctx.db.patch(r._id, { pickupRemindedDay: true });
        await dm(
          `⏰ Reminder: pick up ${group?.name ?? "your part"} (${part?.tag ?? "?"}) tomorrow — ${when}.`,
        );
      }
      if (untilMs <= 61 * 60_000 && untilMs > 45 * 60_000 && !r.pickupRemindedHour) {
        await ctx.db.patch(r._id, { pickupRemindedHour: true });
        await dm(
          `⏰ Pick-up in ~1 hour: ${group?.name ?? "your part"} (${part?.tag ?? "?"}) at ${when}. See you at the lab!`,
        );
      }
    }
    return { sent };
  },
});
