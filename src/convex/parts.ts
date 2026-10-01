import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireAdmin, requireNonGuest, requireInteractingMember, requireUser, safeImage } from "./lib";
import { adminPhones } from "./whatsapp";
import { telegramDM, telegramGroup, notifyTelegram } from "./notify";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { planMeasureTake, describePlan } from "../lib/measure-alloc";
import { formatLineAmount, roundBulk } from "../lib/group-measure";
import { sumUnitStock, assertGroupLendable, containerChainFromIndex } from "./catalog";
import { touchPatch, recordTombstone } from "./sync";

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
    // Natural tag order so the ← → unit navigation follows the printed tags.
    return parts.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  },
});

/**
 * Units of every group in one query (search support): the inventory grid and
 * the package builder join these client-side so searching matches unit tags
 * and per-unit notes too, not just the group fields. Heavy fields that no
 * search needs (the consumption audit trail) are stripped to keep the
 * payload small.
 */
/**
 * All rental records of ONE unit (with the same student join as
 * listAllRentals). The unit detail page used to subscribe to the whole
 * rentals table just to show one part's history — this keeps that page
 * proportional to the unit's own history instead of the entire ledger.
 */
export const rentalsOfPart = query({
  args: { partId: v.id("parts") },
  handler: async (ctx, { partId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect();
    const cache = docCache();
    // The unit's group + its container chain (printed on the rent card).
    const part0 = await ctx.db.get(partId);
    const group0 = part0 ? await ctx.db.get(part0.groupId) : null;
    let containerChain = "";
    if (group0) {
      const groups = await ctx.db.query("groups").collect();
      const idx = new Map(groups.map((g) => [g._id, g]));
      containerChain = containerChainFromIndex(group0, idx);
    }
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const student = await cache.get(ctx, r.userId);
      out.push({
        rental: r,
        part: await cache.get(ctx, partId),
        group: group0,
        containerChain,
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

export const listPartsByGroups = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    return parts
      .map(({ consumptionLog: _log, ...rest }) => rest)
      .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
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
    const byGroup: Record<
      string,
      { available: number; broken: number; pending: number; rented: number; onProject: number; bulkFree: number }
    > = {};
    const groupMeasure = new Map<string, string | undefined>();
    for (const p of parts) {
      const row = (byGroup[p.groupId] ??= {
        available: 0,
        broken: 0,
        pending: 0,
        rented: 0,
        onProject: 0,
        bulkFree: 0,
      });
      // Weight/length groups keep a per-unit amount ledger — the lendable
      // "free" stock is the summed remaining amount of AVAILABLE units
      // (whole reels/spools that are still on the shelf), not unit counts.
      if (p.status === "available") {
        row.available += 1;
        let m = groupMeasure.get(p.groupId);
        if (m === undefined) {
          const g = await ctx.db.get(p.groupId);
          m = g?.measure;
          groupMeasure.set(p.groupId, m);
        }
        if (m === "weight" || m === "length") {
          row.bulkFree += Number(p.amountRemaining ?? 0);
        }
      } else if (p.status === "broken") row.broken += 1;
      else if (p.status === "pending") row.pending += 1;
      else if (p.status === "rented") row.rented += 1;
      else if (p.status === "on_project") row.onProject += 1;
    }
    for (const row of Object.values(byGroup)) row.bulkFree = roundBulk(row.bulkFree);
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
        transferDocName: r.transferDoc?.name,
        transferDocUrl: r.transferDoc?.dataUrl,
        transferDocMime: r.transferDoc?.mime,
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
    // Move the physical unit into a different group (its QR tag rides along).
    // Only allowed for units sitting on the shelf (available / broken) — a
    // rented or on-project unit must be returned/processed first.
    moveGroupId: v.optional(v.id("groups")),
    // Where the unit went when status is "transferred" (another department,
    // a donated lab…). "" clears. Kept on the ledger row closed by this edit.
    transferToName: v.optional(v.string()),
  },
  handler: async (ctx, { id, tag, status, note, imageUrl, projectId, holderId, rentedAt, dueAt, moveGroupId, transferToName }) => {
    await requireAdmin(ctx);
    const currentPart = await ctx.db.get(id);
    if (!currentPart) throw new ConvexError("Part not found");
    if (moveGroupId && moveGroupId !== currentPart.groupId) {
      const target = await ctx.db.get(moveGroupId);
      if (!target || target.deleted) throw new ConvexError("Target group not found");
      if (target.measure === "weight" || target.measure === "length") {
        throw new ConvexError("Weight/length groups track material — use their own add-unit flow");
      }
      if (target.measure === "pack") {
        throw new ConvexError("Pack groups hold only their own packs — use their Add-unit flow instead");
      }
      // Master containers hold groups, not units.
      const all = await ctx.db
        .query("groups")
        .withIndex("by_category")
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect();
      if (all.some((g) => g.parentGroupId === moveGroupId)) {
        throw new ConvexError("Master containers hold groups, not units — pick a normal group");
      }
      if (currentPart.status !== "available" && currentPart.status !== "broken") {
        throw new ConvexError("Only shelf units (available/broken) can be moved — return it first");
      }
      await ctx.db.patch(id, { groupId: moveGroupId });
      // Re-sync both groups' quantity totals.
      const recount = async (gid: Id<"groups">) => {
        const n = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q) => q.eq("groupId", gid))
            .collect()
        ).length;
        await touchPatch(ctx, gid, { quantityTotal: n });
      };
      await recount(currentPart.groupId);
      await recount(moveGroupId);
    }
    const part = currentPart;
    const patch: Record<string, unknown> = {};
    if (tag !== undefined) patch.tag = tag.trim().toUpperCase();
    if (note !== undefined) patch.note = note.trim();
    if (imageUrl !== undefined) patch.imageUrl = imageUrl.trim() || undefined;

    // Lend dates only make sense on a rented unit.
    if (rentedAt !== undefined) patch.rentedAt = rentedAt || undefined;
    if (dueAt !== undefined) patch.dueAt = dueAt || undefined;
    // Transfer destination only makes sense on a transferred unit; leaving the
    // status cleans it up automatically.
    if (transferToName !== undefined) patch.transferToName = transferToName.trim() || undefined;

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
      if (!project || project.deleted) throw new ConvexError("Project not found");
      if (project.status !== "active") throw new ConvexError("Project must be active");
      nextStatus = "on_project";
    } else if (wantsHolder) {
      if (toHolder) {
        const holder = await ctx.db.get(toHolder);
        if (!holder) throw new ConvexError("Member not found");
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
        await touchPatch(ctx, openRental._id, {
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
          await touchPatch(ctx, openRental._id, {
            status: "active",
            userId: toHolder ?? openRental.userId,
            decidedAt: now,
            pickedUpAt: now,
            dueAt: (patch.dueAt as number | undefined) ?? undefined,
            returnRequestedAt: undefined,
          });
        } else if (toHolder) {
          await touchPatch(ctx, openRental._id, {
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
          updatedAt: now,
        });
      }
    } else {
      // available / broken / pending / transferred / consumed: no holder, no
      // project; close any open rental row unless the status is exactly
      // "pending" (a live request).
      patch.currentHolderId = undefined;
      patch.currentProjectId = undefined;
      patch.rentedAt = undefined;
      patch.dueAt = undefined;
      if (nextStatus !== "transferred") patch.transferToName = undefined;
      if (openRental && nextStatus !== "pending") {
        await touchPatch(ctx, openRental._id, {
          status: "returned",
          returnedAt: now,
          // Terminal admin edits keep the truth on the ledger too.
          returnDestination:
            nextStatus === "transferred" ? ("transferred" as const) : ("shelf" as const),
          // Carry the destination name onto the ledger row for transfers.
          transferToName:
            nextStatus === "transferred"
              ? ((patch.transferToName as string | undefined) ?? openRental.transferToName)
              : undefined,
          returnRequestedAt: undefined,
        });
      }
    }

    await touchPatch(ctx, id, patch);
  },
});

export const deletePart = mutation({
  args: { id: v.id("parts") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const part = await ctx.db.get(id);
    if (!part) return;
    if (part.status === "rented" || part.status === "on_project") {
      throw new ConvexError("Part is out on rent or a project. Process a return first.");
    }
    await ctx.db.delete(id);
    await recordTombstone(ctx, "parts", String(id));
    const group = await ctx.db.get(part.groupId);
    if (group) {
      const remaining = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", part.groupId))
        .collect();
      await touchPatch(ctx, group._id, { quantityTotal: remaining.length });
      // Packs keep their total pieces in measureStock — re-sum after removal.
      if (group.measure === "pack") {
        const stock = await sumUnitStock(ctx, part.groupId);
        await touchPatch(ctx, group._id, { measureStock: String(stock) });
      }
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
    if (!part) throw new ConvexError("Part not found");
    if (part.status !== "available") {
      throw new ConvexError("This unit is not available right now");
    }
    const group0 = await ctx.db.get(part.groupId);
    // An emptied pack (all pieces consumed) is out of circulation.
    if (group0?.measure === "pack" && Number(part.amountRemaining ?? 0) <= 0) {
      throw new ConvexError("This pack is empty — log pieces via Update consumption before lending it again");
    }
    // Storage-alias groups (named exactly like a storage) open the storage
    // when their QR is scanned — they cannot be lent.
    await assertGroupLendable(ctx, part.groupId);
    const existing = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) throw new ConvexError("There is already a pending request for this unit");
    const group = await ctx.db.get(groupId);

    const rentalId = await ctx.db.insert("rentals", {
      partId,
      userId: user._id,
      status: "pending",
      requestedAt: Date.now(),
      updatedAt: Date.now(),
      // The request note rides on the record itself (not just the admin
      // notification), so the part's history keeps the full context.
      note: note?.trim() || undefined,
    });
    await touchPatch(ctx, partId, { status: "pending" });
    const studentLabel = user.name ?? user.email ?? "A member";
    await notifyAdmin(
      ctx,
      `${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag})`,
      `/admin/requests`,
    );
    // OS-level push to every admin device (no-op until VAPID keys are set).
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New rental request",
      body: `${studentLabel} requested to rent ${group?.name ?? "a part"} (${part.tag})`,
      tag: "roboshelf-request",
      url: "/admin/requests",
    });
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
    if (!group || group.deleted) throw new ConvexError("Group not found");
    // Storage-alias groups cannot be lent (see assertGroupLendable).
    await assertGroupLendable(ctx, groupId);
    const candidates = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const free = candidates.filter(
      (p) =>
        p.status === "available" &&
        // Emptied packs (all pieces consumed) are out of circulation.
        !(group.measure === "pack" && Number(p.amountRemaining ?? 0) <= 0),
    );
    if (free.length < wanted) {
      throw new ConvexError(`Only ${free.length} unit(s) available (you asked for ${wanted})`);
    }
    const pool = free.slice(0, wanted);
    const label = user.name ?? user.email ?? "A member";
    for (const part of pool) {
      const existing = await ctx.db
        .query("rentals")
        .withIndex("by_part", (q) => q.eq("partId", part._id))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (existing) throw new ConvexError(`Unit ${part.tag} already has a pending request`);
      await ctx.db.insert("rentals", {
        partId: part._id,
        userId: user._id,
        status: "pending",
        requestedAt: Date.now(),
        updatedAt: Date.now(),
        note: note?.trim() || undefined,
      });
      await touchPatch(ctx, part._id, { status: "pending" });
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
    if (!part) throw new ConvexError("Part not found");
    if (part.status !== "broken") {
      throw new ConvexError("This unit is not flagged broken — use the normal request");
    }
    const existing = await ctx.db
      .query("rentals")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (existing) throw new ConvexError("There is already a pending request for this unit");
    const group = await ctx.db.get(part.groupId);
    const label = user.name ?? user.email ?? "A member";
    await ctx.db.insert("rentals", {
      partId,
      userId: user._id,
      status: "pending",
      requestedAt: Date.now(),
      updatedAt: Date.now(),
      note: note?.trim() || undefined,
      rentBroken: true,
    });
    await touchPatch(ctx, partId, { status: "pending" });
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
    if (!rental) throw new ConvexError("Rental not found");
    if (rental.userId !== user._id) throw new ConvexError("Not your request");
    if (rental.status !== "pending") {
      throw new ConvexError("Only pending requests can be deleted — after approval use a return instead");
    }
    const part = await ctx.db.get(rental.partId);
    await ctx.db.delete(rentalId);
    await recordTombstone(ctx, "rentals", String(rentalId));
    if (part && part.status === "pending") {
      // Deleted broken-unit requests restore the broken flag, not the shelf.
      await touchPatch(ctx, part._id, { status: rental.rentBroken ? "broken" : "available" });
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
    if (!rental) throw new ConvexError("Rental not found");
    if (rental.userId !== user._id) throw new ConvexError("Not your rental");
    if (rental.status !== "active") {
      throw new ConvexError("Only active rentals can be returned");
    }
    const cooldownHours = await returnCooldownHours(ctx);
    if (rental.returnRequestedAt) {
      const elapsedH = (Date.now() - rental.returnRequestedAt) / 36e5;
      if (elapsedH < cooldownHours) {
        const remaining = Math.ceil(cooldownHours - elapsedH);
        throw new ConvexError(
          `You already requested a return for this rental — you can ask again in ${remaining}h`,
        );
      }
    }
    await touchPatch(ctx, rentalId, { returnRequestedAt: Date.now() });
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
    if (!rental) throw new ConvexError("Rental not found");
    if (rental.status !== "pending") throw new ConvexError("This request was already handled");
    const part = await ctx.db.get(rental.partId);
    if (!part) throw new ConvexError("Part no longer exists");
    const group = part ? await ctx.db.get(part.groupId) : null;
    const student = await ctx.db.get(rental.userId);

    if (approve) {
      // Approval does NOT hand the unit over — the admin confirms the physical
      // handover separately ("Taken" step), which decrements inventory.
      await touchPatch(ctx, rentalId, { status: "approved", decidedAt: Date.now() });
    } else {
      await touchPatch(ctx, rentalId, { status: "denied", decidedAt: Date.now() });
      // A denied broken-unit request goes back to broken, NOT available —
      // the unit was flagged broken before the request and still is.
      if (part.status === "pending") {
        await touchPatch(ctx, part._id, { status: rental.rentBroken ? "broken" : "available" });
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
    if (!rental) throw new ConvexError("Rental not found");
    const part = await ctx.db.get(rental.partId);
    if (!part) throw new ConvexError("Part no longer exists");
    const group = await ctx.db.get(part.groupId);
    const student = await ctx.db.get(rental.userId);
    const now = Date.now();

    if (action === "approve") {
      // Approval reserves the unit (or bulk amount) for the member; the
      // physical handover is a separate admin step ("Taken"/"Picked up"),
      // which decrements inventory.
      if (rental.status !== "pending") throw new ConvexError("This request was already handled");
      const isBulk = group?.measure === "weight" || group?.measure === "length";
      if (isBulk) {
        const amt = rental.amount;
        if (amt === undefined || !Number.isFinite(amt) || amt <= 0) {
          throw new ConvexError("Bulk request has no amount — deny it and ask the member to request again");
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
        if (!plan.ok) throw new ConvexError(plan.error);
      }
      await touchPatch(ctx, rentalId, { status: "approved", decidedAt: now, pickupAt });
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
      if (rental.status !== "pending") throw new ConvexError("This request was already handled");
      await touchPatch(ctx, rentalId, { status: "denied", decidedAt: now });
      // Broken-unit requests return the unit to the broken pool, not the shelf.
      if (part.status === "pending") {
        await touchPatch(ctx, part._id, { status: rental.rentBroken ? "broken" : "available" });
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
        throw new ConvexError("Only approved (not yet picked up) rentals can be marked taken");
      }
      const isBulk = group?.measure === "weight" || group?.measure === "length";
      if (isBulk) {
        // Bulk (weight/length) rental: cut the approved amount across the
        // group's physical units at hand-over. Whole units go out first; a
        // remainder is cut from the fullest unit that stays at/above its
        // minimum. The BULK placeholder part never becomes "rented".
        const amt = rental.amount;
        if (amt === undefined || !Number.isFinite(amt) || amt <= 0) {
          throw new ConvexError("This bulk rental has no amount set — deny it and ask the member to request again");
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
        if (!plan.ok) throw new ConvexError(plan.error);
        const tagName = new Map(units.map((p: any) => [p._id, p.tag as string]));
        const allocationNote = describePlan(plan.plan, (id) => tagName.get(id), group!.measureUnit);
        for (const take of plan.plan) {
          const unit = units.find((p: any) => p._id === take.unitId);
          if (!unit) continue;
          const remaining = Number(unit.amountRemaining ?? 0) - take.amount;
          await touchPatch(ctx, unit._id, {
            amountRemaining: String(Math.max(0, Number(remaining.toFixed(4)))),
            // A fully-drained unit is out of the shelf until it returns.
            status: take.whole ? "rented" : unit.status,
            currentHolderId: take.whole ? rental.userId : unit.currentHolderId,
          });
        }
        await touchPatch(ctx, rentalId, {
          status: "active",
          pickedUpAt: now,
          // Manual hand-over: align the paper trail to now (see count branch).
          requestedAt: rental.requestedAt ?? now,
          decidedAt: now,
          allocations: plan.plan.map((p) => ({ partId: p.unitId as any, amount: p.amount })),
        });
        // Keep the group's headline stock in sync with the per-unit ledger.
        const stock = await sumUnitStock(ctx, group!._id);
        await touchPatch(ctx, group!._id, { measureStock: String(stock) });
        // Multi-unit takes (e.g. 4 m from 3 m reels) tell the admin what to
        // physically hand over and note it on the rental for the record.
        if (plan.spansUnits) {
          await touchPatch(ctx, rentalId, {
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
        // Manual hand-over: the admin is marking the unit rented NOW, so the
        // paper trail should read like it happened at this moment — the
        // request, decision and pick-up timestamps all align to this date.
        await touchPatch(ctx, rentalId, {
          status: "active",
          pickedUpAt: now,
          requestedAt: rental.requestedAt ?? now,
          decidedAt: now,
        });
        await touchPatch(ctx, part._id, { status: "rented", currentHolderId: rental.userId });
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
      if (rental.status !== "active") throw new ConvexError("Rental is not active");
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
        if (functional === false) {
          // Broken bulk stock: nothing usable came back — write it all off.
          recovered = 0;
        } else if (recoveredAmount === undefined) {
          recovered = takenTotal;
        }
        if (!Number.isFinite(recovered) || recovered < 0) {
          throw new ConvexError("Recovered amount must be ≥ 0");
        }
        if (recovered > takenTotal + 1e-9) {
          throw new ConvexError(
            `Recovered (${recovered}) cannot exceed the taken amount (${takenTotal} ${group?.measureUnit ?? ""})`,
          );
        }
      }
      await touchPatch(ctx, rentalId, {
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
          await touchPatch(ctx, unit._id, {
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
        await touchPatch(ctx, group!._id, { measureStock: String(stock) });
      } else if (functional === false) {
        await touchPatch(ctx, part._id, { status: "broken", currentHolderId: undefined, rentedAt: undefined, dueAt: undefined });
      } else {
        await touchPatch(ctx, part._id, { status: "available", currentHolderId: undefined, rentedAt: undefined, dueAt: undefined });
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
      if (rental.status !== "active") throw new ConvexError("Rental is not active");
      const destName = transferToName?.trim();
      if (!destName) throw new ConvexError("Enter the transfer destination name");
      await touchPatch(ctx, rentalId, {
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
          await touchPatch(ctx, unit._id, {
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
        await touchPatch(ctx, group!._id, { measureStock: String(stock) });
      } else {
        await touchPatch(ctx, part._id, {
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
      if (rental.status !== "active") throw new ConvexError("Rental is not active");
      if (!projectId) throw new ConvexError("Select a project");
      const project = await ctx.db.get(projectId);
      if (!project || project.status !== "active") throw new ConvexError("Project must be active");
      await touchPatch(ctx, rentalId, {
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
          await touchPatch(ctx, unit._id, {
            amountRemaining: String(left),
            currentHolderId: undefined,
          });
        }
        const stock = await sumUnitStock(ctx, group!._id);
        await touchPatch(ctx, group!._id, { measureStock: String(stock) });
      } else {
        await touchPatch(ctx, part._id, { status: "on_project", currentProjectId: projectId, currentHolderId: undefined, rentedAt: undefined, dueAt: undefined });
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
      if (rental.status !== "active") throw new ConvexError("Rental is not active");
      await touchPatch(ctx, rentalId, { status: "returned", returnedAt: now, returnDestination: "shelf", functional: false, conditionReport: conditionReport?.trim(), returnRequestedAt: undefined });
      const isBulkBroken = group?.measure === "weight" || group?.measure === "length";
      if (isBulkBroken) {
        // Broken bulk stock is written off — nothing is restored.
        for (const alloc of rental.allocations ?? []) {
          const unit = await ctx.db.get(alloc.partId);
          if (!unit) continue;
          const left = Math.max(0, Number(unit.amountRemaining ?? 0) - Number(alloc.amount));
          await touchPatch(ctx, unit._id, { amountRemaining: String(left), currentHolderId: undefined });
        }
        const stock = await sumUnitStock(ctx, group!._id);
        await touchPatch(ctx, group!._id, { measureStock: String(stock) });
      } else {
        await touchPatch(ctx, part._id, { status: "broken", currentHolderId: undefined });
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
    // Official transfer documentation (photo of the signed form, PDF…), kept
    // as a small data URL — attached to EVERY unit record of the bundle.
    transferDoc: v.optional(
      v.object({
        name: v.string(),
        mime: v.string(),
        size: v.number(),
        dataUrl: v.string(),
      }),
    ),
    recoveredAmount: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { packageId, destination, projectId, functional, conditionReport, transferToName, transferDetails, transferDoc, recoveredAmount },
  ) => {
    const admin = await requireAdmin(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new ConvexError("Package not found");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const active = mine.filter((r) => r.packageId === packageId && r.status === "active");
    if (active.length === 0) throw new ConvexError("No active units left in this package");

    let project: any = null;
    if (destination === "project") {
      if (!projectId) throw new ConvexError("Select a project");
      project = await ctx.db.get(projectId);
      if (!project || project.status !== "active") throw new ConvexError("Project must be active");
    }
    if (destination === "transferred" && !transferToName?.trim()) {
      throw new ConvexError("Enter the transfer destination name");
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
        await touchPatch(ctx, r._id, {
          status: "returned",
          returnedAt: now,
          returnDestination: "transferred",
          transferToName: transferToName!.trim(),
          transferDetails: transferDetails?.trim() || undefined,
          transferDoc,
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
            await touchPatch(ctx, unit._id, {
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
          await touchPatch(ctx, group!._id, { measureStock: String(stock) });
        } else {
          await touchPatch(ctx, part._id, {
            status: "transferred",
            currentHolderId: undefined,
            currentProjectId: undefined,
            rentedAt: undefined,
            dueAt: undefined,
          });
        }
      } else if (destination === "shelf") {
        await touchPatch(ctx, r._id, {
          status: "returned",
          returnedAt: now,
          returnDestination: "shelf",
          functional,
          conditionReport: conditionReport?.trim(),
          returnRequestedAt: undefined,
        });
        await touchPatch(ctx, part._id, {
          status: functional ? "available" : "broken",
          currentHolderId: undefined,
        });
      } else {
        await touchPatch(ctx, r._id, {
          status: "on_project",
          returnedAt: now,
          returnDestination: "project",
          projectId,
          functional,
          conditionReport: conditionReport?.trim(),
          returnRequestedAt: undefined,
        });
        await touchPatch(ctx, part._id, {
          status: "on_project",
          currentProjectId: projectId,
          currentHolderId: undefined,
        });
      }
    }
    // Package row: mark the return flag cleared and log the batch decision —
    // with the return date so the card/console show when it came back.
    await touchPatch(ctx, packageId, {
      returnRequestedAt: undefined,
      returnDecidedAt: now,
      returnedAt: now,
    });

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
    if (!part) throw new ConvexError("Part not found");
    if (part.status !== "rented") {
      throw new ConvexError("Only rented parts can be returned here");
    }
    await touchPatch(ctx, part._id, {
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
      await touchPatch(ctx, r._id, {
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
    if (!part) throw new ConvexError("Part not found");
    if (part.status !== "rented") {
      throw new ConvexError("Only rented parts can be assigned to a project");
    }
    const project = await ctx.db.get(projectId);
    if (!project || project.status !== "active") throw new ConvexError("Project must be active");
    await touchPatch(ctx, part._id, {
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
      await touchPatch(ctx, r._id, {
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
    if (!rental) throw new ConvexError("Rental not found");
    if (rental.userId !== user._id) throw new ConvexError("Not your request");
    if (rental.status !== "pending") throw new ConvexError("Only pending requests can be canceled");
    await touchPatch(ctx, rentalId, { status: "canceled", decidedAt: Date.now() });
    const part = await ctx.db.get(rental.partId);
    if (part && part.status === "pending") {
      // Broken-unit requests put the unit back into the broken pool.
      await touchPatch(ctx, part._id, { status: rental.rentBroken ? "broken" : "available" });
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
    if (!clean) throw new ConvexError("Message is empty");
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
              // Lend-window dates for the package card + date editor.
              requestedAt: r.requestedAt,
              decidedAt: r.decidedAt,
              pickedUpAt: r.pickedUpAt,
              returnedAt: r.returnedAt,
              dueAt: r.dueAt,
            });
          }
        }
        lines.push({
          groupId: line.groupId,
          groupName: group?.name ?? "(deleted group)",
          requested: line.count,
          // Same amount under the raw field name so generic formatters
          // (formatLineAmount) work on server lines without reshaping.
          count: line.count,
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

/**
 * Where is this unit held right now? Powers the "open the holding request"
 * jump on the unit page: the live rental record (pending/approved/active/on
 * project) plus its package, so admins can reach the exact request instead
 * of hunting through the Requests console.
 */
export const holdingOfPart = query({
  args: { partId: v.id("parts") },
  handler: async (ctx, { partId }) => {
    await requireUser(ctx);
    const part = await ctx.db.get(partId);
    if (!part) return null;

    const rental = (
      await ctx.db
        .query("rentals")
        .withIndex("by_part", (q) => q.eq("partId", partId))
        .collect()
    )
      .filter((r) => r.status === "pending" || r.status === "approved" || r.status === "active" || r.status === "on_project")
      .sort((a, b) => b.requestedAt - a.requestedAt)[0];
    if (!rental) return null;

    const holder = rental.userId ? await ctx.db.get(rental.userId) : null;
    const pkg = rental.packageId ? await ctx.db.get(rental.packageId) : null;
    return {
      rentalId: rental._id,
      status: rental.status,
      requestedAt: rental.requestedAt,
      holderName: holder?.name ?? holder?.email ?? "A member",
      packageId: pkg && pkg.status !== "canceled" ? pkg._id : null,
      packageStatus: pkg?.status,
    };
  },
});

export const getPackage = query({
  args: { id: v.id("rentalPackages") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const pkg = await ctx.db.get(id);
    if (!pkg) return null;
    if (pkg.userId !== user._id && user.role !== "admin") {
      throw new ConvexError("Not your package");
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
            requestedAt: r.requestedAt,
            decidedAt: r.decidedAt,
            pickedUpAt: r.pickedUpAt,
            returnedAt: r.returnedAt,
            dueAt: r.dueAt,
          });
        }
      }
      lines.push({ groupId: line.groupId, groupName: group?.name ?? "(deleted group)", requested: line.count, count: line.count, note: line.note, units });
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
    if (!lines.length) throw new ConvexError("Add at least one item");
    if (lines.length > MAX_PACKAGE_LINES) throw new ConvexError(`Packages are limited to ${MAX_PACKAGE_LINES} items`);

    // Resolve units up front: enough available units per group, skipping
    // broken ones unless the member explicitly opts in (rent-broken feature).
    const chosen: { partId: Id<"parts">; groupId: Id<"groups"> }[] = [];
    // Bulk (weight/length) lines reserve an AMOUNT, not units: the request is
    // validated against the per-unit ledgers now; stock is cut at hand-over
    // (mark_taken), exactly like single bulk rentals.
    const bulkAmountByGroup = new Map<Id<"groups">, number>();
    const storeLines = lines.map((l) => ({
      groupId: l.groupId,
      count: Math.ceil(l.count),
      note: l.note?.trim() || undefined,
    }));
    // Per-line notes, used as the fallback detail for a part when the
    // package has no note of its own (the package note always wins).
    const lineNoteByGroup = new Map<Id<"groups">, string>();
    for (const l of storeLines) {
      if (l.note && !lineNoteByGroup.has(l.groupId)) lineNoteByGroup.set(l.groupId, l.note);
    }
    const noteForUnit = (groupId: Id<"groups">) =>
      note?.trim() || lineNoteByGroup.get(groupId) || undefined;
    for (const [idx, line] of lines.entries()) {
      if (line.count < 1) throw new ConvexError("Each line needs at least 1 unit");
      if (line.count > MAX_UNITS_PER_LINE) throw new ConvexError(`Max ${MAX_UNITS_PER_LINE} units per item`);
      const group = await ctx.db.get(line.groupId);
      // Storage-alias groups cannot be lent, also not inside a package.
      await assertGroupLendable(ctx, line.groupId);
      if (!group || group.deleted) throw new ConvexError(`"${group?.name ?? "item"}" no longer exists`);
      if (group.measure === "weight" || group.measure === "length") {
        const amount = roundBulk(line.count);
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
            .filter((q) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? group.measureLowAt ?? 0),
          })),
          amount,
        );
        if (!plan.ok) throw new ConvexError(`${group.name}: ${plan.error}`);
        bulkAmountByGroup.set(line.groupId, amount);
        storeLines[idx].count = amount;
        continue;
      }
      const candidates = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect();
      const wanted = Math.ceil(line.count);
      const free = candidates.filter((p) => p.status === "available");
      const broken = candidates.filter((p) => p.status === "broken");
      if (free.length < wanted) {
        throw new ConvexError(
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
      lines: storeLines,
      requestedAt: Date.now(),
      updatedAt: Date.now(),
    });

    for (const { partId, groupId } of chosen) {
      const part = await ctx.db.get(partId);
      if (!part) continue;
      await ctx.db.insert("rentals", {
        partId,
        userId: user._id,
        packageId,
        status: "pending",
        requestedAt: Date.now(),
        updatedAt: Date.now(),
        note: noteForUnit(groupId),
        rentBroken: part.status === "broken" ? true : undefined,
      });
      await touchPatch(ctx, partId, { status: "pending" });
    }
    // Bulk lines: ONE pending rental on the group's BULK placeholder part,
    // carrying the requested amount — units stay on the shelf until hand-over.
    for (const [groupId, amount] of bulkAmountByGroup) {
      const holder = await ensureBulkPart(ctx, groupId);
      await ctx.db.insert("rentals", {
        partId: holder._id,
        userId: user._id,
        packageId,
        status: "pending",
        requestedAt: Date.now(),
        amount,
        updatedAt: Date.now(),
        note: noteForUnit(groupId),
      });
    }

    const label = user.name ?? user.email ?? "A member";
    const summary = await summarize(ctx, storeLines);
    await notifyAdmin(ctx, `${label} requested a package rental (${summary})`, `/admin/requests`);
    // OS-level push to every admin device (no-op until VAPID keys are set).
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New package request",
      body: `${label} requested a package rental (${summary})`,
      tag: "roboshelf-request",
      url: "/admin/requests",
    });
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
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.userId !== user._id) throw new ConvexError("Not your package");
    if (pkg.status !== "pending") throw new ConvexError("Only pending packages can be edited");
    if (!lines.length) throw new ConvexError("Add at least one item");

    // Release every claimed unit, then re-claim for the new lines. Bulk
    // lines are never deleted — a removed line's amount record is canceled
    // and a kept line's amount is adjusted in place, so the admin always
    // sees the real request amount (and history keeps its allocation link).
    const oldRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const bulkGroupIds = new Set<string>();
    for (const line of lines) {
      const g = await ctx.db.get(line.groupId);
      if (g && (g.measure === "weight" || g.measure === "length")) bulkGroupIds.add(line.groupId);
    }
    for (const r of oldRentals.filter((r) => r.packageId === packageId)) {
      const part = r.partId ? await ctx.db.get(r.partId) : null;
      if (part?.tag === "BULK") {
        if (bulkGroupIds.has(part.groupId)) continue; // amount adjusted below
        await touchPatch(ctx, r._id, { status: "canceled", decidedAt: Date.now() });
        continue;
      }
      if (part && part.status === "pending") await touchPatch(ctx, part._id, { status: "available" });
      await ctx.db.delete(r._id);
      await recordTombstone(ctx, "rentals", String(r._id));
    }

    const chosen: { partId: Id<"parts">; groupId: Id<"groups"> }[] = [];
    const bulkAmountByGroup = new Map<Id<"groups">, number>();
    // Package note wins over the per-line note on every part record.
    const lineNoteByGroup = new Map<Id<"groups">, string>();
    for (const line of lines) {
      const ln = line.note?.trim();
      if (ln && !lineNoteByGroup.has(line.groupId)) lineNoteByGroup.set(line.groupId, ln);
    }
    const noteForUnit = (groupId: Id<"groups">) =>
      note?.trim() || lineNoteByGroup.get(groupId) || undefined;
    for (const line of lines) {
      if (line.count < 1) throw new ConvexError("Each line needs at least 1 unit");
      if (line.count > MAX_UNITS_PER_LINE) throw new ConvexError(`Max ${MAX_UNITS_PER_LINE} units per item`);
      const group = await ctx.db.get(line.groupId);
      // Storage-alias groups cannot be lent, also not inside a package.
      await assertGroupLendable(ctx, line.groupId);
      if (!group || group.deleted) throw new ConvexError(`"${group?.name ?? "item"}" no longer exists`);
      if (group.measure === "weight" || group.measure === "length") {
        const amount = roundBulk(line.count);
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
            .filter((q) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? group.measureLowAt ?? 0),
          })),
          amount,
        );
        if (!plan.ok) throw new ConvexError(`${group.name}: ${plan.error}`);
        bulkAmountByGroup.set(line.groupId, amount);
        continue;
      }
      const candidates = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect();
      const wanted = Math.ceil(line.count);
      const free = candidates.filter((p) => p.status === "available");
      if (free.length < wanted) {
        throw new ConvexError(`Not enough free units of ${group.name}: need ${wanted}, only ${free.length} available`);
      }
      const pool = free.slice(0, wanted);
      for (const part of pool) chosen.push({ partId: part._id, groupId: line.groupId });
    }

    await touchPatch(ctx, packageId, {
      note: note?.trim() || undefined,
      lines: lines.map((l) => ({
        groupId: l.groupId,
        count: l.count,
        note: l.note?.trim() || undefined,
      })),
    });
    for (const { partId, groupId } of chosen) {
      const part = await ctx.db.get(partId);
      if (!part) continue;
      await ctx.db.insert("rentals", {
        partId,
        userId: user._id,
        packageId,
        status: "pending",
        requestedAt: Date.now(),
        updatedAt: Date.now(),
        note: noteForUnit(groupId),
        rentBroken: part.status === "broken" ? true : undefined,
      });
      await touchPatch(ctx, partId, { status: "pending" });
    }
    // Bulk lines: upsert the amount on the group's existing pending record,
    // or create one on the BULK placeholder when the line is new.
    for (const [groupId, amount] of bulkAmountByGroup) {
      const holder = await ensureBulkPart(ctx, groupId);
      const existing = oldRentals.find(
        (r) => r.packageId === packageId && r.partId === holder._id && r.status === "pending",
      );
      if (existing) {
        await touchPatch(ctx, existing._id, { amount, note: noteForUnit(groupId) });
      } else {
        await ctx.db.insert("rentals", {
          partId: holder._id,
          userId: user._id,
          packageId,
          status: "pending",
          requestedAt: Date.now(),
          amount,
          updatedAt: Date.now(),
          note: noteForUnit(groupId),
        });
      }
    }
    await telegramGroup(ctx, `✏️ ${user.name ?? user.email ?? "A member"} edited their pending package rental request.`, undefined, "requests");
    return { ok: true };
  },
});

/**
 * ADMIN package record editor — the package-level twin of EditRentalDialog.
 * - Pending package: full re-pick (release every claimed unit, then re-claim
 *   for the new lines), exactly like the member's own editPackage.
 * - Approved/active package: surgical diff — added units are claimed from the
 *   shelf ("approved" from the start, they are part of an approved bundle);
 *   surplus pending/approved units are released. Units that are active,
 *   on a project or already processed are NEVER touched — live records are
 *   edited/deleted per unit through the normal record editor instead.
 * note / pickupAt are upserted; a null pickupAt clears the schedule for the
 * whole bundle.
 */
export const adminEditPackage = mutation({
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
    pickupAt: v.optional(v.union(v.number(), v.null())),
    // Date corrections — same null-clears/omit-keeps semantics as the
    // per-record editor (updateRentalRecord). Applied to the package row,
    // every rental record in the bundle and the held UNITS themselves
    // (a rented part carries rentedAt/dueAt), so the whole bundle shows
    // exactly the dates the admin set.
    requestedAt: v.optional(v.union(v.number(), v.null())),
    decidedAt: v.optional(v.union(v.number(), v.null())),
    pickedUpAt: v.optional(v.union(v.number(), v.null())),
    returnedAt: v.optional(v.union(v.number(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
    // Units the admin explicitly un-tagged in the package editor. Only
    // pending/approved records can be removed this way — live/processed ones
    // are refused (they are managed per unit instead).
    removeRentalIds: v.optional(v.array(v.id("rentals"))),
    // Re-assign the whole package (and every unit record in it) to another
    // member — the bundle-level twin of the per-record renter edit.
    userId: v.optional(v.id("users")),
  },
  handler: async (
    ctx,
    { packageId, lines, note, pickupAt, requestedAt, decidedAt, pickedUpAt, returnedAt, dueAt, removeRentalIds, userId },
  ) => {
    const admin = await requireAdmin(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.status !== "pending" && pkg.status !== "approved") {
      throw new ConvexError("Only pending or approved packages can be edited");
    }
    if (!lines.length) throw new ConvexError("Add at least one item");
    if (lines.length > MAX_PACKAGE_LINES) throw new ConvexError(`Packages are limited to ${MAX_PACKAGE_LINES} items`);

    const now = Date.now();
    const cleanLines = lines.map((l) => ({
      groupId: l.groupId,
      count: Math.ceil(l.count),
      note: l.note?.trim() || undefined,
    }));
    // Bulk (weight/length) lines carry their real amount (not whole units) in
    // pkg.lines — keep it instead of the ceiled count.
    const bulkGroupIds = new Set<string>();
    for (const [idx, l] of lines.entries()) {
      const g = await ctx.db.get(l.groupId);
      if (g && (g.measure === "weight" || g.measure === "length")) {
        bulkGroupIds.add(l.groupId);
        cleanLines[idx].count = roundBulk(l.count);
      }
    }
    // The package's details/notes apply to EVERY part in the bundle: the
    // package note wins, the per-line note is the fallback. Mirrored onto
    // each unit record below (and kept in sync on every edit).
    const lineNoteByGroup = new Map<Id<"groups">, string>();
    for (const l of cleanLines) {
      if (l.note && !lineNoteByGroup.has(l.groupId)) lineNoteByGroup.set(l.groupId, l.note);
    }
    const noteForUnit = (groupId: Id<"groups">) =>
      note?.trim() || lineNoteByGroup.get(groupId) || undefined;

    // Date corrections — null clears a date, omit keeps the stored value
    // (same rules as the per-record editor). Applied per branch below.
    const datePatch: Record<string, unknown> = {};
    if (requestedAt !== undefined) datePatch.requestedAt = requestedAt || undefined;
    if (decidedAt !== undefined) datePatch.decidedAt = decidedAt || undefined;
    if (pickedUpAt !== undefined) datePatch.pickedUpAt = pickedUpAt || undefined;
    if (returnedAt !== undefined) datePatch.returnedAt = returnedAt || undefined;
    if (dueAt !== undefined) datePatch.dueAt = dueAt || undefined;
    if (pickupAt !== undefined) datePatch.pickupAt = pickupAt || undefined;

    const myRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const pkgRentals = myRentals.filter((r) => r.packageId === packageId);
    const member = await ctx.db.get(pkg.userId);
    // Optional renter change — applies to the package row AND every unit
    // record in it (pending re-pick inserts under the new member directly).
    let renterId: any = pkg.userId;
    if (userId !== undefined && userId !== pkg.userId) {
      const newHolder = await ctx.db.get(userId);
      if (!newHolder) throw new ConvexError("New renter not found");
      renterId = userId;
    }

    if (pkg.status === "pending") {
      // Same full re-pick semantics as the member edit, but admin-side.
      // Safety: a pending package must not hold handed-out units — if a
      // per-unit edit moved one to approved/active/on_project, a blanket
      // re-pick would delete a record that still holds its unit.
      const holding = pkgRentals.filter((r) => ["approved", "active", "on_project"].includes(r.status));
      if (holding.length > 0) {
        throw new ConvexError(
          "This package has units already handed out — edit or return those records per unit instead of re-picking the package",
        );
      }
      for (const r of pkgRentals) {
        const part = r.partId ? await ctx.db.get(r.partId) : null;
        if (part?.tag === "BULK") {
          // Bulk lines are never deleted — the amount is adjusted below so
          // the admin always sees the real request amount in the console.
          if (bulkGroupIds.has(part.groupId)) continue;
          await touchPatch(ctx, r._id, { status: "canceled", decidedAt: now });
          continue;
        }
        if (part && part.status === "pending") await touchPatch(ctx, part._id, { status: "available" });
        await ctx.db.delete(r._id);
        await recordTombstone(ctx, "rentals", String(r._id));
      }
      const chosen: { partId: Id<"parts">; groupId: Id<"groups"> }[] = [];
      const bulkAmounts = new Map<Id<"groups">, number>();
      for (const line of cleanLines) {
        if (line.count < 1) throw new ConvexError("Each line needs at least 1 unit");
        if (line.count > MAX_UNITS_PER_LINE) throw new ConvexError(`Max ${MAX_UNITS_PER_LINE} units per item`);
        const group = await ctx.db.get(line.groupId);
        await assertGroupLendable(ctx, line.groupId);
        if (!group || group.deleted) throw new ConvexError(`"${group?.name ?? "item"}" no longer exists`);
        if (group.measure === "weight" || group.measure === "length") {
          const amount = roundBulk(line.count);
          const units = (
            await ctx.db
              .query("parts")
              .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
              .filter((q) => q.neq(q.field("deleted"), true))
              .collect()
          ).filter((p) => p.status === "available" && p.tag !== "BULK");
          const plan = planMeasureTake(
            units.map((p) => ({
              id: p._id,
              remaining: Number(p.amountRemaining ?? 0),
              lowAt: Number(p.lowAt ?? group.measureLowAt ?? 0),
            })),
            amount,
          );
          if (!plan.ok) throw new ConvexError(`${group.name}: ${plan.error}`);
          bulkAmounts.set(line.groupId, amount);
          continue;
        }
        const candidates = await ctx.db
          .query("parts")
          .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
          .filter((q) => q.neq(q.field("deleted"), true))
          .collect();
        const wanted = Math.ceil(line.count);
        const free = candidates.filter((p) => p.status === "available");
        if (free.length < wanted) {
          throw new ConvexError(`Not enough free units of ${group.name}: need ${wanted}, only ${free.length} available`);
        }
        for (const part of free.slice(0, wanted)) chosen.push({ partId: part._id, groupId: line.groupId });
      }
      // Bulk lines: upsert the amount on the group's surviving pending
      // record, or create one on the BULK placeholder for a new line.
      for (const [groupId, amount] of bulkAmounts) {
        const holder = await ensureBulkPart(ctx, groupId);
        const existing = pkgRentals.find(
          (r) => r.status === "pending" && r.partId === holder._id,
        );
        if (existing) {
          await touchPatch(ctx, existing._id, { amount, note: noteForUnit(groupId) });
        } else {
          await ctx.db.insert("rentals", {
            partId: holder._id,
            userId: renterId,
            packageId,
            status: "pending",
            requestedAt: now,
            amount,
            updatedAt: now,
            note: noteForUnit(groupId),
          });
        }
      }
      await touchPatch(ctx, packageId, {
        note: note?.trim() || undefined,
        lines: cleanLines,
        pickupAt: pickupAt === undefined ? pkg.pickupAt : (pickupAt ?? undefined),
        ...datePatch,
        userId: renterId,
      });
      // Date corrections also land on the freshly re-picked pending records.
      if (Object.keys(datePatch).length > 0 && Object.keys(datePatch).some((k) => k !== "pickupAt")) {
        const recPatch = { ...datePatch };
        delete (recPatch as any).pickupAt;
        for (const r of pkgRentals) {
          if (r.status === "pending") await touchPatch(ctx, r._id, recPatch);
        }
      }
      for (const { partId, groupId } of chosen) {
        const part = await ctx.db.get(partId);
        if (!part) continue;
      await ctx.db.insert("rentals", {
        partId,
        userId: renterId,
        packageId,
        status: "pending",
        requestedAt: now,
        note: noteForUnit(groupId),
        rentBroken: part.status === "broken" ? true : undefined,
        updatedAt: now,
      });
        await touchPatch(ctx, partId, { status: "pending" });
      }
      await telegramGroup(
        ctx,
        `✏️ ${admin.name ?? admin.email} edited the pending package request of ${member?.name ?? member?.email ?? "a member"} (${cleanLines.length} item(s)).`,
        undefined,
        "requests",
      );
      return { ok: true as const, changed: "pending" as const };
    }

    // ===== Approved package: surgical add/remove diff =====
    // Units the admin must not touch through a lines edit: live or processed.
    const IMMUTABLE = new Set(["active", "on_project", "returned", "denied", "canceled"]);

    // 1. Validate every line (lendable + enough shelf stock) BEFORE touching data.
    for (const line of cleanLines) {
      if (line.count < 1) throw new ConvexError("Each line needs at least 1 unit");
      if (line.count > MAX_UNITS_PER_LINE) throw new ConvexError(`Max ${MAX_UNITS_PER_LINE} units per item`);
      const group = await ctx.db.get(line.groupId);
      await assertGroupLendable(ctx, line.groupId);
      if (!group || group.deleted) throw new ConvexError(`"${group?.name ?? "item"}" no longer exists`);
    }

    // 2. Remove exactly the units the admin un-tagged in the editor (only
    // pending/approved records — anything else is refused).
    const removedIds = new Set<string>();
    for (const rentalId of removeRentalIds ?? []) {
      const r = pkgRentals.find((x) => x._id === rentalId);
      if (!r) throw new ConvexError("That unit is not part of this package");
      if (r.status !== "pending" && r.status !== "approved") {
        throw new ConvexError(
          "Units already handed out or processed cannot be removed by a package edit — edit those records per unit instead",
        );
      }
      const part = await ctx.db.get(r.partId);
      if (part && part.status === "pending") await touchPatch(ctx, part._id, { status: "available" });
      await ctx.db.delete(r._id);
      await recordTombstone(ctx, "rentals", String(r._id));
      removedIds.add(r._id);
    }

    const releaseable = pkgRentals.filter(
      (r) => !removedIds.has(r._id) && (r.status === "pending" || r.status === "approved"),
    );

    // 3. Plan adds: wanted minus (locked + still-held) units per group. Bulk
    // lines skip unit accounting entirely — their amount is adjusted in
    // place (kept records are never canceled in an approved edit).
    const keepCountByGroup = new Map<Id<"groups">, number>();
    for (const r of releaseable) {
      const part = await ctx.db.get(r.partId);
      if (!part) continue;
      keepCountByGroup.set(part.groupId, (keepCountByGroup.get(part.groupId) ?? 0) + 1);
    }
    const lockedByGroup = new Map<Id<"groups">, number>();
    for (const r of pkgRentals) {
      if (removedIds.has(r._id) || !IMMUTABLE.has(r.status)) continue;
      const part = await ctx.db.get(r.partId);
      if (!part) continue;
      lockedByGroup.set(part.groupId, (lockedByGroup.get(part.groupId) ?? 0) + 1);
    }
    const adds: { groupId: Id<"groups">; wanted: number }[] = [];
    const approvedBulkAmounts = new Map<Id<"groups">, number>();
    for (const line of cleanLines) {
      if (bulkGroupIds.has(line.groupId)) {
        const amount = roundBulk(line.count);
        const group = await ctx.db.get(line.groupId);
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q) => q.eq("groupId", line.groupId))
            .filter((q) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? group?.measureLowAt ?? 0),
          })),
          amount,
        );
        if (!plan.ok) throw new ConvexError(`${group?.name ?? "item"}: ${plan.error}`);
        approvedBulkAmounts.set(line.groupId, amount);
        continue;
      }
      const locked = lockedByGroup.get(line.groupId) ?? 0;
      const keep = keepCountByGroup.get(line.groupId) ?? 0;
      // A package edit can add units or release spare ones — it can never pull
      // a line below the units already handed out or processed (those live
      // records are managed per unit, via the per-unit record editor).
      if (locked > line.count) {
        const group = await ctx.db.get(line.groupId);
        throw new ConvexError(
          `"${group?.name ?? "item"}" has ${locked} unit(s) already handed out or processed — a package edit cannot remove live units (edit those records per unit instead).`,
        );
      }
      const needed = line.count - locked;
      if (keep < needed) adds.push({ groupId: line.groupId, wanted: needed - keep });
    }

    // 4. Claim fresh shelf units for the adds (broken units are never silently included).
    const claimed: { partId: Id<"parts">; groupId: Id<"groups"> }[] = [];
    for (const add of adds) {
      const candidates = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", add.groupId))
        .filter((q) => q.neq(q.field("deleted"), true))
        .collect();
      const free = candidates.filter((p) => p.status === "available");
      if (free.length < add.wanted) {
        const group = await ctx.db.get(add.groupId);
        throw new ConvexError(`Not enough free units of ${group?.name ?? "item"}: need ${add.wanted} more, only ${free.length} available`);
      }
      for (const part of free.slice(0, add.wanted)) claimed.push({ partId: part._id, groupId: add.groupId });
    }

    // 5. Release surplus held units (oldest first) — only pending/approved.
    const keepTargetByGroup = new Map<Id<"groups">, number>();
    for (const line of cleanLines) {
      const locked = lockedByGroup.get(line.groupId) ?? 0;
      keepTargetByGroup.set(line.groupId, Math.max(0, line.count - locked));
    }
    const released: string[] = [];
    const byGroup = new Map<Id<"groups">, typeof releaseable>();
    for (const r of releaseable) {
      const part = await ctx.db.get(r.partId);
      if (!part) continue;
      const list = byGroup.get(part.groupId) ?? [];
      list.push(r);
      byGroup.set(part.groupId, list);
    }
    for (const [groupId, held] of byGroup) {
      const target = keepTargetByGroup.get(groupId) ?? 0;
      // Oldest first, so the newest reservations are the ones released.
      const sorted = held.sort((a, b) => a.requestedAt - b.requestedAt);
      for (let i = 0; i < sorted.length - target; i++) {
        const r = sorted[i];
        const part = await ctx.db.get(r.partId);
        if (part && part.status === "pending") await touchPatch(ctx, part._id, { status: "available" });
        // Pending units go back to the shelf; approved ones were reserved for
        // this bundle only. Either way the record is deleted so the package
        // row matches the new lines exactly.
        await ctx.db.delete(r._id);
        await recordTombstone(ctx, "rentals", String(r._id));
        released.push(r._id);
      }
    }

    // Bulk lines: upsert the requested amount on the group's pending/approved
    // BULK record (create one when the line was just added).
    for (const [groupId, amount] of approvedBulkAmounts) {
      const holder = await ensureBulkPart(ctx, groupId);
      const existing = pkgRentals.find(
        (r) =>
          !removedIds.has(r._id) &&
          !released.includes(r._id) &&
          r.partId === holder._id &&
          (r.status === "pending" || r.status === "approved"),
      );
      if (existing) {
        await touchPatch(ctx, existing._id, { amount, note: noteForUnit(groupId) });
      } else {
        await ctx.db.insert("rentals", {
          partId: holder._id,
          userId: renterId,
          packageId,
          status: "approved",
          requestedAt: pkg.requestedAt,
          decidedAt: now,
          amount,
          pickupAt: pickupAt === undefined ? pkg.pickupAt : (pickupAt ?? undefined),
          updatedAt: now,
          note: noteForUnit(groupId),
        });
      }
    }

    // Date corrections — cascade to every rental record of the bundle and
    // the held UNITS (rentedAt/dueAt live on parts), so the whole bundle
    // shows exactly the dates the admin set.
    if (Object.keys(datePatch).length > 0) {
      for (const r of pkgRentals) {
        if (removedIds.has(r._id) || released.includes(r._id)) continue;
        await touchPatch(ctx, r._id, datePatch);
        const part = r.partId ? await ctx.db.get(r.partId) : null;
        if (part) {
          // The physical unit carries the lend window while it is out.
          const unitPatch: Record<string, unknown> = {};
          if (dueAt !== undefined) unitPatch.dueAt = dueAt || undefined;
          if (pickedUpAt !== undefined && part.status === "rented") {
            unitPatch.rentedAt = pickedUpAt || undefined;
          }
          if (Object.keys(unitPatch).length > 0) await touchPatch(ctx, part._id, unitPatch);
        }
      }
    }

    // Notes/details sync — the package note lands on every live unit record
    // (processed ones keep their historical note for the record).
    if (note !== undefined) {
      const pkgNote = note?.trim() || undefined;
      const LIVE = new Set(["pending", "approved", "active", "on_project"]);
      for (const r of pkgRentals) {
        if (removedIds.has(r._id) || released.includes(r._id)) continue;
        if (!LIVE.has(r.status)) continue;
        await touchPatch(ctx, r._id, { note: pkgNote });
      }
    }

    // Renter change: move every surviving record of the bundle to the new
    // member and keep held units' holder pointers in sync.
    if (renterId !== pkg.userId) {
      for (const r of pkgRentals) {
        if (removedIds.has(r._id) || released.includes(r._id)) continue;
        await touchPatch(ctx, r._id, { userId: renterId as any });
        const part = r.partId ? await ctx.db.get(r.partId) : null;
        if (part && part.status === "rented") {
          await touchPatch(ctx, part._id, { currentHolderId: renterId as any });
        }
      }
    }

    // 6. Insert the new approved rentals for added units.
    for (const { partId } of claimed) {
      const part = await ctx.db.get(partId);
      if (!part) continue;
      await ctx.db.insert("rentals", {
        partId,
        userId: renterId,
        packageId,
        status: "approved",
        requestedAt: pkg.requestedAt,
        decidedAt: now,
        pickupAt: pickupAt === undefined ? pkg.pickupAt : (pickupAt ?? undefined),
        updatedAt: now,
      });
      await touchPatch(ctx, partId, { status: "pending" });
    }

    await touchPatch(ctx, packageId, {
      note: note?.trim() || undefined,
      lines: cleanLines,
      pickupAt: pickupAt === undefined ? pkg.pickupAt : (pickupAt ?? undefined),
      userId: renterId,
      // Date corrections must land on the PACKAGE row itself too, or the
      // card and Packages tab keep showing the old dates after an edit.
      ...datePatch,
    });

    const summaryText = await summarize(ctx, cleanLines);
    const bits: string[] = [];
    if (claimed.length) bits.push(`+${claimed.length} unit(s) added`);
    if (released.length) bits.push(`−${released.length} unit(s) released`);
    if (Object.keys(datePatch).length) bits.push("dates corrected");
    if (!bits.length) bits.push("details updated");
    if (member?.telegramChatId || member?.telegramUsername) {
      await telegramDM(
        ctx,
        { name: member?.name ?? member?.email, telegramUsername: member?.telegramUsername, telegramChatId: member?.telegramChatId },
        `✏️ An admin edited your approved package rental (${bits.join(", ")}): ${summaryText}.`,
        { name: admin.name ?? admin.email },
        "rentals",
      );
    }
    await telegramGroup(
      ctx,
      `✏️ ${admin.name ?? admin.email} edited ${member?.name ?? member?.email ?? "a member"}'s approved package (${bits.join(", ")}): ${summaryText}.`,
      undefined,
      "rentals",
    );
    return { ok: true as const, changed: "approved" as const };
  },
});

/** Member cancels their pending package entirely (units go back to available). */
export const cancelPackage = mutation({
  args: { packageId: v.id("rentalPackages") },
  handler: async (ctx, { packageId }) => {
    const user = await requireInteractingMember(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.userId !== user._id) throw new ConvexError("Not your package");
    if (pkg.status !== "pending") throw new ConvexError("Only pending packages can be canceled");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const r of mine.filter((r) => r.packageId === packageId)) {
      const part = await ctx.db.get(r.partId);
      if (part && part.status === "pending") await touchPatch(ctx, part._id, { status: "available" });
      await touchPatch(ctx, r._id, { status: "canceled", decidedAt: Date.now() });
    }
    await touchPatch(ctx, packageId, { status: "canceled", decidedAt: Date.now() });
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
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.status !== "pending") throw new ConvexError("This package was already handled");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const pkgRentals = mine.filter((r) => r.packageId === packageId);
    const member = await ctx.db.get(pkg.userId);
    const memberRef = { name: member?.name ?? member?.email, telegramUsername: member?.telegramUsername, telegramChatId: member?.telegramChatId };
    const now = Date.now();

    if (approve) {
      await touchPatch(ctx, packageId, { status: "approved", decidedAt: now, pickupAt });
      for (const r of pkgRentals) {
        // Units stay reserved: rental -> "approved" (awaiting pick-up), the
        // part keeps its open request; inventory decrements only at the
        // physical hand-over (mark_taken) — same stages as single rentals.
        await touchPatch(ctx, r._id, { status: "approved", decidedAt: now, pickupAt });
      }
    } else {
      await touchPatch(ctx, packageId, { status: "canceled", decidedAt: now });
      for (const r of pkgRentals) {
        const part = await ctx.db.get(r.partId);
        await touchPatch(ctx, r._id, { status: "denied", decidedAt: now });
        if (part && part.status === "pending") await touchPatch(ctx, part._id, { status: "available" });
      }
    }

    const summaryText = await summarize(ctx, pkg.lines);
    const pickupLabel = pickupAt
      ? new Date(pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
      : "as soon as the lab is open";

    if (approve) {
      // Bulk lines: stock may have drifted since the request — re-check that
      // a feasible per-unit split still exists before saying yes (same rule
      // as single bulk approvals).
      for (const line of pkg.lines) {
        const g = await ctx.db.get(line.groupId);
        if (!g || (g.measure !== "weight" && g.measure !== "length")) continue;
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q: any) => q.eq("groupId", g._id))
            .filter((q: any) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p: any) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p: any) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? g.measureLowAt ?? 0),
          })),
          line.count,
        );
        if (!plan.ok) throw new ConvexError(`${g.name}: ${plan.error}`);
      }
    }

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

/**
 * Hand over a WHOLE approved package in one step — the bundle-level twin of
 * adminRentalAction("mark_taken"). Every still-approved unit of the package
 * becomes "active" with the holder set and stock deducted; units already
 * picked up (or returned early) are left untouched, so the action is safely
 * repeatable. The member and the club group get one summary message.
 */
export const markPackageTaken = mutation({
  args: { packageId: v.id("rentalPackages") },
  handler: async (ctx, { packageId }) => {
    const admin = await requireAdmin(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.status !== "approved")
      throw new ConvexError("Only approved packages can be marked as picked up");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
      .collect();
    const pkgRentals = mine.filter((r) => r.packageId === packageId);
    if (pkgRentals.length === 0) throw new ConvexError("This package has no unit records");
    const now = Date.now();
    const member = await ctx.db.get(pkg.userId);
    const memberRef = {
      name: member?.name ?? member?.email,
      telegramUsername: member?.telegramUsername,
      telegramChatId: member?.telegramChatId,
    };

    let taken = 0;
    const takenLines: string[] = [];
    for (const r of pkgRentals) {
      if (r.status !== "approved") continue; // already picked up / processed
      const part = r.partId ? await ctx.db.get(r.partId) : null;
      if (!part) continue;
      const group = await ctx.db.get(part.groupId);
      const isBulk = group?.measure === "weight" || group?.measure === "length";
      if (isBulk && group) {
        // Same split-across-units logic as single bulk hand-over.
        const amt = r.amount;
        if (amt === undefined || !Number.isFinite(amt) || amt <= 0) {
          throw new ConvexError(
            `Bulk line ${group.name} has no amount — edit the record first`,
          );
        }
        const units = (
          await ctx.db
            .query("parts")
            .withIndex("by_group", (q: any) => q.eq("groupId", group._id))
            .filter((q: any) => q.neq(q.field("deleted"), true))
            .collect()
        ).filter((p: any) => p.status === "available" && p.tag !== "BULK");
        const plan = planMeasureTake(
          units.map((p: any) => ({
            id: p._id,
            remaining: Number(p.amountRemaining ?? 0),
            lowAt: Number(p.lowAt ?? group.measureLowAt ?? 0),
          })),
          amt,
        );
        if (!plan.ok) throw new ConvexError(`${group.name}: ${plan.error}`);
        for (const take of plan.plan) {
          const unit = units.find((p: any) => p._id === take.unitId);
          if (!unit) continue;
          const remaining = Number(unit.amountRemaining ?? 0) - take.amount;
          await touchPatch(ctx, unit._id, {
            amountRemaining: String(Math.max(0, Number(remaining.toFixed(4)))),
            status: take.whole ? "rented" : unit.status,
            currentHolderId: take.whole ? pkg.userId : unit.currentHolderId,
          });
        }
        await touchPatch(ctx, r._id, {
          status: "active",
          pickedUpAt: now,
          decidedAt: r.decidedAt ?? now,
          allocations: plan.plan.map((p) => ({ partId: p.unitId as any, amount: p.amount })),
        });
        const stock = await sumUnitStock(ctx, group._id);
        await touchPatch(ctx, group._id, { measureStock: String(stock) });
      } else {
        await touchPatch(ctx, r._id, { status: "active", pickedUpAt: now });
        await touchPatch(ctx, part._id, {
          status: "rented",
          currentHolderId: pkg.userId,
          rentedAt: now,
          dueAt: undefined,
        });
      }
      taken += 1;
      takenLines.push(`${part.tag} · ${group?.name ?? "item"}`);
    }

    if (taken === 0)
      throw new ConvexError("Every unit was already picked up (or processed)");
    // Bundle-level pick-up date for the package card / console rows.
    await touchPatch(ctx, packageId, { pickedUpAt: now });
    if (member?.telegramChatId || member?.telegramUsername) {
      await telegramDM(
        ctx,
        memberRef,
        `📦 Package picked up: ${taken} unit(s) handed to you. Return them to the lab when done.`,
        { name: admin.name ?? admin.email },
        "rentals",
      );
    }
    await telegramGroup(
      ctx,
      `📦 ${admin.name ?? admin.email} handed over the package of ${member?.name ?? member?.email ?? "a member"} — ${taken} unit(s): ${takenLines.join(", ")}.`,
      undefined,
      "rentals",
    );
    return { ok: true, taken };
  },
});

async function summarize(ctx: any, lines: { groupId: any; count: number }[]) {
  const parts: string[] = [];
  for (const l of lines) {
    const g = await ctx.db.get(l.groupId);
    parts.push(`${formatLineAmount({ count: l.count }, g)} ${g?.name ?? "item"}`);
  }
  return parts.join(", ");
}

/**
 * Bulk (weight/length) groups keep ONE placeholder part row per group, tagged
 * "BULK", that carries the rental ledger for amount-based loans — a bulk take
 * is a reservation of stock, not of a physical unit. Reuses the row that
 * requestBulkRental (single rentals) already created, so both flows share it.
 */
async function ensureBulkPart(ctx: any, groupId: any): Promise<any> {
  let part = await ctx.db
    .query("parts")
    .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
    .filter((q: any) => q.eq(q.field("tag"), "BULK"))
    .first();
  if (!part) {
    const partId = await ctx.db.insert("parts", {
      groupId,
      tag: "BULK",
      status: "available",
      note: "Bulk stock holder (weight/length group)",
      updatedAt: Date.now(),
    });
    part = await ctx.db.get(partId);
  }
  return part;
}

/** Member asks to return the whole package (admin then processes units one by
 *  one). Same cooldown rules as single rentals. */
export const requestPackageReturn = mutation({
  args: { packageId: v.id("rentalPackages") },
  handler: async (ctx, { packageId }) => {
    const user = await requireInteractingMember(ctx);
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.userId !== user._id) throw new ConvexError("Not your package");
    const mine = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = mine.filter((r) => r.packageId === packageId && r.status === "active");
    if (!active.length) throw new ConvexError("No active units in this package");
    const cooldownHours = await returnCooldownHours(ctx);
    if (pkg.returnRequestedAt) {
      const elapsedH = (Date.now() - pkg.returnRequestedAt) / 36e5;
      if (elapsedH < cooldownHours) {
        const remaining = Math.ceil(cooldownHours - elapsedH);
        throw new ConvexError(`You already requested a return — ask again in ${remaining}h`);
      }
    }
    await touchPatch(ctx, packageId, { returnRequestedAt: Date.now() });
    for (const r of active) await touchPatch(ctx, r._id, { returnRequestedAt: Date.now() });
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
    if (!user) throw new ConvexError("No user found with that email — they must sign in once first");
    await touchPatch(ctx, user._id, { role });
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
        await touchPatch(ctx, r._id, { pickupRemindedDay: true });
        await dm(
          `⏰ Reminder: pick up ${group?.name ?? "your part"} (${part?.tag ?? "?"}) tomorrow — ${when}.`,
        );
      }
      if (untilMs <= 61 * 60_000 && untilMs > 45 * 60_000 && !r.pickupRemindedHour) {
        await touchPatch(ctx, r._id, { pickupRemindedHour: true });
        await dm(
          `⏰ Pick-up in ~1 hour: ${group?.name ?? "your part"} (${part?.tag ?? "?"}) at ${when}. See you at the lab!`,
        );
      }
    }
    return { sent };
  },
});

// ===== Admin rental-record maintenance ================================

/**
 * Admin edit of a rental RECORD (especially the dates): requestedAt,
 * decidedAt, pickedUpAt, returnedAt, dueAt and pickupAt can all be corrected.
 * null clears a date; omit to keep. A rented unit's lend dates stay in sync.
 */
export const updateRentalRecord = mutation({
  args: {
    rentalId: v.id("rentals"),
    requestedAt: v.optional(v.union(v.number(), v.null())),
    decidedAt: v.optional(v.union(v.number(), v.null())),
    pickedUpAt: v.optional(v.union(v.number(), v.null())),
    returnedAt: v.optional(v.union(v.number(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
    pickupAt: v.optional(v.union(v.number(), v.null())),
    conditionReport: v.optional(v.string()),
    // Re-assign the record to a different member (admin correction).
    userId: v.optional(v.id("users")),
    // Move the record across statuses (e.g. fix a wrongly-marked return).
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("active"),
        v.literal("on_project"),
        v.literal("returned"),
        v.literal("denied"),
        v.literal("canceled"),
      ),
    ),
  },
  handler: async (
    ctx,
    { rentalId, requestedAt, decidedAt, pickedUpAt, returnedAt, dueAt, pickupAt, conditionReport, status, userId },
  ) => {
    await requireAdmin(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new ConvexError("Rental not found");
    const patch: Record<string, unknown> = {};
    if (requestedAt !== undefined) patch.requestedAt = requestedAt || undefined;
    if (decidedAt !== undefined) patch.decidedAt = decidedAt || undefined;
    if (pickedUpAt !== undefined) patch.pickedUpAt = pickedUpAt || undefined;
    if (returnedAt !== undefined) patch.returnedAt = returnedAt || undefined;
    if (dueAt !== undefined) patch.dueAt = dueAt || undefined;
    if (pickupAt !== undefined) patch.pickupAt = pickupAt || undefined;
    if (conditionReport !== undefined) patch.conditionReport = conditionReport.trim() || undefined;
    if (status !== undefined) patch.status = status;
    // Renter change: verify the target member exists, and keep the unit's
    // holder pointers in sync (part.currentHolderId / project membership).
    if (userId !== undefined && userId !== rental.userId) {
      const newHolder = await ctx.db.get(userId);
      if (!newHolder) throw new ConvexError("New renter not found");
      patch.userId = userId;
    }
    await touchPatch(ctx, rentalId, patch);

    // Keep a rented unit's lend dates (shown on cards + dashboards) in sync.
    const part = rental.partId ? await ctx.db.get(rental.partId) : null;
    if (part) {
      if (patch.userId) {
        // The unit follows its record's holder while it is out.
        await touchPatch(ctx, part._id, {
          currentHolderId: patch.userId as any,
        });
      }
      if (dueAt !== undefined || pickedUpAt !== undefined) {
        await touchPatch(ctx, part._id, {
          ...(dueAt !== undefined ? { dueAt: dueAt || undefined } : {}),
          ...(pickedUpAt !== undefined && part.status === "rented"
            ? { rentedAt: pickedUpAt || undefined }
            : {}),
        });
      }
      // Returning/canceling an active record via the editor releases the unit.
      if ((status === "returned" || status === "canceled") && part.status === "rented") {
        await touchPatch(ctx, part._id, {
          status: "available",
          currentHolderId: undefined,
          rentedAt: undefined,
          dueAt: undefined,
        });
      }
    }
    return { ok: true };
  },
});

/**
 * Admin delete of a rental RECORD — a hard ledger correction for duplicates
 * or mistakes. Never silently deletes a record that still holds a unit
 * (rented / on project / pending) unless `alsoFreePart` releases it.
 */
export const deleteRentalRecord = mutation({
  args: {
    rentalId: v.id("rentals"),
    alsoFreePart: v.optional(v.boolean()),
  },
  handler: async (ctx, { rentalId, alsoFreePart }) => {
    await requireAdmin(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) return { ok: true };
    const part = rental.partId ? await ctx.db.get(rental.partId) : null;
    if (part) {
      const holdsUnit =
        part.status === "rented" ||
        part.status === "on_project" ||
        (part.status === "pending" && rental.status === "pending");
      if (holdsUnit && !alsoFreePart) {
        // Typed data payload so the client can offer the release option
        // instead of showing a dead-end server error.
        throw new ConvexError({
          code: "RENTAL_HOLDING_UNIT",
          partStatus: part.status,
          message: `This record still holds its unit \u2014 the unit is currently "${part.status}". Process a return first, or tick "Also release the unit".`,
        });
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
    }
    await ctx.db.delete(rentalId);
    await recordTombstone(ctx, "rentals", String(rentalId));
    // Ghost sweep: deleting the last unit record of a package leaves an
    // empty package row that can never be edited or returned — remove it so
    // the Packages tab has no un-deletable husks.
    if (rental.packageId) {
      const pkg = await ctx.db.get(rental.packageId);
      if (pkg) {
        const left = (
          await ctx.db
            .query("rentals")
            .withIndex("by_user", (q) => q.eq("userId", pkg.userId))
            .collect()
        ).filter((x) => x.packageId === rental.packageId);
        if (left.length === 0) {
          await ctx.db.delete(rental.packageId);
          await recordTombstone(ctx, "rentalPackages", String(rental.packageId));
        }
      }
    }
    return { ok: true };
  },
});
