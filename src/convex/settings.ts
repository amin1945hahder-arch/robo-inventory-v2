import { v } from "convex/values";
import { internalQuery, mutation, query, action } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAdmin, requireUser } from "./lib";

/**
 * Admin-editable app settings, stored in the settings table as JSON values.
 *
 *  - "telegram":  { botToken, clubGroupChatId, notificationsOn }
 *  - "return_request_cooldown_hours": number stored as JSON string
 */

export type TelegramSettings = {
  botToken: string;
  clubGroupChatId: string;
  notificationsOn: boolean;
};

const TELEGRAM_KEY = "telegram";
const COOLDOWN_KEY = "return_request_cooldown_hours";

// The current Telegram settings (any signed-in user may read; the bot token
// is masked — only its last 4 chars are returned, never the full secret).
export const getTelegram = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const cfg = await getTelegramConfig(ctx);
    return {
      botToken: cfg.botToken ? "••••" + cfg.botToken.slice(-4) : "",
      hasToken: Boolean(cfg.botToken),
      clubGroupChatId: cfg.clubGroupChatId,
      notificationsOn: cfg.notificationsOn,
    };
  },
});

// Admin saves the Telegram integration settings.
export const setTelegram = mutation({
  args: {
    botToken: v.optional(v.string()),
    clubGroupChatId: v.optional(v.string()),
    notificationsOn: v.optional(v.boolean()),
  },
  handler: async (ctx, { botToken, clubGroupChatId, notificationsOn }) => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", TELEGRAM_KEY))
      .unique();
    const current: TelegramSettings = row?.value
      ? JSON.parse(row.value)
      : {
          botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
          clubGroupChatId: process.env.TELEGRAM_CHAT_ID ?? "",
          notificationsOn: true,
        };
    const next: TelegramSettings = {
      // An empty token from the UI means "keep the existing one".
      botToken:
        botToken === undefined || botToken.trim() === "" ? current.botToken : botToken.trim(),
      clubGroupChatId:
        clubGroupChatId !== undefined ? clubGroupChatId.trim() : current.clubGroupChatId,
      notificationsOn: notificationsOn ?? current.notificationsOn,
    };
    if (row) {
      await ctx.db.patch(row._id, { value: JSON.stringify(next) });
    } else {
      await ctx.db.insert("settings", { key: TELEGRAM_KEY, value: JSON.stringify(next) });
    }
    return { ok: true };
  },
});

// Server-side helper: the raw telegram config (with the real token).
// Falls back to the TELEGRAM_* env vars when no settings row exists yet.
export async function getTelegramConfig(ctx: QueryCtx): Promise<TelegramSettings> {  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", TELEGRAM_KEY))
    .unique();
  if (row?.value) return JSON.parse(row.value) as TelegramSettings;
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    clubGroupChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    notificationsOn: true,
  };
}

// Internal query used by the telegram action to read the config (actions
// cannot touch ctx.db directly).
export const getTelegramConfigQuery = internalQuery({
  args: {},
  handler: async (ctx) => getTelegramConfig(ctx),
});

// ---- Return-request cooldown ----

// Admin-set period (in hours) after which a member may send another return
// request for the same rental. Defaults to 24h.
export const getReturnCooldown = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", COOLDOWN_KEY))
      .unique();
    return row?.value ? Number(JSON.parse(row.value)) : 24;
  },
});

export const setReturnCooldown = mutation({
  args: { hours: v.number() },
  handler: async (ctx, { hours }) => {
    await requireAdmin(ctx);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 30) {
      throw new Error("Cooldown must be between 0 and 720 hours");
    }
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", COOLDOWN_KEY))
      .unique();
    const value = JSON.stringify(Math.round(hours));
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key: COOLDOWN_KEY, value });
    return { ok: true };
  },
});

// Admin test send: posts a message into the club group so the setup can be
// verified right from the Settings page.
export const sendTestMessage = action({
  args: { text: v.string() },
  handler: async (ctx, { text }): Promise<{ sent: boolean; reason?: string }> => {
    const me = await ctx.runQuery(api.users.currentUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    return await ctx.runAction(internal.telegram.sendManual, {
      text: text.trim() || "✅ Test message from the Robotics Club inventory app",
    });
  },
});
