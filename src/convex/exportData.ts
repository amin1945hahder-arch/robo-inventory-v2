import { query } from "./_generated/server";
import { requireAdmin } from "./lib";

// Joined datasets for the Export studio. Admin-only.

export const inventory = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const groups = await ctx.db
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const out = [];
    for (const g of groups.sort((a, b) => a.name.localeCompare(b.name))) {
      const category = await ctx.db.get(g.categoryId);
      const closet = await ctx.db.get(g.closetId);
      const mine = parts.filter((p) => p.groupId === g._id);
      out.push({
        group: g,
        category,
        closet,
        s: {
          total: mine.length,
          available: mine.filter((p) => p.status === "available").length,
          rented: mine.filter((p) => p.status === "rented").length,
          onProject: mine.filter((p) => p.status === "on_project").length,
          broken: mine.filter((p) => p.status === "broken").length,
          pending: mine.filter((p) => p.status === "pending").length,
        },
      });
    }
    return out;
  },
});

export const rentals = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("rentals").collect();
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await ctx.db.get(r.partId);
      const group = part ? await ctx.db.get(part.groupId) : null;
      const project = r.projectId ? await ctx.db.get(r.projectId) : null;
      const student = await ctx.db.get(r.userId);
      out.push({ rental: r, part, group, project, student });
    }
    return out;
  },
});

export const people = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    const rentals = await ctx.db.query("rentals").collect();
    return users
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
      .map((u) => ({
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          studentId: u.studentId,
          phone: u.phone,
          studentCode: u.studentCode,
          clubRoles: u.clubRoles,
          academicState: u.academicState,
          major: u.major,
          role: u.role,
          membershipStatus: u.membershipStatus,
        },
        activeRentals: rentals.filter(
          (r) => r.userId === u._id && (r.status === "active" || r.status === "on_project"),
        ).length,
      }));
  },
});

export const projects = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const projects = await ctx.db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const out = [];
    for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const owner = project.ownerId ? await ctx.db.get(project.ownerId) : null;
      out.push({
        project,
        owner,
        partCount: parts.filter((p) => p.currentProjectId === project._id).length,
      });
    }
    return out;
  },
});
