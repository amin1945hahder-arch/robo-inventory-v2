import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib";

// Resolve a QR payload to a destination route.
// Supported payloads:
//   inv:<groupTagOrSlug>   — group card
//   unit:<PART-TAG>        — individual part
//   cat:<name>             — category view
//   closet:<id>            — closet view
//   proj:<id>              — project view
//   rental:<rentalId>      — printed rent card: opens the unit + that rental
export const resolve = query({
  args: { payload: v.string() },
  handler: async (ctx, { payload }) => {
    await requireUser(ctx);
    const raw = payload.trim();
    const [scheme, value] = raw.split(":");

    const byTag = async () => {
      const part = await ctx.db
        .query("parts")
        .withIndex("by_tag", (q) => q.eq("tag", raw.toUpperCase()))
        .first();
      if (part) return { type: "unit" as const, id: part._id, url: `/part/${part._id}` };
      return null;
    };

    if (scheme === "unit" || scheme === "part") {
      const part = await ctx.db
        .query("parts")
        .withIndex("by_tag", (q) => q.eq("tag", value?.toUpperCase() ?? ""))
        .first();
      if (part) return { type: "unit" as const, id: part._id, url: `/part/${part._id}` };
      const alt = await byTag();
      if (alt) return alt;
      return null;
    }

    if (scheme === "cat") {
      const cats = await ctx.db.query("categories").collect();
      const cat = cats.find((c) => c.name.toLowerCase() === (value ?? "").toLowerCase() || c._id === value);
      if (cat) return { type: "category" as const, id: cat._id, url: `/inventory?category=${cat._id}` };
      return null;
    }

    if (scheme === "closet") {
      const closet = await ctx.db.get(value as any);
      if (closet) return { type: "closet" as const, id: closet._id, url: `/closets/${closet._id}` };
      return null;
    }

    if (scheme === "proj") {
      const project = await ctx.db.get(value as any);
      if (project) return { type: "project" as const, id: project._id, url: `/projects/${project._id}` };
      return null;
    }

    if (scheme === "rental") {
      const rental = await ctx.db
        .query("rentals")
        .filter((q) => q.eq(q.field("_id"), value))
        .first();
      if (!rental) return null;
      // Admins can open any rent card; members only their own.
      const me = await requireUser(ctx);
      const isAdmin = me.role === "admin";
      if (!isAdmin && rental.userId !== me._id) return null;
      const part = await ctx.db.get(rental.partId);
      if (!part) return null;
      return {
        type: "unit" as const,
        id: part._id,
        url: `/part/${part._id}?rental=${rental._id}`,
      };
    }

    if (scheme === "inv") {
      const groups = await ctx.db
        .query("groups")
        .filter((q) => q.eq(q.field("name"), value ?? ""))
        .collect();
      if (groups.length > 0) {
        return { type: "group" as const, id: groups[0]._id, url: `/group/${groups[0]._id}` };
      }
    }

    // fallback: treat raw as a part tag, then group name
    const alt = await byTag();
    if (alt) return alt;
    const groups = await ctx.db
      .query("groups")
      .filter((q) => q.eq(q.field("name"), raw))
      .collect();
    if (groups.length > 0) return { type: "group" as const, id: groups[0]._id, url: `/group/${groups[0]._id}` };
    const closets = await ctx.db.query("closets").collect();
    const closet = closets.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (closet) return { type: "closet" as const, id: closet._id, url: `/closets/${closet._id}` };
    const cats = await ctx.db.query("categories").collect();
    const cat = cats.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (cat) return { type: "category" as const, id: cat._id, url: `/inventory?category=${cat._id}` };
    const projects = await ctx.db.query("projects").collect();
    const project = projects.find((p) => p.name.toLowerCase() === raw.toLowerCase());
    if (project) return { type: "project" as const, id: project._id, url: `/projects/${project._id}` };
    return null;
  },
});
