import { v } from "convex/values";
import { action, internalQuery, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib";
import { requireActionAdmin } from "./authActions";
import { loadTurso } from "./tursoDb";

/**
 * Telegram topic routing (forum groups).
 *
 * The APP group has topics enabled: the admin creates the topic list here
 * (add / edit / delete) and assigns each notification category to exactly one
 * topic — e.g. "requests" → topic "now". The same machinery exists for the
 * PRINTER group (it may or may not have topics; with no topics assigned the
 * message simply lands in the group's General chat).
 *
 * Storage: one row per topic in `telegramTopics`:
 *   { bot: "app" | "printer", threadId, name, categories: [...] }
 */

export const NOTIFICATION_CATEGORIES = [
  "rentals",
  "requests",
  "printers",
  "projects",
  "members",
  "inventory",
  "courses",
  "system",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_INFO: Record<
  NotificationCategory,
  { label: string; hint: string }
> = {
  rentals: {
    label: "Rentals & returns",
    hint: "Active rentals, hand-overs, returns, project assignments",
  },
  requests: {
    label: "Requests & approvals",
    hint: "New rental/package/print requests waiting for a decision",
  },
  printers: {
    label: "Printing",
    hint: "Print jobs, slicing, print-farm events and part archives",
  },
  projects: {
    label: "Projects",
    hint: "Project workspaces, missions and team changes",
  },
  members: {
    label: "Members",
    hint: "Profiles, ranks, printer privilege, sign-up decisions",
  },
  inventory: {
    label: "Inventory",
    hint: "Catalog edits, bulk stock, low-stock and broken parts",
  },
  courses: {
    label: "Courses",
    hint: "Course announcements and sessions (reserved for future use)",
  },
  system: {
    label: "System / other",
    hint: "Everything that doesn't fit a category above",
  },
};

export function isNotificationCategory(x: string): x is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(x);
}

export type TopicRow = {
  _id: string;
  bot: "app" | "printer";
  threadId: number;
  name: string;
  categories: string[];
};

// Admin topic list for one group ("app" | "printer").
export const listTopics = action({
  args: { bot: v.union(v.literal("app"), v.literal("printer")) },
  handler: async (ctx, { bot }) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const rows = await db
      .query<Doc<"telegramTopics">>("telegramTopics")
      .withIndex("by_bot", (q) => q.eq("bot", bot))
      .collect();
    return rows
      .map((r) => ({
        _id: r._id,
        bot: r.bot,
        threadId: r.threadId,
        name: r.name,
        categories: r.categories,
      }))
      .sort((a, b) => a.threadId - b.threadId);
  },
});

export const addTopic = mutation({
  args: {
    bot: v.union(v.literal("app"), v.literal("printer")),
    threadId: v.number(),
    name: v.string(),
    categories: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { bot, threadId, name, categories }) => {
    await requireAdmin(ctx);
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Topic name is required");
    if (!Number.isInteger(threadId) || threadId <= 0) {
      throw new Error("Topic id must be a positive number (message_thread_id)");
    }
    const cats = [...new Set(categories ?? [])].filter(isNotificationCategory);
    // A category can only be routed to one topic per group: strip it from
    // every other topic first.
    for (const c of cats) {
      const others = await ctx.db
        .query("telegramTopics")
        .withIndex("by_bot", (q) => q.eq("bot", bot))
        .collect();
      for (const o of others) {
        if (o.categories.includes(c)) {
          await ctx.db.patch(o._id, {
            categories: o.categories.filter((x) => x !== c),
          });
        }
      }
    }
    await ctx.db.insert("telegramTopics", {
      bot,
      threadId,
      name: cleanName,
      categories: cats,
    });
    return { ok: true };
  },
});

export const updateTopic = mutation({
  args: {
    id: v.id("telegramTopics"),
    name: v.optional(v.string()),
    threadId: v.optional(v.number()),
    categories: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, name, threadId, categories }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Topic not found");
    const patch: Partial<{ name: string; threadId: number; categories: string[] }> = {};
    if (name !== undefined) {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Topic name cannot be empty");
      patch.name = cleanName;
    }
    if (threadId !== undefined) {
      if (!Number.isInteger(threadId) || threadId <= 0) {
        throw new Error("Topic id must be a positive number");
      }
      patch.threadId = threadId;
    }
    if (categories !== undefined) {
      const cats = [...new Set(categories)].filter(isNotificationCategory);
      // Uniqueness: remove these categories from other topics of the same group.
      const others = await ctx.db
        .query("telegramTopics")
        .withIndex("by_bot", (q) => q.eq("bot", row.bot))
        .collect();
      for (const o of others) {
        if (o._id === id) continue;
        const overlap = o.categories.filter((c) => (cats as string[]).includes(c));
        if (overlap.length) {
          await ctx.db.patch(o._id, {
            categories: o.categories.filter((c) => !(cats as string[]).includes(c)),
          });
        }
      }
      patch.categories = cats;
    }
    await ctx.db.patch(id, patch);
    return { ok: true };
  },
});

export const deleteTopic = mutation({
  args: { id: v.id("telegramTopics") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(id);
    return { ok: true };
  },
});

// ---- Routing (internal, used by the send path) ----------------------------

/** Category → topic thread id for one group. No topic assigned → undefined
 *  (the message posts into the group's General chat). */
async function resolveThread(
  ctx: QueryCtx,
  bot: "app" | "printer",
  category: NotificationCategory,
): Promise<number | undefined> {
  const topics = await ctx.db
    .query("telegramTopics")
    .withIndex("by_bot", (q) => q.eq("bot", bot))
    .collect();
  const hit = topics.find((t) => t.categories.includes(category));
  return hit?.threadId;
}

/** Internal query the telegram action uses to look up the topic thread. */
export const resolveThreadInternal = internalQuery({
  args: {
    bot: v.union(v.literal("app"), v.literal("printer")),
    category: v.string(),
  },
  handler: async (ctx, { bot, category }) => {
    return resolveThread(ctx, bot, isNotificationCategory(category) ? category : "system");
  },
});

// ---- Shared helpers used by notify.ts (mutations) --------------------------

/** Which bot/group does a notification category belong to? Print-farm events
 *  go to the PRINTER BOT/group; everything else to the APP BOT/group. */
export function botForCategory(category: NotificationCategory): "app" | "printer" {
  return category === "printers" ? "printer" : "app";
}

/** Default category for call sites that don't specify one. "system" is the
 *  catch-all on purpose: the app can never silently route an event into a
 *  real category's topic — the admin decides where "System / other" lands. */
export const DEFAULT_CATEGORY: NotificationCategory = "system";

/** Resolve + schedule a category-routed group post from inside a mutation. */
export async function notifyCategory(
  ctx: MutationCtx,
  category: NotificationCategory,
  text: string,
  tags?: string[],
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.telegram.sendCategory, {
    category,
    text,
    tags,
  });
}
