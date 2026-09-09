import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";

// Aggregated stats for inventory dashboard / group cards
export const groupStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const groups = await ctx.db
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const byGroup: Record<string, { total: number; available: number; rented: number; onProject: number; broken: number; pending: number }> = {};
    for (const p of parts) {
      const g = (byGroup[p.groupId] ??= {
        total: 0,
        available: 0,
        rented: 0,
        onProject: 0,
        broken: 0,
        pending: 0,
      });
      g.total += 1;
      if (p.status === "available") g.available += 1;
      else if (p.status === "rented") g.rented += 1;
      else if (p.status === "on_project") g.onProject += 1;
      else if (p.status === "broken") g.broken += 1;
      else if (p.status === "pending") g.pending += 1;
    }
    const out: Record<string, (typeof byGroup)[string]> = {};
    for (const g of groups) {
      out[g._id] = byGroup[g._id] ?? {
        total: 0,
        available: 0,
        rented: 0,
        onProject: 0,
        broken: 0,
        pending: 0,
      };
    }
    return out;
  },
});

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const parts = await ctx.db.query("parts").filter((q) => q.neq(q.field("deleted"), true)).collect();
    const groups = await ctx.db.query("groups").filter((q) => q.neq(q.field("deleted"), true)).collect();
    const projects = await ctx.db
      .query("projects")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    const pending = await ctx.db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const active = await ctx.db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const stats = {
      groups: groups.length,
      units: parts.length,
      available: parts.filter((p) => p.status === "available").length,
      rented: parts.filter((p) => p.status === "rented").length,
      onProject: parts.filter((p) => p.status === "on_project").length,
      broken: parts.filter((p) => p.status === "broken").length,
      projects: projects.length,
      pendingRequests: pending.length,
      activeRentals: active.length,
    };
    return stats;
  },
});
