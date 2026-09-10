import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";

/**
 * Fire-and-forget Telegram message. Safe to call from any mutation:
 * it schedules the send, so failures never block the caller and the
 * action itself is a no-op until TELEGRAM_BOT_TOKEN is configured.
 */
export async function notifyTelegram(ctx: MutationCtx, text: string, chatId?: string) {
  await ctx.scheduler.runAfter(0, internal.telegram.send, { chatId, text });
}
