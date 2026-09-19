"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";

/**
 * Telegram notifications via the free Telegram Bot API — no SDK, no cost.
 *
 * Config lives in the settings table (admin-editable in the app, Settings
 * page) with env-var fallbacks:
 *   botToken          — from @BotFather (or TELEGRAM_BOT_TOKEN env)
 *   clubGroupChatId   — the club group the bot posts into (or TELEGRAM_CHAT_ID env)
 *
 * Behaviour:
 *  - dm(chatId|username, text): a direct message to ONE member (e.g. a
 *    decision on their rental). Falls back to a t.me link in the group when
 *    the member has not linked their chat yet.
 *  - post(text, tags): a message into the club group; tags are appended
 *    (usernames/ids) so Telegram notifies those people — used to tag the
 *    admins who must act, or the member concerned.
 *
 * Every call is a safe no-op while no bot token is configured.
 */

type PostArgs = { text: string; tags?: string[]; kind?: "group" | "dm" };

async function postTo(
  ctx: any,
  chatId: string,
  text: string,
  token: string,
  threadId?: number,
) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      // Forum-topic routing: only sent when the admin assigned this category
      // to a topic; otherwise the message lands in the General chat.
      ...(threadId ? { message_thread_id: threadId } : {}),
    }),
  });
  if (!res.ok) {
    console.warn(`[telegram] sendMessage to ${chatId} failed: ${res.status}`);
    return false;
  }
  return true;
}

/** Token + group chat id for one bot identity. */
function botIdentity(
  cfg: { botToken: string; printerBotToken?: string; clubGroupChatId: string; printerGroupChatId?: string },
  bot: "app" | "printer",
): { token: string; groupId: string } {
  return bot === "printer"
    ? {
        token: cfg.printerBotToken || "",
        groupId: cfg.printerGroupChatId || "",
      }
    : {
        token: cfg.botToken || "",
        groupId: cfg.clubGroupChatId || "",
      };
}

// Internal: read config + settings from the DB (actions can't access ctx.db
// directly, so we go through an internal query).
async function getConfig(): Promise<{ botToken: string; clubGroupChatId: string; notificationsOn: boolean }> {
  // @ts-ignore — internal query with no ctx (see caller below)
  return { botToken: "", clubGroupChatId: "", notificationsOn: true };
}

export const send = internalAction({
  args: {
    kind: v.union(v.literal("group"), v.literal("dm")),
    text: v.string(),
    tags: v.optional(v.array(v.string())),
    dmChatId: v.optional(v.string()),
    dmUsername: v.optional(v.string()),
    // Which bot identity sends: "app" (default) or "printer".
    bot: v.optional(v.union(v.literal("app"), v.literal("printer"))),
  },
  handler: async (ctx, { kind, text, tags, dmChatId, dmUsername, bot }) => {
    const which = bot ?? "app";
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    if (!cfg.notificationsOn) return { sent: false, reason: "disabled-in-settings" };

    const identity = botIdentity(cfg, which);
    const envToken =
      which === "printer" ? process.env.TELEGRAM_PRINTER_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;
    const envGroup =
      which === "printer" ? process.env.TELEGRAM_PRINTER_CHAT_ID : process.env.TELEGRAM_CHAT_ID;
    const token = identity.token || envToken || "";
    if (!token) return { sent: false, reason: `no-bot-token-${which}` };

    const tagLine = tags && tags.length > 0 ? tags.map((t) => `@${t.replace(/^@/, "")}`).join(" ") : "";

    if (kind === "dm") {
      // Direct message to one member. Without a chat id we cannot DM —
      // a member must have pressed "Start" on the bot at least once.
      if (dmChatId) {
        const ok = await postTo(ctx, dmChatId, text, token);
        return { sent: ok };
      }
      // No chat id: fall back to a group post that tags the member's username,
      // so they still get notified inside that bot's group.
      const groupChatId = identity.groupId || envGroup || "";
      if (groupChatId && dmUsername) {
        const ok = await postTo(
          ctx,
          groupChatId,
          `${text}\n${tagLine || `@${dmUsername.replace(/^@/, "")}`}`,
          token,
        );
        return { sent: ok };
      }
      return { sent: false, reason: "no-chat-id" };
    }

    // Group post: everything goes to that bot's group, tagging the relevant
    // people so Telegram notifies them.
    const groupChatId = identity.groupId || envGroup || "";
    if (!groupChatId) return { sent: false, reason: "no-group-chat-id" };
    const ok = await postTo(ctx, groupChatId, tagLine ? `${text}\n${tagLine}` : text, token);
    return { sent: ok };
  },
});

/**
 * Category-routed group post: resolves the notification category to its bot
 * (printers → PRINTER BOT, everything else → APP BOT) and to the topic
 * thread the admin assigned in Settings, then posts there.
 */
