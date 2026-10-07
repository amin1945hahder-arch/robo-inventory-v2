import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { listAdmins } from "./lib";

/**
 * Knock notification helpers, called from mutations. Fire-and-forget: the
 * send is scheduled into the node runtime (knockSend.ts), so failures never
 * block the caller and the whole channel is a no-op until KNOCK_API_KEY is
 * set — the exact contract of the Telegram helpers in notify.ts.
 *
 * Knock user IDs are Convex user IDs, so recipients line up with the in-app
 * feed token issued by knockSend.inboxToken (signUserToken(user._id)).
 */

export type KnockRecipient = { id: string; name?: string; email?: string };
export type KnockActor = { id: string; name?: string };

type KnockSend = {
  workflow: string;
  actor?: KnockActor;
  data?: Record<string, unknown>;
};

/** Schedule a raw trigger — recipients already resolved. */
export async function knockTrigger(
  ctx: MutationCtx,
  args: KnockSend & { recipients: KnockRecipient[] },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.knockSend.trigger, {
    workflow: args.workflow,
    recipients: args.recipients,
    ...(args.actor ? { actor: args.actor } : {}),
    ...(args.data ? { data: args.data } : {}),
  });
}

/** Fan out to every admin (by_role index — not every user). */
export async function knockToAdmins(
  ctx: MutationCtx,
  args: KnockSend,
): Promise<void> {
  const admins = await listAdmins(ctx);
  if (admins.length === 0) return;
  await knockTrigger(ctx, {
    workflow: args.workflow,
    recipients: admins.map((a) => ({
      id: a._id,
      ...(a.name ? { name: a.name } : {}),
      ...(a.email ? { email: a.email } : {}),
    })),
    ...(args.actor ? { actor: args.actor } : {}),
    ...(args.data ? { data: args.data } : {}),
  });
}

/** One member — Knock identifies them inline from the user doc. */
export async function knockToUser(
  ctx: MutationCtx,
  user: { _id: string; name?: string | null; email?: string | null },
  args: KnockSend,
): Promise<void> {
  await knockTrigger(ctx, {
    workflow: args.workflow,
    recipients: [
      {
        id: user._id,
        ...(user.name ? { name: user.name } : {}),
        ...(user.email ? { email: user.email } : {}),
      },
    ],
    ...(args.actor ? { actor: args.actor } : {}),
    ...(args.data ? { data: args.data } : {}),
  });
}
