import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { requireAdmin, requireNonGuest, requireUser } from "./lib";
import { emailInAdminList } from "./adminConfig";
import { notifyTelegram } from "./notify";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

// Bootstrap A: the first user who signs in with an email on the admin allow-list
// (ADMIN_EMAILS env var, comma-separated) is promoted to admin automatically.
export const claimAdminIfEligible = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { promoted: false };
    const user = await ctx.db.get(userId);
    if (!user || !user.email || user.role === "admin") return { promoted: false };
    if (!emailInAdminList(user.email)) return { promoted: false };
    await ctx.db.patch(userId, { role: "admin" });
    return { promoted: true };
  },
});

// Bootstrap B (no env vars needed): while there are ZERO admins in the system,
// the signed-in caller is promoted to admin. This guarantees the first real
// user (e.g. Dr. Essa) always lands in control, even before ADMIN_EMAILS is set.
export const claimAdminIfNoAdmins = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { promoted: false, reason: "not-signed-in" };
    const user = await ctx.db.get(userId);
    if (!user) return { promoted: false, reason: "no-user" };
    if (user.role === "admin") return { promoted: false, alreadyAdmin: true };
    const all = await ctx.db.query("users").collect();
    if (all.some((u) => u.role === "admin")) {
      return { promoted: false, reason: "admins-exist" };
    }
    await ctx.db.patch(userId, { role: "admin" });
    return { promoted: true };
  },
});

// When the club dataset pre-seeds member profiles (before those people have
// auth accounts), the first time a real person signs in with that email the
// auth layer creates a fresh user row. Merge the seeded profile (name, ids,
// phone, admin role) into the auth account and drop the seeded duplicate.
export const reconcileProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { ok: false, reason: "not-signed-in" };
    const me = await ctx.db.get(userId);
    if (!me?.email) return { ok: false, reason: "no-email" };
    const dup = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", me.email))
      .filter((q) => q.neq(q.field("_id"), userId))
      .first();
    if (!dup) return { ok: false, reason: "no-dup" };
    const patch: Record<string, unknown> = {};
    if (!me.name && dup.name) patch.name = dup.name;
    if (!me.studentId && dup.studentId) patch.studentId = dup.studentId;
    if (!me.phone && dup.phone) patch.phone = dup.phone;
    if (!me.academicState && dup.academicState) patch.academicState = dup.academicState;
    if (!me.major && dup.major) patch.major = dup.major;
    if (!me.clubRoles?.length && dup.clubRoles?.length) patch.clubRoles = dup.clubRoles;
    if (!me.studentCode && dup.studentCode) patch.studentCode = dup.studentCode;
    if (dup.role === "admin" && me.role !== "admin") patch.role = "admin";
    if (Object.keys(patch).length > 0) await ctx.db.patch(userId, patch);
    await ctx.db.delete(dup._id);
    return { ok: true, merged: Object.keys(patch) };
  },
});

// Admin edits a person's club profile: real positions, academic state, major,
// and the app-level role (admin/member).
export const updatePersonProfile = mutation({
  args: {
    userId: v.id("users"),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
    clubRoles: v.optional(v.array(v.string())),
    academicState: v.optional(v.string()),
    major: v.optional(v.string()),
    telegramChatId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, role, clubRoles, academicState, major, telegramChatId }) => {
    await requireAdmin(ctx);
    const patch: Record<string, unknown> = {};
    if (role) patch.role = role;
    if (clubRoles !== undefined) patch.clubRoles = clubRoles;
    if (academicState !== undefined) patch.academicState = academicState;
    if (major !== undefined) patch.major = major;
    if (telegramChatId !== undefined) patch.telegramChatId = telegramChatId.trim() || undefined;
    await ctx.db.patch(userId, patch);
  },
});

// Mark someone as no longer in the club (ex-member). Their history stays;
// they just stop counting as an active member.
export const setMembershipStatus = mutation({
  args: { userId: v.id("users"), status: v.union(v.literal("active"), v.literal("ex")) },
  handler: async (ctx, { userId, status }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(userId, { membershipStatus: status });
  },
});

// Member sets their own Telegram @username so the club bot can tag them in
// the group and DM them. Self-service — no admin needed.
export const setMyTelegramUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await requireNonGuest(ctx);
    const clean = username.trim().replace(/^@/, "");
    await ctx.db.patch(user._id, {
      telegramUsername: clean === "" ? undefined : clean,
    });
  },
});

// Remove a person from the app entirely. Blocked while they still hold parts
// or have pending requests so inventory never loses track of a unit.
export const deletePerson = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireAdmin(ctx);
    if (userId === (await getAuthUserId(ctx))) {
      throw new Error("You cannot delete your own account");
    }
    const person = await ctx.db.get(userId);
    if (!person) return;

    const openRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    if (openRentals.length > 0) {
      throw new Error(
        `${person.name ?? person.email} still holds ${openRentals.length} rented part(s). Process their returns first.`,
      );
    }
    const pendingRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    if (pendingRentals.length > 0) {
      throw new Error("This person still has pending rental requests. Deny them first.");
    }
    const onProject = await ctx.db
      .query("parts")
      .withIndex("by_group")
      .filter((q) => q.eq(q.field("currentHolderId"), userId))
      .collect();
    if (onProject.length > 0) {
      throw new Error("This person still holds parts. Process returns first.");
    }

    // Detach the person from past rental history (keep the rows readable).
    const allRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    void allRentals; // history rows are kept; they render "(removed)" when the user is gone

    await ctx.db.delete(userId);
  },
});

