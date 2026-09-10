"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Telegram notifications via the free Telegram Bot API — no SDK, no cost.
 *
 * Activation keys (paste into the project's Keys/API keys tab):
 *   TELEGRAM_BOT_TOKEN — create a bot with @BotFather, paste its token
 *   TELEGRAM_CHAT_ID   — the club group chat id (add the bot to the group,
 *                        then read https://api.telegram.org/bot<token>/getUpdates)
 *
 * Until the token is set, every call is a no-op and the app works as before.
 * Per-member chat ids are stored on each user (admin sets them on the People
 * page) so decision messages can go straight to the member's own chat.
 */
export const send = internalAction({
  args: { chatId: v.optional(v.string()), text: v.string() },
  handler: async (ctx, { chatId, text }) => {
    void ctx;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { sent: false, reason: "TELEGRAM_BOT_TOKEN not set" };

    // A specific chatId targets one member; no chatId targets the club chat.
    const targets = chatId ? [chatId] : process.env.TELEGRAM_CHAT_ID ? [process.env.TELEGRAM_CHAT_ID] : [];
    if (targets.length === 0) return { sent: false, reason: "no chat id" };

    let ok = false;
    for (const chat_id of targets) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
        });
        if (res.ok) ok = true;
      } catch {
        // network error — notifications must never break the flow
      }
    }
    return { sent: ok };
  },
});
