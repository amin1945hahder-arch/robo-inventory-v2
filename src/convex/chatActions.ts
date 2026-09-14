import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Public action: deliver a finished chat-backup archive to the destination
 * the admin configured in Settings. The archive itself is produced in the
 * browser with JSZip and is NOT stored in the database — it only passes
 * through here when a Telegram destination is active.
 *
 * Auth + role are checked with a direct user fetch (getAuthUserId) instead of
 * runQuery(api.users.currentUser) so the function's return type does not
 * recurse through the users module.
 */
export const deliverBackup = action({
  args: {
    fileName: v.string(),
    dataBase64: v.string(),
    caption: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { fileName, dataBase64, caption },
  ): Promise<{ sent: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first");
    const me = (await ctx.runQuery(internal.chatAuth.me, { userId })) as {
      role?: string;
    } | null;
    if (!me) throw new Error("User not found");
    // Any signed-in member may deliver THEIR OWN local archive to the
    // admin-configured destination (the destination itself stays admin-only).
    // "telegram-dm" always targets the caller's own chat, so this is safe
    // for every role.
    const dest = (await ctx.runQuery(
      internal.settings.getChatBackupDestinationInternal,
      {},
    )) as { mode: string; chatId?: string } | null;
    if (!dest || dest.mode === "download") {
      return { sent: false, reason: "destination-is-download-only" };
    }
    if (dest.mode === "webhook") {
      // Reserved for future remote targets; never stored server-side.
      return { sent: false, reason: "webhook-not-configured" };
    }
    return await ctx.runAction(internal.telegram.sendBackupFile, {
      fileName,
      dataBase64,
      caption,
      mode: dest.mode === "telegram-dm" ? ("dm" as const) : ("group" as const),
      chatId: dest.chatId,
    });
  },
});
