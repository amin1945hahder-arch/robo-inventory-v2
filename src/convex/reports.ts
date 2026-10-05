import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireActionAdmin } from "./authActions";
import { loadTurso } from "./tursoDb";

// Joined report datasets. Admin-only. Converted to read TURSO.

/** Per-execution memo for joined docs — keeps repeated reads of heavy user
 *  docs (base64 avatars) from re-hitting the database per row. db-based twin of
 *  the helper in parts.ts (which is still Convex-side). */
function docCache() {
  const cache = new Map<string, Promise<any>>();
  return {
    async get(db: any, id: string | undefined): Promise<any> {
      if (!id) return null;
      const existing = cache.get(id);
      if (existing) return existing;
      const promise: Promise<any> = db.get(id);
      cache.set(id, promise);
      return promise;
    },
  };
}

// Full rental history — every request ever made, newest first, with the
// student, part tag, group and project joined in. Optional status + search.
export const history = action({
  args: {
    status: v.optional(v.string()),
    q: v.optional(v.string()),
  },
  handler: async (ctx, { status, q }) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    let rows = (await db.query("rentals").collect()) as any[];
    if (status && status !== "all") {
      rows = rows.filter((r) => r.status === status);
    }
    // Cached joins — users with base64 avatars appear on many rental rows and
    // would be re-read per row otherwise.
    const cache = docCache();
    const out: any[] = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await cache.get(db, r.partId);
      const group = part ? await cache.get(db, part.groupId) : null;
      const project = r.projectId ? await cache.get(db, r.projectId) : null;
      const student = await cache.get(db, r.userId);
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
export const stats = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const parts = (await db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const groups = (await db
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const projects = (await db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const rentals = (await db.query("rentals").collect()) as any[];
    const users = (await db.query("users").collect()) as any[];

    const groupName = new Map<string, string>(groups.map((g) => [g._id, g.name]));
    const byGroup = new Map<string, number>();
    const pcache = docCache();
    for (const r of rentals) {
      const part = await pcache.get(db, r.partId);
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
