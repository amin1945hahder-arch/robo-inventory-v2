import { ConvexError, v } from "convex/values";
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
const CARD_LAYOUT_KEY = "card_print_layout";

// ---- Card print layout ---------------------------------------------------
// Admin-configurable layout used EVERYWHERE a rent/badge card is printed or
// downloaded as PDF: page size, card size and its position on the page.
// All numbers are millimetres; unit conversions happen on the client.

export type CardPrintLayout = {
  /** Page size preset the printer gets (@page size). */
  pageSize: "A4" | "A5" | "Letter" | "Legal" | "custom";
  /** Custom page size in mm (used when pageSize === "custom"). */
  pageWidthMm: number;
  pageHeightMm: number;
  /** Card size in mm (printed size — not screen pixels). */
  cardWidthMm: number;
  cardHeightMm: number;
  /** Card position: offset from the page's top-left corner in mm. */
  offsetXmm: number;
  offsetYmm: number;
  /**
   * "page" prints the card centred on the selected paper (office printer);
   * "thermal" prints it on a continuous label roll (@page size = card size).
   */
  printMode: "page" | "thermal";
  /** Printed QR size in millimetres (rent / package / badge cards). */
  qrMm: number;
};

export const DEFAULT_CARD_LAYOUT: CardPrintLayout = {
  pageSize: "A4",
  pageWidthMm: 210,
  pageHeightMm: 297,
  cardWidthMm: 95,
  cardHeightMm: 70,
  offsetXmm: 15,
  offsetYmm: 15,
  printMode: "page",
  qrMm: 10,
};

function normalizeCardLayout(raw: unknown): CardPrintLayout {
  const d = DEFAULT_CARD_LAYOUT;
  const r = (raw ?? {}) as Partial<CardPrintLayout>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : def;
    return Math.min(max, Math.max(min, n));
  };
  const page = ["A4", "A5", "Letter", "Legal", "custom"].includes(String(r.pageSize))
    ? (r.pageSize as CardPrintLayout["pageSize"])
    : d.pageSize;
  const mode = r.printMode === "thermal" ? "thermal" : r.printMode === "page" ? "page" : d.printMode;
  const pw = num(r.pageWidthMm, d.pageWidthMm, 40, 400);
  const ph = num(r.pageHeightMm, d.pageHeightMm, 40, 400);
  const cw = num(r.cardWidthMm, d.cardWidthMm, 20, 400);
  const ch = num(r.cardHeightMm, d.cardHeightMm, 20, 400);
  return {
    pageSize: page,
    pageWidthMm: pw,
    pageHeightMm: ph,
    cardWidthMm: cw,
    cardHeightMm: ch,
    offsetXmm: num(r.offsetXmm, d.offsetXmm, 0, Math.max(0, pw - Math.min(cw, pw))),
    offsetYmm: num(r.offsetYmm, d.offsetYmm, 0, Math.max(0, ph - Math.min(ch, ph))),
    printMode: mode,
    qrMm: num(r.qrMm, d.qrMm, 6, 40),
  };
}

/** Read the card print layout (any signed-in user — the dialog needs it). */
export const getCardLayout = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CARD_LAYOUT_KEY))
      .unique();
    return normalizeCardLayout(row?.value ? JSON.parse(row.value) : {});
  },
});

/** Admin saves the card print layout. */
export const setCardLayout = mutation({
  args: {
    pageSize: v.union(
      v.literal("A4"),
      v.literal("A5"),
      v.literal("Letter"),
      v.literal("Legal"),
      v.literal("custom"),
    ),
    pageWidthMm: v.number(),
    pageHeightMm: v.number(),
    cardWidthMm: v.number(),
    cardHeightMm: v.number(),
    offsetXmm: v.number(),
    offsetYmm: v.number(),
    printMode: v.union(v.literal("page"), v.literal("thermal")),
    // Optional so older clients (and stored layouts) without the field keep
    // working — normalizeCardLayout fills the default (10mm).
    qrMm: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const value = JSON.stringify(normalizeCardLayout(args));
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CARD_LAYOUT_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key: CARD_LAYOUT_KEY, value });
    return normalizeCardLayout(JSON.parse(value));
  },
});

// ---- Per-user notification sounds ----------------------------------------
// Every member owns their sound settings (stored on their user row); the
// DEFAULTS seed the tone list. There is no app-wide sound setting anymore.

export type SoundSpec = { freq: number; dur: number; vol?: number };
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
    sounds: v.record(
      v.string(),
      v.object({ freq: v.number(), dur: v.number(), vol: v.optional(v.number()) }),
    ),
  },
  handler: async (ctx, { enabled, sounds }) => {
    const me = await requireUser(ctx);
    const value = JSON.stringify({ enabled, sounds });
    await ctx.db.patch(me._id, { soundSettings: value });
    return { ok: true };
  },
});

// ---- Per-user appearance (app mode) ---------------------------------------
// Every member picks their own app mode: "dark", "light" or "system" (follow
// the OS). Stored on the user row so it follows the person across devices.

export type Appearance = "dark" | "light" | "system";

// Read MY OWN appearance setting (any signed-in user). Defaults to dark —
// the app was designed dark-first.
export const getMyAppearance = query({
  args: {},
  handler: async (ctx): Promise<Appearance> => {
    const me = await requireUser(ctx);
    return me.appearance ?? "dark";
  },
});

// Save MY OWN appearance setting — never affects anyone else.
export const setMyAppearance = mutation({
  args: { value: v.union(v.literal("dark"), v.literal("light"), v.literal("system")) },
  handler: async (ctx, { value }) => {
    const me = await requireUser(ctx);
    await ctx.db.patch(me._id, { appearance: value });
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
      throw new ConvexError("Cooldown must be between 0 and 720 hours");
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

// (chat backup destinations removed — the chat module no longer exists)

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
    if (!me || me.role !== "admin") throw new ConvexError("Admin access required");
    return await ctx.runAction(internal.telegram.sendManual, {
      text: text.trim() || "✅ Test message from the Robotics Club inventory app",
      bot: bot ?? "app",
      threadId,
    });
  },
});
