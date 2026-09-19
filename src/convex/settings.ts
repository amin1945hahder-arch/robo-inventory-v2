import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAdmin, requireUser } from "./lib";

/**
 * Admin-editable app settings, stored in the settings table as JSON values.
 *
 *  - "telegram":  { botToken, printerBotToken, clubGroupChatId,
 *                   printerGroupChatId, notificationsOn }
 *  - "return_request_cooldown_hours": number stored as JSON string
 */

export type TelegramSettings = {
  botToken: string; // APP BOT — posts club notifications into the club group
  printerBotToken: string; // PRINTER BOT — posts print-farm notifications
  clubGroupChatId: string; // APP group (topics/forum enabled)
  printerGroupChatId: string; // PRINTER group (print farm archive)
  notificationsOn: boolean;
};

const TELEGRAM_KEY = "telegram";
const COOLDOWN_KEY = "return_request_cooldown_hours";

// ---- Per-user notification sounds ----------------------------------------
// Every member owns their sound settings (stored on their user row); the
// DEFAULTS seed the tone list. There is no app-wide sound setting anymore.

export type SoundSpec = { freq: number; dur: number };
export type SoundSettings = { enabled: boolean; sounds: Record<string, SoundSpec> };

export const DEFAULT_SOUNDS: SoundSettings = {
  enabled: true,
  sounds: {
    scan: { freq: 880, dur: 0.08 },
    rental_request: { freq: 660, dur: 0.12 },
    approved: { freq: 988, dur: 0.15 },
    denied: { freq: 220, dur: 0.25 },
    returned: { freq: 523, dur: 0.18 },
    assigned: { freq: 784, dur: 0.12 },
    notification: { freq: 740, dur: 0.1 },
  },
};

const SOUNDS_KEY = "notification_sounds"; // legacy global key (no longer written)

// Read my own sound settings (any signed-in user). Falls back to defaults.
export const getMySounds = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const parsed = me.soundSettings
      ? (JSON.parse(me.soundSettings) as Partial<SoundSettings>)
      : {};
    return {
      enabled: parsed.enabled ?? DEFAULT_SOUNDS.enabled,
      sounds: { ...DEFAULT_SOUNDS.sounds, ...(parsed.sounds ?? {}) },
    };
  },
});

// Save MY OWN sound settings — each member controls their own tones.
export const setMySounds = mutation({
  args: {
    enabled: v.boolean(),
    sounds: v.record(v.string(), v.object({ freq: v.number(), dur: v.number() })),
  },
  handler: async (ctx, { enabled, sounds }) => {
    const me = await requireUser(ctx);
    const value = JSON.stringify({ enabled, sounds });
    await ctx.db.patch(me._id, { soundSettings: value });
    return { ok: true };
  },
});

// @deprecated legacy global sounds (kept only so old clients don't break).
export const getSounds = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SOUNDS_KEY))
      .unique();
    const parsed = row?.value ? (JSON.parse(row.value) as Partial<SoundSettings>) : {};
    return {
      enabled: parsed.enabled ?? DEFAULT_SOUNDS.enabled,
      sounds: { ...DEFAULT_SOUNDS.sounds, ...(parsed.sounds ?? {}) },
    };
  },
});

// The current Telegram settings (any signed-in user may read; the bot tokens
// are masked — only their last 4 chars are returned, never the full secret).
export const getTelegram = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const cfg = await getTelegramConfig(ctx);
    return {
      botToken: cfg.botToken ? "••••" + cfg.botToken.slice(-4) : "",
      hasToken: Boolean(cfg.botToken),
      printerBotToken: cfg.printerBotToken ? "••••" + cfg.printerBotToken.slice(-4) : "",
      hasPrinterToken: Boolean(cfg.printerBotToken),
      clubGroupChatId: cfg.clubGroupChatId,
      printerGroupChatId: cfg.printerGroupChatId ?? "",
      notificationsOn: cfg.notificationsOn,
    };
  },
});

