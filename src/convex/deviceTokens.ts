import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/** SHA-256 hex digest (WebCrypto — available in the Convex runtime). */
async function sha256Hex(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Called by the client right after a successful email-code sign-in: issues a
 * fresh device token bound to the signed-in user. The raw token is returned
 * once and stored only in this device's localStorage (the database keeps the
 * hash only).
 */
export const issueDeviceToken = mutation({
  args: { deviceName: v.optional(v.string()) },
  handler: async (ctx, { deviceName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first");
    // 32 random bytes → 64 hex chars.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const raw = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const existing = await ctx.db
      .query("deviceTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Cap at 8 trusted devices per account; drop the oldest when full.
    if (existing.length >= 8) {
      const oldest = existing.sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) await ctx.db.delete(oldest._id);
    }
    await ctx.db.insert("deviceTokens", {
      userId,
      tokenHash: await sha256Hex(raw),
      deviceName: deviceName ?? undefined,
      createdAt: Date.now(),
    });
    return { token: raw };
  },
});

/**
 * Saved-account chip on the auth page: for the stored device token the page
 * asks "who is this?" and gets back just a display profile if the token is
 * still valid — enough to render "Continue as Amin".
 */
export const whoAmIToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await sha256Hex(token);
    const row = await ctx.db
      .query("deviceTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!row) return null;
    const user = await ctx.db.get(row.userId);
    if (!user) return null;
    return {
      name: user.name ?? user.email ?? "Member",
      email: user.email ?? "",
      image: user.image ?? undefined,
      role: user.role ?? undefined,
    };
  },
});

/** Forget this device (removes the saved quick sign-in for the signed-in user). */
export const revokeMyDeviceTokens = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { removed: 0 };
    const rows = await ctx.db
      .query("deviceTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { removed: rows.length };
  },
});
