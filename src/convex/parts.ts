import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";
import { Id } from "./_generated/dataModel";

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

export const getPart = query({
  args: { id: v.id("parts") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db.get(id);
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
  },
  handler: async (ctx, { id, tag, status, note }) => {
    await requireAdmin(ctx);
    const patch: Record<string, unknown> = {};
    if (tag !== undefined) patch.tag = tag.trim().toUpperCase();
    if (status !== undefined) patch.status = status;
    if (note !== undefined) patch.note = note.trim();
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

export const requestRental = mutation({
  args: {
    partId: v.id("parts"),
    groupId: v.id("groups"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { partId, groupId, note }) => {
    const user = await requireUser(ctx);
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
    await notifyAdmin(
      ctx,
      `${user.name ?? user.email ?? "A member"} requested to rent ${group?.name ?? "a part"} (${part.tag})`,
      `/admin/requests`,
    );
    return rentalId;
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
    await requireAdmin(ctx);
    const rental = await ctx.db.get(rentalId);
    if (!rental) throw new Error("Rental not found");
    const part = await ctx.db.get(rental.partId);
    if (!part) throw new Error("Part no longer exists");
    const now = Date.now();

    if (action === "approve") {
      if (rental.status !== "pending") throw new Error("This request was already handled");
      await ctx.db.patch(rentalId, { status: "active", decidedAt: now, pickedUpAt: now });
      await ctx.db.patch(part._id, { status: "rented", currentHolderId: rental.userId });
    } else if (action === "deny") {
      if (rental.status !== "pending") throw new Error("This request was already handled");
      await ctx.db.patch(rentalId, { status: "denied", decidedAt: now });
      if (part.status === "pending") await ctx.db.patch(part._id, { status: "available" });
    } else if (action === "mark_returned") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      await ctx.db.patch(rentalId, {
        status: "returned",
        returnedAt: now,
        returnDestination: "shelf",
        functional,
        conditionReport: conditionReport?.trim(),
      });
      if (functional === false) {
        await ctx.db.patch(part._id, { status: "broken", currentHolderId: undefined });
      } else {
        await ctx.db.patch(part._id, { status: "available", currentHolderId: undefined });
      }
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
      });
      await ctx.db.patch(part._id, { status: "on_project", currentProjectId: projectId, currentHolderId: undefined });
    } else if (action === "mark_broken") {
      if (rental.status !== "active") throw new Error("Rental is not active");
      await ctx.db.patch(rentalId, { status: "returned", returnedAt: now, returnDestination: "shelf", functional: false, conditionReport: conditionReport?.trim() });
      await ctx.db.patch(part._id, { status: "broken", currentHolderId: undefined });
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
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await ctx.db.get(r.partId);
      const group = part ? await ctx.db.get(part.groupId) : null;
      out.push({ rental: r, part, group });
    }
    return out;
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
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await ctx.db.get(r.partId);
      const group = part ? await ctx.db.get(part.groupId) : null;
      const student = await ctx.db.get(r.userId);
      out.push({
        rental: r,
        part,
        group,
        student: student
          ? { _id: student._id, name: student.name, email: student.email, studentId: student.studentId }
          : null,
      });
    }
    return out;
  },
});

export const cancelMyRequest = mutation({
  args: { rentalId: v.id("rentals") },
  handler: async (ctx, { rentalId }) => {
    const user = await requireUser(ctx);
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
