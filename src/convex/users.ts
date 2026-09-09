import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
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
