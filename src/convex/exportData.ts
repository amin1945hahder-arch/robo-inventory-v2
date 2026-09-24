import { query } from "./_generated/server";
import { requireAdmin, safeImage } from "./lib";

// Joined datasets for the Export studio. Admin-only.

/** Per-execution memo for joined docs — keeps repeated reads of heavy user
 *  docs (base64 avatars) from blowing Convex's per-execution read limit. */
function docCache() {
  const cache = new Map<string, Promise<any>>();
  return {
    async get(ctx: any, id: string | undefined): Promise<any> {
      if (!id) return null;
      const existing = cache.get(id);
      if (existing) return existing;
      const promise: Promise<any> = ctx.db.get(id);
      cache.set(id, promise);
      return promise;
    },
  };
}

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
    const cache = docCache();
    const byId = new Map(groups.map((g) => [g._id, g]));
    const out = [];
    for (const g of groups.sort((a, b) => a.name.localeCompare(b.name))) {
      const category = await cache.get(ctx, g.categoryId);
      const closet = await cache.get(ctx, g.closetId);
      // Container (group-of-groups) this group lives inside — shown in the
      // export sheet and printed under the QR on item cards.
      const parent = g.parentGroupId ? (byId.get(g.parentGroupId) ?? null) : null;
      const mine = parts.filter((p) => p.groupId === g._id);
      out.push({
        group: {
          _id: g._id,
          name: g.name,
          brand: g.brand,
          model: g.model,
          // Extra fields for the ID column + printed cards (image left, QR right).
          description: g.description,
          imageUrl: g.imageUrl,
        },
        parent: parent ? { _id: parent._id, name: parent.name } : null,
        category: category ? { _id: category._id, name: category.name } : null,
        closet: closet ? { _id: closet._id, name: closet.name } : null,
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
    // Cached joins + capped projections: full docs (esp. user avatars) repeated
    // per row have previously pushed queries past Convex's per-execution read
    // limit. Export needs only the columns the studio renders.
    const cache = docCache();
    const joined = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await cache.get(ctx, r.partId);
      const group = part ? await cache.get(ctx, part.groupId) : null;
      const parent = group?.parentGroupId ? await cache.get(ctx, group.parentGroupId) : null;
      const project = r.projectId ? await cache.get(ctx, r.projectId) : null;
      const student = await cache.get(ctx, r.userId);
      joined.push({
        rental: r,
        part: part ? { _id: part._id, tag: part.tag } : null,
        group: group ? { _id: group._id, name: group.name } : null,
        parent: parent ? { _id: parent._id, name: parent.name } : null,
        project: project ? { _id: project._id, name: project.name } : null,
        student: student
          ? {
              _id: student._id,
              name: student.name,
              email: student.email,
              studentId: student.studentId,
              image: safeImage(student.image),
            }
          : null,
      });
    }
    return joined;
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
          dateOfBirth: u.dateOfBirth,
          githubUrl: u.githubUrl,
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
    const cache = docCache();
    const out = [];
    for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const owner = project.ownerId ? await cache.get(ctx, project.ownerId) : null;
      out.push({
        project,
        owner: owner ? { _id: owner._id, name: owner.name, email: owner.email } : null,
        partCount: parts.filter((p) => p.currentProjectId === project._id).length,
      });
    }
    return out;
  },
});

// Storages (for the export sheet + printed cards: image left, QR right).
export const storages = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("closets").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Every physical unit (tag) with its group/storage names and image — used by
// the printed cards (each card = one unit sticker) and the units dataset.
export const units = query({
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
    const closets = await ctx.db.query("closets").collect();
    const out = [];
    for (const p of parts.sort((a, b) => a.tag.localeCompare(b.tag))) {
      const g = groups.find((x) => x._id === p.groupId);
      if (!g) continue;
      const closet = closets.find((c) => c._id === g.closetId);
      const parent = g.parentGroupId
        ? (groups.find((x) => x._id === g.parentGroupId) ?? null)
        : null;
      out.push({
        part: { _id: p._id, tag: p.tag, status: p.status, imageUrl: p.imageUrl },
        group: { _id: g._id, name: g.name, brand: g.brand, model: g.model, imageUrl: g.imageUrl },
        parent: parent ? { _id: parent._id, name: parent.name } : null,
        closet: closet ? { _id: closet._id, name: closet.name } : null,
      });
    }
    return out;
  },
});