export const sendCategory = internalAction({
  args: {
    category: v.string(),
    text: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { category, text, tags }) => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    if (!cfg.notificationsOn) return { sent: false, reason: "disabled-in-settings" };

    // Print-farm events belong to the PRINTER BOT/group; the rest to APP.
    const which: "app" | "printer" = category === "printers" ? "printer" : "app";
    const identity = botIdentity(cfg, which);
    const envToken =
      which === "printer" ? process.env.TELEGRAM_PRINTER_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;
    const envGroup =
      which === "printer" ? process.env.TELEGRAM_PRINTER_CHAT_ID : process.env.TELEGRAM_CHAT_ID;
    const token = identity.token || envToken || "";
    if (!token) return { sent: false, reason: `no-bot-token-${which}` };
    const groupChatId = identity.groupId || envGroup || "";
    if (!groupChatId) return { sent: false, reason: "no-group-chat-id" };

    const threadId = (await ctx.runQuery(internal.telegramTopics.resolveThreadInternal, {
      bot: which,
      category,
    })) ?? undefined;

    const tagLine = tags && tags.length > 0 ? tags.map((t) => `@${t.replace(/^@/, "")}`).join(" ") : "";
    const ok = await postTo(
      ctx,
      groupChatId,
      tagLine ? `${text}\n${tagLine}` : text,
      token,
      threadId,
    );
    return { sent: ok };
  },
});

/**
 * Send a chat-backup archive (zip) as a Telegram document. Used by the admin
 * "chat backup destinations" panel: archives are produced client-side and
 * only relayed here when the admin configures a Telegram destination. The
 * database never stores the archive.
 */
export const sendBackupFile = internalAction({
  args: {
    fileName: v.string(),
    dataBase64: v.string(),
    caption: v.optional(v.string()),
    // "group" = club group (or an explicit chatId), "dm" = the caller's own chat
    mode: v.union(v.literal("group"), v.literal("dm")),
    chatId: v.optional(v.string()),
  },
  handler: async (ctx, { fileName, dataBase64, caption, mode, chatId }) => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token: string = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };

    let target = "";
    if (mode === "dm") {
      const me = await ctx.runQuery(api.users.currentUser, {});
      target = me?.telegramChatId ?? "";
      if (!target) return { sent: false, reason: "caller-has-no-telegram-chat" };
    } else {
      target = chatId || cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    }
    if (!target) return { sent: false, reason: "no-chat-id" };

    const bin = atob(dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const form = new FormData();
    form.append("chat_id", target);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("document", new Blob([bytes]), fileName);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      console.warn(`[telegram] sendBackupFile failed: ${res.status}`);
      return { sent: false, reason: `http-${res.status}` };
    }
    return { sent: true };
  },
});

/**
 * Relay a print part (STL or G-code) as a Telegram DOCUMENT into the
 * print-farm archive group. The file is never stored in the database —
 * the browser hands us base64, we forward the bytes, done. Used by the
 * print-request flow so the printer team keeps every part on file.
 */
export const sendPrintFile = internalAction({
  args: {
    fileName: v.string(),
    dataBase64: v.string(),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, { fileName, dataBase64, caption }): Promise<{ sent: boolean; reason?: string }> => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token: string = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };
    // The printer group is the archive home for parts; without one configured
    // we fall back to the main club group so nothing is ever silently lost.
    const target: string =
      cfg.printerGroupChatId || cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!target) return { sent: false, reason: "no-printer-group-chat-id" };
    if (cfg.notificationsOn === false) return { sent: false, reason: "disabled-in-settings" };

    try {
      const bin = atob(dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const form = new FormData();
      form.append("chat_id", target);
      if (caption) form.append("caption", caption.slice(0, 1024));
      form.append("document", new Blob([bytes]), fileName);
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.warn(`[telegram] sendPrintFile failed: ${res.status}`);
        return { sent: false, reason: `http-${res.status}` };
      }
      return { sent: true };
    } catch (e) {
      console.warn("[telegram] sendPrintFile error", e);
      return { sent: false, reason: "send-error" };
    }
  },
});

/**
 * Client-callable relay for print parts. The browser uploads the browsed file
 * to Convex TRANSIENT storage, passes the storage id here; the action streams
 * the bytes into the print-farm Telegram group and ALWAYS deletes the blob in
 * a finally block — the file never persists server-side and never touches the
 * database tables. Reviewers: admins and anyone holding the printer privilege.
 */
export const relayPrintFile = action({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, fileName, caption }): Promise<{ sent: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first");
    const me = (await ctx.runQuery(internal.chatAuth.me, { userId })) as {
      role?: string;
      printerRole?: boolean;
    } | null;
    if (!me || (me.role !== "admin" && me.printerRole !== true)) {
      throw new Error("Printer access required to relay print files");
    }
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) return { sent: false, reason: "file-missing" };
      const buf = new Uint8Array(await blob.arrayBuffer());
      let b64 = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        b64 += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const dataBase64 = btoa(b64);
      return await ctx.runAction(internal.telegram.sendPrintFile, {
        fileName,
        dataBase64,
        caption,
      });
    } finally {
      // The archive copy lives in Telegram — the transient blob always goes.
      try {
        await ctx.storage.delete(storageId);
      } catch (e) {
        console.warn("[telegram] print-file blob cleanup failed", e);
      }
    }
  },
});

