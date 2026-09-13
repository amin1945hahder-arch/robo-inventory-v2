import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Storage helpers for device quick sign-in tokens. Kept in their own module
 * (referenced as `internal.deviceTokenStore.*`) so the auth provider file can
 * call them via ctx.runQuery without a circular api type.
 */

/** Internal lookup used by the device auth provider (no user session). */
export const findToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    return ctx.db
      .query("deviceTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
  },
});

/** Bump lastUsedAt on successful device sign-ins. */
export const touch = internalMutation({
  args: { id: v.id("deviceTokens") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { lastUsedAt: Date.now() });
  },
});
