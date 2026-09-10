import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";

export const listProjects = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("dismantled"))) },
  handler: async (ctx, { status }) => {
    await requireUser(ctx);
    let rows = await ctx.db.query("projects").filter((q) => q.neq(q.field("deleted"), true)).collect();
    if (status) rows = rows.filter((p) => p.status === status);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getProject = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const project = await ctx.db.get(id);
    if (!project) return null;
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const out = [];
    for (const p of parts.sort((a, b) => a.tag.localeCompare(b.tag))) {
      const group = await ctx.db.get(p.groupId);
      out.push({ part: p, group });
    }
    return { project, parts: out };
  },
});

export const upsertProject = mutation({
  args: {
    id: v.optional(v.id("projects")),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("dismantled"))),
    ownerId: v.optional(v.id("users")),
  },
  handler: async (ctx, { id, name, description, status, ownerId }) => {
    await requireAdmin(ctx);
    const data = {
      name: name.trim(),
      description: description?.trim(),
      status: status ?? "active",
      ownerId,
    };
    if (id) {
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("projects", data);
  },
});

export const dismantleProject = mutation({
  args: { id: v.id("projects"), functional: v.boolean() },
  handler: async (ctx, { id, functional }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(id);
    if (!project) throw new Error("Project not found");
    if (project.status === "dismantled") throw new Error("Project is already dismantled");
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .collect();
    for (const p of parts) {
      await ctx.db.patch(p._id, {
        status: functional ? "available" : "broken",
        currentProjectId: undefined,
      });
    }
    await ctx.db.patch(id, { status: "dismantled" });
  },
});

export const completeProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(id);
    if (!project) throw new Error("Project not found");
    await ctx.db.patch(id, { status: "completed" });
  },
});

// Re-open a completed (or dismantled-with-parts-still-assigned) project for
// development — it becomes active again and parts can be assigned to it.
export const reactivateProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(id);
    if (!project) throw new Error("Project not found");
    if (project.status === "active") throw new Error("Project is already active");
    await ctx.db.patch(id, { status: "active" });
  },
});

export const deleteProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .collect();
    if (parts.length > 0) {
      throw new Error("Project still has parts. Dismantle it first to release them.");
    }
    await ctx.db.delete(id);
  },
});