// One-off manual send from the admin Settings page (test message) — can
// target either bot identity and an optional topic thread.
export const sendManual = internalAction({
  args: {
    text: v.string(),
    chatId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    bot: v.optional(v.union(v.literal("app"), v.literal("printer"))),
    threadId: v.optional(v.number()),
  },
  handler: async (ctx, { text, chatId, tags, bot, threadId }) => {
    const which = bot ?? "app";
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const identity = botIdentity(cfg, which);
    const envToken =
      which === "printer" ? process.env.TELEGRAM_PRINTER_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;
    const envGroup =
      which === "printer" ? process.env.TELEGRAM_PRINTER_CHAT_ID : process.env.TELEGRAM_CHAT_ID;
    const token = identity.token || envToken || "";
    if (!token) return { sent: false, reason: `no-bot-token-${which}` };
    const groupChatId = chatId || identity.groupId || envGroup || "";
    if (!groupChatId) return { sent: false, reason: "no-chat-id" };
    const tagLine = tags?.length ? tags.map((t) => `@${t.replace(/^@/, "")}`).join(" ") : "";
    const ok = await postTo(
      ctx,
      groupChatId,
      tagLine ? `${text}\n${tagLine}` : text,
      token,
      threadId,
    );
    return { sent: ok };
  },
});

// Admin → member direct message from the People page. Runs through the bot
// (the bot is the only sender — that is how Telegram works); the message is
// signed with the sending admin's name. Falls back to a group post tagging
// the member when they have no linked chat yet.
export const dmMember = internalAction({
  args: {
    userId: v.id("users"),
    text: v.string(),
    fromName: v.string(),
  },
  handler: async (ctx, { userId, text, fromName }) => {
    const member = await ctx.runQuery(internal.users.getUserForDm, { userId });
    if (!member) return { sent: false, reason: "member-not-found" };
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    if (!cfg.notificationsOn) return { sent: false, reason: "disabled-in-settings" };
    const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };

    const message = `💬 ${text}\n— ${fromName} (club admin)`;

    if (member.telegramChatId) {
      const ok = await postTo(ctx, member.telegramChatId, message, token);
      return { sent: ok };
    }
    // No chat id: fall back to the club group, tagging the member's username.
    const groupChatId = cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (groupChatId && member.telegramUsername) {
      const ok = await postTo(
        ctx,
        groupChatId,
        `${message}\n@${member.telegramUsername.replace(/^@/, "")}`,
        token,
      );
      return { sent: ok };
    }
    return { sent: false, reason: "member-has-no-telegram" };
  },
});

// ===== Bot auto-linking: messaging the club bot stores a member's chat id =====

type TgUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { username?: string };
    text?: string;
  };
};

/**
 * Periodic bot poll (cron). Reads pending updates from the Telegram API and,
 * for every private message the bot receives, links the sender's chat id to
 * the club member with that @username. This is how a member "activates"
 * their Telegram DMs: set your @username in the profile, send anything to
 * the club bot once, and the pairing happens automatically. The offset
 * cursor lives in the settings table so nothing is processed twice.
 */
export const pollUpdates = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; linked: number }> => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { checked: 0, linked: 0 };

    const offset = (await ctx.runQuery(internal.settings.getTelegramPollOffset, {})) + 1;
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&limit=50&timeout=0`,
    );
    if (!res.ok) return { checked: 0, linked: 0 };
    const json = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
    const updates = json.result ?? [];

    let linked = 0;
    let maxId = offset - 1;
    for (const u of updates) {
      maxId = Math.max(maxId, u.update_id);
      const msg = u.message;
      if (!msg || msg.chat?.type !== "private") continue;
      const r = (await ctx.runMutation(api.users.linkTelegramChatByUsername, {
        chatId: String(msg.chat.id),
        username: msg.from?.username,
      })) as { linked?: boolean } | null;
      if (r?.linked) linked++;
    }
    if (maxId >= offset) {
      await ctx.runMutation(internal.settings.setTelegramPollOffset, { offset: maxId + 1 });
    }
    return { checked: updates.length, linked };
  },
});

/** The club bot's public @username, so the profile can tell members exactly
 * which bot to message to activate their Telegram DMs. */
export const getBotUsername = action({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (!res.ok) return null;
      const json = (await res.json()) as { ok: boolean; result?: { username?: string } };
      return json.result?.username ?? null;
    } catch {
      return null;
    }
  },
});
