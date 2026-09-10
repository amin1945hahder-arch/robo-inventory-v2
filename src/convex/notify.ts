import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";

/**
 * Telegram notification helpers, called from mutations. Fire-and-forget:
 * sends are scheduled, so failures never block the caller, and the action
 * itself is a no-op until a bot token is configured in Settings (or env).
 */

export type PersonRef = {
  name?: string;
  telegramUsername?: string;
  telegramChatId?: string;
};

/** Resolve the tag target for a person: username if set, otherwise their name
 *  (Telegram cannot tag plain names — the text still shows who it concerns). */
function tagFor(p: PersonRef): string {
  if (p.telegramUsername) return `@${p.telegramUsername.replace(/^@/, "")}`;
  return p.name ?? "";
}

/**
 * Post to the club group. `tags` are the people Telegram should notify —
 * e.g. the admins who must act, or the member concerned.
 */
export async function telegramGroup(
  ctx: MutationCtx,
  text: string,
  tags?: PersonRef[],
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.telegram.send, {
    kind: "group",
    text,
    tags: tags?.map(tagFor).filter(Boolean),
  });
}

/**
 * Direct message to one member about an action. The message states the actor
 * (e.g. the admin who approved). If the member has no linked chat, it falls
 * back to a group post tagging their username.
 */
export async function telegramDM(
  ctx: MutationCtx,
  member: PersonRef,
  text: string,
  actor?: PersonRef,
): Promise<void> {
  const from = actor ? `\n— ${actor.name ?? "Club admin"}` : "";
  await ctx.scheduler.runAfter(0, internal.telegram.send, {
    kind: "dm",
    text: `${text}${from}`,
    dmChatId: member.telegramChatId,
    dmUsername: member.telegramUsername,
  });
}

/** Back-compat wrapper for the existing notifyTelegram calls. */
export async function notifyTelegram(ctx: MutationCtx, text: string, chatId?: string) {
  if (chatId) {
    await ctx.scheduler.runAfter(0, internal.telegram.send, {
      kind: "dm",
      text,
      dmChatId: chatId,
    });
  } else {
    await ctx.scheduler.runAfter(0, internal.telegram.send, { kind: "group", text });
  }
}
