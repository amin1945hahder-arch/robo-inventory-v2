"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Manual rent-card PDF relay for the club Telegram group.
 *
 * The PDF is rendered in the admin's browser from the EXACT on-screen card
 * (see RentCardPaper.tsx + rent-card-hifi.ts) — so Arabic renders perfectly.
 * This action just hands those bytes to Telegram: ONE message, the document
 * with every detail on its own caption line.
 *
 * Automated posts (approve / return / assign / package) go through the
 * rentCardRelay queue, which renders the SAME card component in a signed-in
 * client — so every PDF the group receives is pixel-identical.
 *
 * No-op without a bot token configured (Settings page or env).
 */
export const deliverRentCardPdf = action({
  args: {
    pdfBase64: v.string(),
    captionLines: v.string(),
  },
  handler: async (
    ctx,
    { pdfBase64, captionLines },
  ): Promise<{ sent: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first");
    const me = (await ctx.runQuery(internal.chatAuth.me, { userId })) as { role?: string } | null;
    if (!me || me.role !== "admin") {
      throw new Error("Only admins can send rent cards to the group");
    }
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token: string = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };
    const groupChatId: string = cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!groupChatId) return { sent: false, reason: "no-group-chat-id" };
    if (cfg.notificationsOn === false) return { sent: false, reason: "disabled-in-settings" };

    try {
      const bin = atob(pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const form = new FormData();
      form.append("chat_id", groupChatId);
      // Telegram allows 0–1024 chars for a document caption.
      form.append("caption", captionLines.slice(0, 1024));
      form.append(
        "document",
        new Blob([bytes], { type: "application/pdf" }),
        "rent-card.pdf",
      );
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.warn(`[telegram] deliverRentCardPdf failed: ${res.status}`);
        return { sent: false, reason: `http-${res.status}` };
      }
      return { sent: true };
    } catch (e) {
      console.warn("[telegram] deliverRentCardPdf error", e);
      return { sent: false, reason: "send-error" };
    }
  },
});
