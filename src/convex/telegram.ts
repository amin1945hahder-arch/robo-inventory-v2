"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
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

async function postTo(ctx: any, chatId: string, text: string, token: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    console.warn(`[telegram] sendMessage to ${chatId} failed: ${res.status}`);
    return false;
  }
  return true;
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
  },
  handler: async (ctx, { kind, text, tags, dmChatId, dmUsername }) => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    if (!cfg.notificationsOn) return { sent: false, reason: "disabled-in-settings" };

    const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };

    const tagLine = tags && tags.length > 0 ? tags.map((t) => `@${t.replace(/^@/, "")}`).join(" ") : "";

    if (kind === "dm") {
      // Direct message to one member. Without a chat id we cannot DM —
      // a member must have pressed "Start" on the bot at least once.
      if (dmChatId) {
        const ok = await postTo(ctx, dmChatId, text, token);
        return { sent: ok };
      }
      // No chat id: fall back to a group post that tags the member's username,
      // so they still get notified inside the club group.
      if (cfg.clubGroupChatId && dmUsername) {
        const ok = await postTo(
          ctx,
          cfg.clubGroupChatId,
          `${text}\n${tagLine || `@${dmUsername.replace(/^@/, "")}`}`,
          token,
        );
        return { sent: ok };
      }
      return { sent: false, reason: "no-chat-id" };
    }

    // Group post: everything goes to the club group, tagging the relevant
    // people so Telegram notifies them.
    const groupChatId = cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!groupChatId) return { sent: false, reason: "no-group-chat-id" };
    const ok = await postTo(ctx, groupChatId, tagLine ? `${text}\n${tagLine}` : text, token);
    return { sent: ok };
  },
});

// One-off manual send from the admin Settings page (test message).
export const sendManual = internalAction({
  args: {
    text: v.string(),
    chatId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { text, chatId, tags }) => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };
    const groupChatId = chatId || cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!groupChatId) return { sent: false, reason: "no-chat-id" };
    const tagLine = tags?.length ? tags.map((t) => `@${t.replace(/^@/, "")}`).join(" ") : "";
    const ok = await postTo(ctx, groupChatId, tagLine ? `${text}\n${tagLine}` : text, token);
    return { sent: ok };
  },
});