// Admin saves the Telegram integration settings.
export const setTelegram = mutation({
  args: {
    botToken: v.optional(v.string()),
    printerBotToken: v.optional(v.string()),
    clubGroupChatId: v.optional(v.string()),
    printerGroupChatId: v.optional(v.string()),
    notificationsOn: v.optional(v.boolean()),
  },
  handler: async (ctx, { botToken, printerBotToken, clubGroupChatId, printerGroupChatId, notificationsOn }) => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", TELEGRAM_KEY))
      .unique();
    const current: TelegramSettings = row?.value
      ? JSON.parse(row.value)
      : {
          botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
          printerBotToken: process.env.TELEGRAM_PRINTER_BOT_TOKEN ?? "",
          clubGroupChatId: process.env.TELEGRAM_CHAT_ID ?? "",
          printerGroupChatId: process.env.TELEGRAM_PRINTER_CHAT_ID ?? "",
          notificationsOn: true,
        };
    const next: TelegramSettings = {
      // An empty token from the UI means "keep the existing one".
      botToken:
        botToken === undefined || botToken.trim() === "" ? current.botToken : botToken.trim(),
      printerBotToken:
        printerBotToken === undefined || printerBotToken.trim() === ""
          ? (current.printerBotToken ?? "")
          : printerBotToken.trim(),
      clubGroupChatId:
        clubGroupChatId !== undefined ? clubGroupChatId.trim() : current.clubGroupChatId,
      printerGroupChatId:
        printerGroupChatId !== undefined
          ? printerGroupChatId.trim()
          : (current.printerGroupChatId ?? ""),
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

// Server-side helper: the raw telegram config (with the real tokens).
// Falls back to the TELEGRAM_* env vars when no settings row exists yet.
export async function getTelegramConfig(ctx: QueryCtx): Promise<TelegramSettings> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", TELEGRAM_KEY))
    .unique();
  if (row?.value) return JSON.parse(row.value) as TelegramSettings;
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    printerBotToken: process.env.TELEGRAM_PRINTER_BOT_TOKEN ?? "",
    clubGroupChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    printerGroupChatId: process.env.TELEGRAM_PRINTER_CHAT_ID ?? "",
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

// ---- Chat backup destinations (admin-only controller) ----
//
// Conversation archives are produced client-side (JSZip) and never stored in
// the database. This setting only records HOW/WHERE admins distribute them:
//   { mode: "download" }                              → browser download only
//   { mode: "telegram", chatId?: string }              → also post to Telegram
//   { mode: "telegram-dm" }                            → DM to the exporting admin
// Full remote upload targets (webhook/drive) can be added behind mode
// "webhook" without schema changes: { mode: "webhook", url, headers }.
export type ChatBackupSettings = {
  mode: "download" | "telegram" | "telegram-dm" | "webhook";
  chatId?: string;
  webhookUrl?: string;
};

const CHAT_BACKUP_KEY = "chat_backup_destination";

export const getChatBackupDestination = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CHAT_BACKUP_KEY))
      .unique();
    const parsed = row?.value ? (JSON.parse(row.value) as ChatBackupSettings) : null;
    return parsed ?? { mode: "download" } as ChatBackupSettings;
  },
});

/** Internal (no auth — the action checks the caller's role itself). */
export const getChatBackupDestinationInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<ChatBackupSettings> => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CHAT_BACKUP_KEY))
      .unique();
    const parsed = row?.value ? (JSON.parse(row.value) as ChatBackupSettings) : null;
    return parsed ?? { mode: "download" };
  },
});

/**
 * Any signed-in member can read the archive destination *mode* (never the
 * group chat id) so the client knows whether a Telegram delivery will happen
 * and can skip the local download / demand a linked Telegram account first.
 */
export const getMyBackupDestination = query({
  args: {},
  handler: async (ctx): Promise<{ mode: ChatBackupSettings["mode"] }> => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CHAT_BACKUP_KEY))
      .unique();
    const parsed = row?.value ? (JSON.parse(row.value) as ChatBackupSettings) : null;
    return { mode: parsed?.mode ?? "download" };
  },
});

const TELEGRAM_POLL_OFFSET_KEY = "telegram_poll_offset";

/** Last Telegram update id the bot poller processed (cursor, not a secret). */
export const getTelegramPollOffset = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", TELEGRAM_POLL_OFFSET_KEY))
      .unique();
    return row?.value ? Number(row.value) || 0 : 0;
  },
});

export const setTelegramPollOffset = internalMutation({
  args: { offset: v.number() },
  handler: async (ctx, { offset }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", TELEGRAM_POLL_OFFSET_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: String(offset) });
    else await ctx.db.insert("settings", { key: TELEGRAM_POLL_OFFSET_KEY, value: String(offset) });
  },
});

export const setChatBackupDestination = mutation({
  args: {
    mode: v.union(
      v.literal("download"),
      v.literal("telegram"),
      v.literal("telegram-dm"),
      v.literal("webhook"),
    ),
    chatId: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
  },
  handler: async (ctx, { mode, chatId, webhookUrl }) => {
    await requireAdmin(ctx);
    if (mode === "telegram" && !chatId?.trim()) {
      throw new Error("A chat id is required for the Telegram destination");
    }
    if (mode === "webhook" && !webhookUrl?.trim()) {
      throw new Error("A webhook URL is required for the webhook destination");
    }
    const value = JSON.stringify({
      mode,
      chatId: chatId?.trim() || undefined,
      webhookUrl: webhookUrl?.trim() || undefined,
    } satisfies ChatBackupSettings);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CHAT_BACKUP_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key: CHAT_BACKUP_KEY, value });
    return { ok: true };
  },
});

// Admin test send: posts a message into the APP group so the setup can be
// verified right from the Settings page. (see also: sounds above)
export const sendTestMessage = action({
  args: {
    text: v.string(),
    // Which bot/group to test: "app" (default) or "printer".
    bot: v.optional(v.union(v.literal("app"), v.literal("printer"))),
    // Optional topic thread to post into (APP group has topics enabled).
    threadId: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { text, bot, threadId },
  ): Promise<{ sent: boolean; reason?: string }> => {
    const me = await ctx.runQuery(api.users.currentUser, {});
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    return await ctx.runAction(internal.telegram.sendManual, {
      text: text.trim() || "✅ Test message from the Robotics Club inventory app",
      bot: bot ?? "app",
      threadId,
    });
  },
});
