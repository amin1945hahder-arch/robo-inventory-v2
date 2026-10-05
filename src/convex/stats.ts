import { action } from "./_generated/server";
import { requireActionNonStudent } from "./authActions";
import { loadTurso } from "./tursoDb";

// Aggregated stats for inventory dashboard / group cards.
//
// Converted to read TURSO (kept current by the live mirror). These are
// aggregate reads that genuinely need whole small tables (groups/parts/
// projects) or an indexed rental range, so they are the deliberate "scan" case
// of the read budget; they run on a signed-in page, not per request.
export const groupStats = action({
  args: {},
  handler: async (ctx) => {
    await requireActionNonStudent(ctx);
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
    const byGroup: Record<string, { total: number; available: number; rented: number; onProject: number; broken: number; pending: number; transferred: number; consumed: number }> = {};
    for (const p of parts) {
      const g = (byGroup[p.groupId] ??= {
        total: 0,
        available: 0,
        rented: 0,
        onProject: 0,
        broken: 0,
        pending: 0,
        transferred: 0,
        consumed: 0,
      });
      g.total += 1;
      if (p.status === "available") g.available += 1;
      else if (p.status === "rented") g.rented += 1;
      else if (p.status === "on_project") g.onProject += 1;
      else if (p.status === "broken") g.broken += 1;
      else if (p.status === "pending") g.pending += 1;
      else if (p.status === "transferred") g.transferred += 1;
      else if (p.status === "consumed") g.consumed += 1;
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
        transferred: 0,
        consumed: 0,
      };
    }
    return out;
  },
});

export const overview = action({
  args: {},
  handler: async (ctx) => {
    await requireActionNonStudent(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const parts = (await db.query("parts").filter((q) => q.neq(q.field("deleted"), true)).collect()) as any[];
    const groups = (await db.query("groups").filter((q) => q.neq(q.field("deleted"), true)).collect()) as any[];
    const projects = (await db
      .query("projects")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect()) as any[];
    const pending = (await db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect()) as any[];
    const active = (await db
      .query("rentals")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect()) as any[];
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
