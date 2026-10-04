import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin, requireUser, safeImage } from "./lib";
import { recordTombstone } from "./sync";
import { telegramDM } from "./notify";

// ===== Admin notifications =====

export const listNotifications = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Only the newest 50 are ever rendered. The default scan is ordered by
    // _creationTime, so read the tail without collecting the whole (growing)
    // feed into memory first.
    return ctx.db.query("notifications").order("desc").take(50);
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // The feed only ever renders the newest 50 (listNotifications.take(50))
    // and unreadCount counts inside that same window — so bound this scan
    // instead of collecting the whole (unbounded, forever-growing) table on
    // every "mark all read".
    const rows = await ctx.db.query("notifications").order("desc").take(200);
    for (const r of rows) if (r.read !== true) await ctx.db.patch(r._id, { read: true });
  },
});

/** Wipe the whole admin notification history (the in-app feed). */
export const clearAllNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("notifications").collect();
    for (const r of rows) {
      await ctx.db.delete(r._id);
      await recordTombstone(ctx, "notifications", r._id);
    }
    return { ok: true, cleared: rows.length };
  },
});

// Mark a single notification as read (tap a row in the Requests console — the
// unread bubble decreases immediately without a reload).
export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (row && row.read !== true) await ctx.db.patch(id, { read: true });
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Count inside the same 50-row window the feed renders: rows older than
    // that are invisible, so a whole-table scan only bought a bigger number
    // — re-run on EVERY notification write, forever.
    const rows = await ctx.db.query("notifications").order("desc").take(50);
    return rows.filter((r) => r.read !== true).length;
  },
});

// ===== Profile update requests (all edits except image require admin approval) =====

export const requestProfileChange = mutation({
  args: {
    name: v.optional(v.string()),
    studentId: v.optional(v.string()),
    phone: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
  },
  handler: async (ctx, { name, studentId, phone, dateOfBirth, githubUrl }) => {
    const user = await requireUser(ctx);
    const current = {
      name: user.name,
      studentId: user.studentId,
      phone: user.phone,
      dateOfBirth: user.dateOfBirth,
      githubUrl: user.githubUrl,
    };
    const payload: {
      name?: string;
      studentId?: string;
      phone?: string;
      dateOfBirth?: string;
      githubUrl?: string;
    } = {};
    if (name !== undefined && name.trim() !== (current.name ?? "")) payload.name = name.trim();
    if (studentId !== undefined && studentId.trim() !== (current.studentId ?? "")) payload.studentId = studentId.trim();
    if (phone !== undefined && phone.trim() !== (current.phone ?? "")) payload.phone = phone.trim();
    if (dateOfBirth !== undefined && dateOfBirth.trim() !== (current.dateOfBirth ?? "")) {
      if (dateOfBirth.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) {
        throw new ConvexError("Date of birth must be in YYYY-MM-DD format");
      }
      payload.dateOfBirth = dateOfBirth.trim() || undefined;
    }
    if (githubUrl !== undefined && githubUrl.trim() !== (current.githubUrl ?? "")) {
      const gh = githubUrl.trim();
      if (gh && !/^https:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/.test(gh)) {
        throw new ConvexError("GitHub must be a profile link like https://github.com/username");
      }
      payload.githubUrl = gh || undefined;
    }
    if (Object.keys(payload).length === 0) {
      throw new ConvexError("Nothing to change");
    }
    const pending = await ctx.db
      .query("profileRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (pending.some((p) => p.userId === user._id)) {
      throw new ConvexError("You already have a pending profile change awaiting approval");
    }
    await ctx.db.insert("profileRequests", {
      userId: user._id,
      payload,
      status: "pending",
      requestedAt: Date.now(),
    });
    // Surface it EVERYWHERE an admin looks: the bell feed (notifications)
    // and the OS-level push — same as every other request type.
    const fields = Object.keys(payload).join(", ");
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "profile_request",
      text: `${user.name ?? user.email ?? "A member"} requested a profile change (${fields})`,
      link: "/admin/requests?tab=profiles",
    });
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New profile request",
      body: `${user.name ?? user.email ?? "A member"} requested a profile change`,
      tag: "roboshelf-profile",
      url: "/admin/requests?tab=profiles",
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
        user: user
          ? {
              _id: user._id,
              name: user.name,
              email: user.email,
              image: safeImage(user.image),
              role: user.role,
              studentId: user.studentId,
              phone: user.phone,
              telegramUsername: user.telegramUsername,
            }
          : null,
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
    if (!req || req.status !== "pending") throw new ConvexError("Request not found or already handled");
    if (approve) {
      await ctx.db.patch(req.userId, { ...req.payload });
    }
    await ctx.db.patch(id, { status: approve ? "approved" : "denied", decidedAt: Date.now() });
    // The MEMBER hears back too: Telegram DM (bot) + a real push on their
    // devices — approval and rejection both notify the requester.
    const member = await ctx.db.get(req.userId);
    const who = member?.name ?? member?.email ?? "Member";
    if (member) {
      await telegramDM(
        ctx,
        { name: member.name, telegramUsername: member.telegramUsername, telegramChatId: member.telegramChatId },
        approve
          ? `✅ Your profile change was applied — it is live now.`
          : `ℹ️ Your profile change was not approved this time. An admin can tell you why.`,
        { name: member.name },
        "members",
      );
      await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
        userId: req.userId,
        title: approve ? "Profile updated ✅" : "Profile request reviewed",
        body: approve
          ? `${who}, your changes are live now.`
          : `${who}, your profile request was not approved.`,
        tag: "roboshelf-profile",
        url: "/profile",
      });
    }
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

export const listPeople = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    // Count LIVE rentals per member via the status index instead of collecting
    // the entire (unbounded, historical) rentals table. Only pending/active/
    // on_project rows matter for these two badges.
    const byUser = new Map<string, { active: number; pending: number }>();
    const bump = (userId: string, key: "active" | "pending") => {
      const e = byUser.get(userId) ?? { active: 0, pending: 0 };
      e[key] += 1;
      byUser.set(userId, e);
    };
    const pendingRows = await ctx.db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    for (const r of pendingRows) bump(r.userId, "pending");
    for (const status of ["active", "on_project"] as const) {
      const rows = await ctx.db
        .query("rentals")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const r of rows) bump(r.userId, "active");
    }
    return users
      .map((u) => ({
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          image: safeImage(u.image),
          role: u.role,
          studentId: u.studentId,
          phone: u.phone,
          clubRoles: u.clubRoles,
          academicState: u.academicState,
          major: u.major,
          studentCode: u.studentCode,
          dateOfBirth: u.dateOfBirth,
          githubUrl: u.githubUrl,
          telegramChatId: u.telegramChatId,
          telegramUsername: u.telegramUsername,
          membershipStatus: u.membershipStatus,
          profileApproved: u.profileApproved,
          printerRole: u.printerRole,
        },
        activeRentals: byUser.get(u._id)?.active ?? 0,
        pending: byUser.get(u._id)?.pending ?? 0,
      }))
      .sort((a, b) => (a.user.name ?? "").localeCompare(b.user.name ?? ""));
  },
});
