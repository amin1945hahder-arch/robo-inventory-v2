"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { renderRentCardPdf, type RentCardData } from "../lib/rent-card-pdf";

/**
 * Rent-card attachment for the club Telegram group.
 *
 * Whenever a return is requested or processed, the bot posts ONE message:
 * a printable PDF of the rent card, with the full rental details (each field
 * on its own line) as the document caption. No extra text message is sent —
 * the PDF and the details travel together.
 *
 * The PDF is generated 100% in JS (vector PDF, no native deps) and sent via
 * Telegram `sendDocument`, so it stays printable at a fixed size everywhere.
 * No-op without a bot token configured (Settings page or env).
 */

const LINE = "\n";

/** Caption text: every data field on its own line (never one long row). */
function cardCaption(card: RentCardData, headline: string, extraUnitLines?: string[]): string {
  const lines: string[] = [headline, ""];
  lines.push(`🏷 Item: ${card.groupName} (${card.tag})`);
  if (extraUnitLines && extraUnitLines.length > 0) {
    for (const u of extraUnitLines) lines.push(u);
  }
  lines.push(`👤 Student: ${card.holderName}${card.studentId ? ` · ${card.studentId}` : ""}`);
  lines.push(`📌 Status: ${card.statusLabel}`);
  if (card.projectName) lines.push(`🤖 Project: ${card.projectName}`);
  if (card.requestedAt) lines.push(`📅 Requested: ${new Date(card.requestedAt).toLocaleString("en-GB")}`);
  if (card.decidedAt) lines.push(`✅ Decided: ${new Date(card.decidedAt).toLocaleString("en-GB")}`);
  if (card.pickedUpAt) lines.push(`📦 Picked up: ${new Date(card.pickedUpAt).toLocaleString("en-GB")}`);
  if (card.returnedAt) lines.push(`↩️ Returned: ${new Date(card.returnedAt).toLocaleString("en-GB")}`);
  if (card.conditionReport) lines.push(`📝 Condition: ${card.conditionReport}`);
  return lines.join(LINE);
}

export const sendRentCardToGroup = internalAction({
  args: {
    card: v.object({
      rentalId: v.string(),
      groupName: v.string(),
      tag: v.string(),
      holderName: v.string(),
      studentId: v.optional(v.string()),
      statusLabel: v.string(),
      requestedAt: v.optional(v.number()),
      decidedAt: v.optional(v.number()),
      pickedUpAt: v.optional(v.number()),
      returnedAt: v.optional(v.number()),
      conditionReport: v.optional(v.string()),
      projectName: v.optional(v.string()),
    }),
    caption: v.string(),
    // When set, the PDF lists every unit of a package rental (multi-unit card).
    extraUnits: v.optional(
      v.array(v.object({ tag: v.string(), groupName: v.string() })),
    ),
  },
  handler: async (ctx, { card, caption, extraUnits }) => {
    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token: string = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) return { sent: false, reason: "no-bot-token" };
    const groupChatId: string = cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!groupChatId) return { sent: false, reason: "no-group-chat-id" };
    if (cfg.notificationsOn === false) return { sent: false, reason: "disabled-in-settings" };

    try {
      const pdf = renderRentCardPdf(card);
      const captionText = cardCaption(card, caption, extraUnits?.map((u) => `   • ${u.groupName} (${u.tag})`));
      const form = new FormData();
      form.append("chat_id", groupChatId);
      // Telegram allows 0–1024 chars for a document caption.
      form.append("caption", captionText.slice(0, 1024));
      form.append(
        "document",
        new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
        `rent-card-${card.tag}.pdf`,
      );
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.warn(`[telegram] sendDocument(pdf) failed: ${res.status}`);
        return { sent: false, reason: `http-${res.status}` };
      }
      return { sent: true };
    } catch (e) {
      console.warn("[telegram] rent-card PDF render/send failed", e);
      return { sent: false, reason: "render-error" };
    }
  },
});
