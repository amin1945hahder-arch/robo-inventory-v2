"use node";

import { action } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireActionAdmin } from "./authActions";
import { safeImage } from "./lib";
import { loadTurso } from "./tursoDb";

/**
 * QR label data — reads from TURSO, not Convex.
 *
 * First converted read: the data now lives in Turso (kept current by the live
 * mirror), so this is an ACTION reading through the ctx.db-shaped bridge. The
 * body is the same shape as the old query; only `ctx.db` became `db`, the
 * `requireAdmin` gate became the action-capable twin, and the schema types are
 * preserved via the bridge's query generic. There is no read that changes
 * anything, so nothing is published to the change-head mirror.
 *
 * NOTE: this page genuinely needs every row (it prints a QR for each one), so
 * the reads are deliberately full-table. It is admin-gated and rarely opened,
 * which is the "allowScan" case of the read budget.
 */
export const getLabelData = action({
  args: {},
  handler: async (ctx) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const closets = await db.query<Doc<"closets">>("closets").collect();
    const categories = await db.query<Doc<"categories">>("categories").collect();
    const projects = await db
      .query<Doc<"projects">>("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const groups = await db
      .query<Doc<"groups">>("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await db
      .query<Doc<"parts">>("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();

    const closetsSorted = closets.sort((a, b) => a.name.localeCompare(b.name));
    const groupsWithParts = groups
      .map((g) => ({
        group: g,
        // A group named exactly like a storage shares the storage's QR: its
        // printed label carries the closet payload so scans open the storage.
        closetAlias: closets.find((c) => c.name === g.name) ?? null,
        parts: parts
          .filter((p) => p.groupId === g._id)
          .sort((a, b) => a.tag.localeCompare(b.tag)),
      }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name));

    // People QRs: every real (non-guest) club member/student with a name.
    const users = await db.query<Doc<"users">>("users").collect();
    const people = users
      .filter((u) => !u.isAnonymous && (u.name || u.email))
      .map((u) => ({
        _id: u._id as string,
        name: u.name ?? u.email ?? "Member",
        sub: u.studentId ?? u.role ?? "",
        image: safeImage(u.image),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      closets: closetsSorted,
      categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
      projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
      groups: groupsWithParts,
      people,
    };
  },
});
