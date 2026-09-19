import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import {
  botForCategory,
  type NotificationCategory,
} from "./telegramTopics";

/**
 * Telegram notification helpers, called from mutations. Fire-and-forget:
 * sends are scheduled, so failures never block the caller, and the action
 * itself is a no-op until a bot token is configured in Settings (or env).
 *
 * Routing model:
 *  - "printers" category → PRINTER BOT → PRINTER group (topic via routing)
 *  - everything else     → APP BOT → APP group (topics/forum routing)
 * The category → topic map is admin-managed in Settings (telegramTopics).
 */

export type PersonRef = {
  name?: string;
  telegramUsername?: string;
  telegramChatId?: string;
};

/** Default category for each helper, overridable per call site. */
export type NotifyCategory = NotificationCategory;

/** Resolve the tag target for a person: username if set, otherwise their name
 *  (Telegram cannot tag plain names — the text still shows who it concerns). */
function tagFor(p: PersonRef): string {
  if (p.telegramUsername) return `@${p.telegramUsername.replace(/^@/, "")}`;
  return p.name ?? "";
}

/**
 * Post to a club group. `tags` are the people Telegram should notify —
 * e.g. the admins who must act, or the member concerned. `category` routes
 * the message to the right bot/group/topic (defaults to "rentals" — most
 * call sites are rental lifecycle events).
 */
export async function telegramGroup(
  ctx: MutationCtx,
  text: string,
  tags?: PersonRef[],
  category: NotifyCategory = "rentals",
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.telegram.sendCategory, {
    category,
    text,
    tags: tags?.map(tagFor).filter(Boolean),
  });
}

/**
 * Direct message to one member about an action. The message states the actor
 * (e.g. the admin who approved). If the member has no linked chat, it falls
 * back to a group post tagging their username — routed through the same
 * category machinery so it still lands in the right topic.
 */
export async function telegramDM(
  ctx: MutationCtx,
  member: PersonRef,
  text: string,
  actor?: PersonRef,
  category: NotifyCategory = "rentals",
): Promise<void> {
  const from = actor ? `\n— ${actor.name ?? "Club admin"}` : "";
  if (member.telegramChatId) {
    // DMs ride the APP BOT (personal notifications); print-farm DMs still
    // come from the PRINTER BOT below.
    await ctx.scheduler.runAfter(0, internal.telegram.send, {
      kind: "dm",
      text: `${text}${from}`,
      dmChatId: member.telegramChatId,
      dmUsername: member.telegramUsername,
    });
    return;
  }
  // No linked chat: fall back to a routed group post tagging them.
  await telegramGroup(ctx, `${text}${from}`, [member], category);
}

/**
 * Direct message from the PRINTER BOT (print-farm notifications to the
 * requesting member or the printer crew).
 */
export async function telegramPrinterDM(
  ctx: MutationCtx,
  member: PersonRef,
  text: string,
  actor?: PersonRef,
): Promise<void> {
  const from = actor ? `\n— ${actor.name ?? "Print farm"}` : "";
  await ctx.scheduler.runAfter(0, internal.telegram.send, {
    kind: "dm",
    bot: "printer",
    text: `${text}${from}`,
    dmChatId: member.telegramChatId,
    dmUsername: member.telegramUsername,
  });
}

/** Back-compat wrapper: chatId → DM, no chatId → APP group. */
export async function notifyTelegram(ctx: MutationCtx, text: string, chatId?: string) {
  if (chatId) {
    await ctx.scheduler.runAfter(0, internal.telegram.send, {
      kind: "dm",
      text,
      dmChatId: chatId,
    });
  } else {
    await telegramGroup(ctx, text, undefined, "members");
  }
}

export { botForCategory };
