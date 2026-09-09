import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib";
import { emailInAdminList } from "./adminConfig";

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
  },
  handler: async (ctx, { userId, role, clubRoles, academicState, major }) => {
    await requireAdmin(ctx);
    const patch: Record<string, unknown> = {};
    if (role) patch.role = role;
    if (clubRoles !== undefined) patch.clubRoles = clubRoles;
    if (academicState !== undefined) patch.academicState = academicState;
    if (major !== undefined) patch.major = major;
    await ctx.db.patch(userId, patch);
  },
});
