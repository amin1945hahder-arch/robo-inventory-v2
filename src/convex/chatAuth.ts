import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Minimal internal user lookup for actions (avoids api type cycles). */
export const me = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { role: user.role, name: user.name, email: user.email };
  },
});
