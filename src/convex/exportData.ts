import { action } from "./_generated/server";
import { requireActionAdmin } from "./authActions";
import { safeImage } from "./lib";
import { loadTurso } from "./tursoDb";

// Joined datasets for the Export studio. Admin-only.
//
// Converted to read TURSO (kept current by the live mirror). `docCache` now
// resolves through the bridge (id-based reads use the `_idmap`), and the
// handlers are unchanged apart from `ctx.db` → `db`.

/** Per-execution memo for joined docs — keeps repeated reads of heavy user
 *  docs (base64 avatars) from re-hitting the database per row. */
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

export const inventory = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const groups = (await db
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const parts = (await db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const cache = docCache();
    const byId = new Map(groups.map((g) => [g._id, g]));
    const out: any[] = [];
    for (const g of groups.sort((a, b) => a.name.localeCompare(b.name))) {
      const category = await cache.get(db, g.categoryId);
      const closet = await cache.get(db, g.closetId);
      // Container (group-of-groups) this group lives inside — shown in the
      // export sheet and printed under the QR on item cards.
      const parent = g.parentGroupId ? (byId.get(g.parentGroupId) ?? null) : null;
      const mine = parts.filter((p) => p.groupId === g._id);
      // Container-chain label ("Box A > Box B") — a same-named group inside a
      // container must never merge with a loose one of the same name.
      let chain = "";
      {
        let cur: any = parent;
        const parts2: string[] = [];
        let depth = 0;
        while (cur && depth < 10) {
          parts2.unshift(cur.name);
          cur = cur.parentGroupId ? byId.get(cur.parentGroupId) : null;
          depth += 1;
        }
        chain = parts2.join(" > ");
      }
      out.push({
        group: {
          _id: g._id,
          name: g.name,
          brand: g.brand,
          model: g.model,
          // Extra fields for the ID column + printed cards (image left, QR right).
          description: g.description,
          imageUrl: g.imageUrl,
          // Container chain ("Box A > Box B") — same-named groups in different
          // containers must not merge in the export's merge-same-name view.
          containerChain: chain,
        },
        parent: parent ? { _id: parent._id, name: parent.name } : null,
        category: category ? { _id: category._id, name: category.name } : null,
        closet: closet ? { _id: closet._id, name: closet.name } : null,
        // Full status split per unit — merged rows sum these across locations.
        counts: {
          available: mine.filter((p) => p.status === "available").length,
          rented: mine.filter((p) => p.status === "rented").length,
          onProject: mine.filter((p) => p.status === "on_project").length,
          broken: mine.filter((p) => p.status === "broken").length,
          pending: mine.filter((p) => p.status === "pending").length,
          transferred: mine.filter((p) => p.status === "transferred").length,
          consumed: mine.filter((p) => p.status === "consumed").length,
        },
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

export const rentals = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const rows = (await db.query("rentals").collect()) as any[];
    // Cached joins + capped projections: full docs (esp. user avatars) repeated
    // per row are expensive; export needs only the columns the studio renders.
    const cache = docCache();
    const joined: any[] = [];
    for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
      const part = await cache.get(db, r.partId);
      const group = part ? await cache.get(db, part.groupId) : null;
      const parent = group?.parentGroupId ? await cache.get(db, group.parentGroupId) : null;
      const project = r.projectId ? await cache.get(db, r.projectId) : null;
      const student = await cache.get(db, r.userId);
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

export const people = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const users = (await db.query("users").collect()) as any[];
    const rentals = (await db.query("rentals").collect()) as any[];
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

export const projects = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const projects = (await db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const parts = (await db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect()) as any[];
    const cache = docCache();
    const out: any[] = [];
    for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const owner = project.ownerId ? await cache.get(db, project.ownerId) : null;
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
export const storages = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const rows = (await db.query("closets").collect()) as any[];
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Every physical unit (tag) with its group/storage names and image — used by
// the printed cards (each card = one unit sticker) and the units dataset.
export const units = action({
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
    const closets = (await db.query("closets").collect()) as any[];
    const out: any[] = [];
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