// Internal: the Telegram action fetches a member's delivery targets (name,
// chat id, @username) without exposing them through a public query.
export const getUserForDm = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      name: user.name,
      telegramChatId: user.telegramChatId,
      telegramUsername: user.telegramUsername,
    };
  },
});

// ===== Member rank/position upgrade requests =====

// A member asks the admin for specific club positions (and can add a message).
export const requestRankUpgrade = mutation({
  args: {
    requestedRoles: v.array(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { requestedRoles, message }) => {
    const user = await requireNonGuest(ctx);
    const clean = requestedRoles.map((r) => r.trim()).filter(Boolean);
    if (clean.length === 0) throw new Error("Select at least one position");
    const mine = await ctx.db
      .query("rankRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (mine.some((r) => r.userId === user._id)) {
      throw new Error("You already have a pending rank request");
    }
    await ctx.db.insert("rankRequests", {
      userId: user._id,
      requestedRoles: clean,
      message: message?.trim() || undefined,
      status: "pending",
      requestedAt: Date.now(),
    });
  },
});

// Admin view of all rank requests with the requester joined in.
export const listRankRequests = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"))) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = status
      ? await ctx.db.query("rankRequests").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("rankRequests").collect();
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const user = await ctx.db.get(r.userId);
      out.push({
        request: r,
        user: user
          ? { name: user.name, email: user.email, clubRoles: user.clubRoles, telegramChatId: user.telegramChatId }
          : null,
      });
    }
    return out;
  },
});

// Admin approves (adds the positions to the member) or denies the request.
export const decideRankRequest = mutation({
  args: { id: v.id("rankRequests"), approve: v.boolean() },
  handler: async (ctx, { id, approve }) => {
    await requireAdmin(ctx);
    const req = await ctx.db.get(id);
    if (!req || req.status !== "pending") throw new Error("Request not found or already handled");
    if (approve) {
      const user = await ctx.db.get(req.userId);
      if (user) {
        const merged = [...new Set([...(user.clubRoles ?? []), ...req.requestedRoles])];
        await ctx.db.patch(user._id, { clubRoles: merged });
      }
    }
    await ctx.db.patch(id, { status: approve ? "approved" : "denied", decidedAt: Date.now() });
    const user = await ctx.db.get(req.userId);
    if (user?.telegramChatId) {
      await notifyTelegram(
        ctx,
        approve
          ? `🏅 ${user.name ?? user.email} — your rank request was approved. New positions: ${req.requestedRoles.join(", ")}`
          : `ℹ️ ${user.name ?? user.email} — your rank request (${req.requestedRoles.join(", ")}) was not approved this time.`,
        user.telegramChatId,
      );
    }
  },
});

// The signed-in member's own pending rank request (if any).
export const myPendingRankRequest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("rankRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return rows.some((r) => r.userId === user._id);
  },
});

// ===== Profile approval (new members start view-only) =====

// Member submits their profile data (name + student id or phone) directly.
// Stores it on their user row (not live for interactions until approved) and
// pings the admins. Self-submission is allowed for guests-free real users; the
// profile simply stays locked until an admin approves it.
export const submitMyProfile = mutation({
  args: {
    name: v.string(),
    studentId: v.optional(v.string()),
    phone: v.optional(v.string()),
    telegramUsername: v.optional(v.string()),
  },
  handler: async (ctx, { name, studentId, phone, telegramUsername }) => {
    const user = await requireUser(ctx);
    if (user.isAnonymous) throw new Error("Guests cannot submit a profile — sign in first");
    const cleanName = name.trim();
    if (cleanName.length < 2) throw new Error("Enter your full name");
    if (!studentId?.trim() && !phone?.trim()) {
      throw new Error("Add your student ID or phone so the admin can verify you");
    }
    await ctx.db.patch(user._id, {
      name: cleanName,
      studentId: studentId?.trim() || undefined,
      phone: phone?.trim() || undefined,
      telegramUsername: telegramUsername?.trim().replace(/^@/, "") || user.telegramUsername,
    });
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "profile",
      text: `${cleanName} submitted their profile for approval`,
      link: "/admin/requests",
    });
    return { ok: true };
  },
});

// Admin approves a member's profile: they unlock all member interactions.
export const approveProfile = mutation({
  args: { userId: v.id("users"), approved: v.boolean() },
  handler: async (ctx, { userId, approved }) => {
    const admin = await requireAdmin(ctx);
    const member = await ctx.db.get(userId);
    if (!member) throw new Error("Member not found");
    await ctx.db.patch(userId, { profileApproved: approved });
    await notifyTelegram(
      ctx,
      approved
        ? `✅ ${admin.name ?? admin.email} approved ${member.name ?? member.email ?? "a member"}'s profile — full member access unlocked.`
        : `🔒 ${admin.name ?? admin.email} revoked approval for ${member.name ?? member.email ?? "a member"}'s profile.`,
    );
    return { ok: true };
  },
});

// Who still needs profile approval (People page badge + Requests console).
export const listUnapprovedProfiles = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .filter(
        (u) =>
          !u.isAnonymous &&
          u.profileApproved !== true &&
          (u.name || u.studentId || u.phone),
      )
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        studentId: u.studentId,
        phone: u.phone,
        profileApproved: u.profileApproved,
      }));
  },
});

// Member changes their own profile picture directly (always allowed — it's
// their face; admins can still see change history if ever needed).
export const updateMyImage = mutation({
  args: { image: v.string() },
  handler: async (ctx, { image }) => {
    const user = await requireUser(ctx);
    if (user.isAnonymous) throw new Error("Guests cannot change a profile picture — sign in first");
    if (!image.trim()) throw new Error("Image URL is empty");
    await ctx.db.patch(user._id, { image: image.trim() });
    return { ok: true }; 
  },
});
