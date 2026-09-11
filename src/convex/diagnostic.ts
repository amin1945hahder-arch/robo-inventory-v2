// ⚠️ TEMPORARY DIAGNOSTIC — DELETE AFTER USE ⚠️
// Confirms whether large base64 profile images on user docs are what blows the
// 16MB read limit in listAllRentals (which re-reads a user doc per rental row).
import { v } from "convex/values";
import { query } from "./_generated/server";

export const probe = query({
  args: { which: v.string() },
  handler: async (ctx, { which }) => {
    if (which === "userImageSizes") {
      const users = await ctx.db.query("users").collect();
      const sized = users
        .map((u) => ({ id: u._id, name: u.name ?? u.email, imageBytes: u.image?.length ?? 0 }))
        .sort((a, b) => b.imageBytes - a.imageBytes)
        .slice(0, 10);
      const total = users.reduce((n, u) => n + (u.image?.length ?? 0), 0);
      return { totalImageBytes: total, userCount: users.length, top: sized };
    }
    if (which === "cachedListAllRentals") {
      // Proposed fix: lazy-cache every joined doc so each is read once.
      const rows = await ctx.db.query("rentals").collect();
      const partCache = new Map<string, any>();
      const groupCache = new Map<string, any>();
      const userCache = new Map<string, any>();
      for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
        const part =
          partCache.get(r.partId) ?? (partCache.set(r.partId, await ctx.db.get(r.partId)), partCache.get(r.partId));
        const group = part
          ? groupCache.get(part.groupId) ??
            (groupCache.set(part.groupId, await ctx.db.get(part.groupId)), groupCache.get(part.groupId))
          : null;
        const user =
          userCache.get(r.userId) ?? (userCache.set(r.userId, await ctx.db.get(r.userId)), userCache.get(r.userId));
        void group;
        void user;
      }
      return { ok: true, n: rows.length };
    }
    return { ok: false, error: `unknown probe: ${which}` };
  },
});
