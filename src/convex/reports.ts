import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin } from "./lib";

// Full rental history — every request ever made, newest first, with the
// student, part tag, group and project joined in. Optional status + search.
export const history = query({
  args: {
    status: v.optional(v.string()),
    q: v.optional(v.string()),
  },
  handler: async (ctx, { status, q }) => {
    await requireAdmin(ctx);
    let rows = await ctx.db.query("rentals").collect();
    if (status && status !== "all") {
      rows = rows.filter((r) => r.status === status);
    }
    const out = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await ctx.db.get(r.partId);
      const group = part ? await ctx.db.get(part.groupId) : null;
      const project = r.projectId ? await ctx.db.get(r.projectId) : null;
      const student = await ctx.db.get(r.userId);
      const entry = {
        rental: r,
        part,
        group,
        project,
        student: student
          ? {
              _id: student._id,
              name: student.name,
              email: student.email,
              studentId: student.studentId,
              phone: student.phone,
              clubRoles: student.clubRoles,
            }
          : null,
      };
      const s = (q ?? "").trim().toLowerCase();
      if (s) {
        const hay = [
          student?.name,
          student?.email,
          student?.studentId,
          part?.tag,
          group?.name,
          project?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) continue;
      }
      out.push(entry);
    }
    return out;
  },
});

// Aggregate stats + the most-rented groups (for charts).
export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const groups = await ctx.db
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const projects = await ctx.db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const rentals = await ctx.db.query("rentals").collect();
    const users = await ctx.db.query("users").collect();

    const groupName = new Map<string, string>(groups.map((g) => [g._id, g.name]));
    const byGroup = new Map<string, number>();
    for (const r of rentals) {
      const part = await ctx.db.get(r.partId);
      if (!part) continue;
      byGroup.set(part.groupId, (byGroup.get(part.groupId) ?? 0) + 1);
    }
    const topGroups = [...byGroup.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, count]) => ({ name: groupName.get(id) ?? "Unknown", count }));

    const activeProjects = projects.filter((p) => p.status === "active").length;
    return {
      units: parts.length,
      groups: groups.length,
      activeProjects,
      members: users.filter((u) => u.role !== "admin").length,
      admins: users.filter((u) => u.role === "admin").length,
      available: parts.filter((p) => p.status === "available").length,
      rented: parts.filter((p) => p.status === "rented").length,
      onProject: parts.filter((p) => p.status === "on_project").length,
      broken: parts.filter((p) => p.status === "broken").length,
      pendingRequests: rentals.filter((r) => r.status === "pending").length,
      activeLoans: rentals.filter((r) => r.status === "active").length,
      returnedLoans: rentals.filter((r) => r.status === "returned").length,
      totalLoans: rentals.length,
      topGroups,
    };
  },
});