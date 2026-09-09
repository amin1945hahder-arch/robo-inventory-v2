import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";

// ===== Admin notifications =====

export const listNotifications = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("notifications").collect();
    return rows.sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0)).slice(0, 50);
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("notifications")
      .filter((q) => q.neq(q.field("read"), true))
      .collect();
    for (const r of rows) await ctx.db.patch(r._id, { read: true });
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("notifications")
      .filter((q) => q.neq(q.field("read"), true))
      .collect();
    return rows.length;
  },
});

// ===== Profile update requests (all edits except image require admin approval) =====

export const requestProfileChange = mutation({
  args: {
    name: v.optional(v.string()),
    studentId: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, { name, studentId, phone }) => {
    const user = await requireUser(ctx);
    const current = { name: user.name, studentId: user.studentId, phone: user.phone };
    const payload: { name?: string; studentId?: string; phone?: string } = {};
    if (name !== undefined && name.trim() !== (current.name ?? "")) payload.name = name.trim();
    if (studentId !== undefined && studentId.trim() !== (current.studentId ?? "")) payload.studentId = studentId.trim();
    if (phone !== undefined && phone.trim() !== (current.phone ?? "")) payload.phone = phone.trim();
    if (Object.keys(payload).length === 0) {
      throw new Error("Nothing to change");
    }
    const pending = await ctx.db
      .query("profileRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (pending.some((p) => p.userId === user._id)) {
      throw new Error("You already have a pending profile change awaiting approval");
    }
    await ctx.db.insert("profileRequests", {
      userId: user._id,
      payload,
      status: "pending",
      requestedAt: Date.now(),
    });
  },
});

export const listProfileRequests = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"))) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    let rows;
    if (status) {
      rows = await ctx.db.query("profileRequests").withIndex("by_status", (q) => q.eq("status", status)).collect();
    } else {
      rows = await ctx.db.query("profileRequests").collect();
    }
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const user = await ctx.db.get(r.userId);
      out.push({
        request: r,
        user: user ? { name: user.name, email: user.email, studentId: user.studentId, phone: user.phone } : null,
      });
    }
    return out;
  },
});

export const decideProfileRequest = mutation({
  args: { id: v.id("profileRequests"), approve: v.boolean() },
  handler: async (ctx, { id, approve }) => {
    await requireAdmin(ctx);
    const req = await ctx.db.get(id);
    if (!req || req.status !== "pending") throw new Error("Request not found or already handled");
    if (approve) {
      await ctx.db.patch(req.userId, { ...req.payload });
    }
    await ctx.db.patch(id, { status: approve ? "approved" : "denied", decidedAt: Date.now() });
  },
});

// The signed-in member's own pending profile-change request (if any).
export const myPendingProfileRequest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("profileRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return rows.some((r) => r.userId === user._id);
  },
});

// ===== Account =====

export const updateImage = mutation({
  args: { image: v.string() },
  handler: async (ctx, { image }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { image });
  },
});

export const listPeople = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    const rentals = await ctx.db.query("rentals").collect();
    return users
      .map((u) => ({
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          image: u.image,
          role: u.role,
          studentId: u.studentId,
          phone: u.phone,
          clubRoles: u.clubRoles,
          academicState: u.academicState,
          major: u.major,
        },
        activeRentals: rentals.filter((r) => r.userId === u._id && (r.status === "active" || r.status === "on_project")).length,
        pending: rentals.filter((r) => r.userId === u._id && r.status === "pending").length,
      }))
      .sort((a, b) => (a.user.name ?? "").localeCompare(b.user.name ?? ""));
  },
});
