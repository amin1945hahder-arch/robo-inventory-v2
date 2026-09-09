import { query } from "./_generated/server";
import { requireAdmin } from "./lib";

// Everything needed to print QR labels in bulk: every closet, category,
// project, and every group with its individual tagged units.
export const getLabelData = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const closets = await ctx.db.query("closets").collect();
    const categories = await ctx.db.query("categories").collect();
    const projects = await ctx.db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const groups = await ctx.db
      .query("groups")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();

    const groupsWithParts = groups
      .map((g) => ({
        group: g,
        parts: parts
          .filter((p) => p.groupId === g._id)
          .sort((a, b) => a.tag.localeCompare(b.tag)),
      }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name));

    return {
      closets: closets.sort((a, b) => a.name.localeCompare(b.name)),
      categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
      projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
      groups: groupsWithParts,
    };
  },
});