"use node";

import { v } from "convex/values";
import axios from "axios";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Dangerous-zone database reset (see resetDbStore.ts for the purge itself).
 *
 * Flow: admin clicks "Reset database" in Settings → gets an email with a
 * 6-digit code → types the code + the exact phrase "DELETE ALL" → every
 * inventory/chat/people/requests table is purged in one transaction. The
 * requesting admin survives (user row + auth stay, so they remain signed in
 * and in control) and settings rows survive (telegram config, cooldown,
 * sounds) so the app keeps working right after.
 */

const CODE_TTL_MS = 10 * 60_000; // 10 minutes

function randomCode(): string {
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((n) => String(n % 10))
    .join("");
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
void esc; // kept for potential future HTML email rendering

/**
 * Deliver the reset code over the same email pipeline that sign-in codes use
 * (auth.freebuff.app/send_otp) — that endpoint is proven to work in this
 * deployment, unlike the generic Vly email integration which fails server-side
 * with no actionable error. If the email pipeline is down we fall back to a
 * Telegram DM to the requesting admin so the flow never dead-ends.
 */
async function sendResetCode(
  ctx: any,
  to: string,
  code: string,
  adminId: string,
): Promise<{ via: "email" | "telegram" }> {
  const appName = process.env.VLY_APP_NAME || "the Robotics Club Inventory";
  try {
    await axios.post(
      "https://auth.freebuff.app/send_otp",
      {
        to,
        otp: code,
        // The reset UI in Settings explains this code is for the full reset.
        appName: `${appName} (database reset verification)`,
      },
      {
        headers: {
          "x-api-key": "fb_email_2crN1hqIArZP2bEfvjp5Qik4",
        },
        timeout: 15_000,
      },
    );
    return { via: "email" };
  } catch (emailError) {
    // Fallback: Telegram DM to the admin who requested the reset.
    const dm = await telegramDMCode(ctx, adminId, code);
    if (dm.sent) return { via: "telegram" };
    const reason =
      axios.isAxiosError(emailError)
        ? `${emailError.response?.status ?? ""} ${emailError.message}`.trim()
        : emailError instanceof Error
          ? emailError.message
          : String(emailError);
    throw new Error(
      `Could not send the verification code (${reason}) — and the Telegram fallback also failed. Check your Telegram link in the profile or try again later.`,
    );
  }
}

/** DM the code to a user through the club bot (safe no-op if not linked). */
async function telegramDMCode(ctx: any, userId: string, code: string) {
  try {
    return (await ctx.runAction(internal.telegram.dmMember, {
      userId: userId as never,
      text: `🔐 Database reset code: ${code} — expires in 10 minutes. Enter it in Settings → Danger zone.`,
      fromName: "Security",
    })) as { sent: boolean; reason?: string };
  } catch {
    return { sent: false };
  }
}

// Step 1 — admin requests the reset: generate + email a 6-digit code.
export const requestReset = action({
  args: {},
  handler: async (ctx) => {
    const me = (await ctx.runQuery(internal.users.currentInternalUser, {})) as any;
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    if (!me.email) throw new Error("Your account has no email — cannot send the code");

    const code = randomCode();
    const expiresAt = validCodeUntil(Date.now());
    await ctx.runMutation(internal.resetDbStore.storeCode, { code, expiresAt, adminId: me._id });

    const result = await sendResetCode(ctx, me.email, code, me._id);
    return { sent: true as const, via: result.via };
  },
});

// Step 2 — admin confirms: code + exact phrase "DELETE ALL" → purge.
export const confirmReset = action({
  args: { code: v.string(), confirmPhrase: v.string() },
  handler: async (ctx, { code, confirmPhrase }): Promise<{ ok: boolean; counts: Record<string, number> }> => {
    const me = (await ctx.runQuery(internal.users.currentInternalUser, {})) as any;
    if (!me || me.role !== "admin") throw new Error("Admin access required");
    if (confirmPhrase.trim() !== "DELETE ALL") {
      throw new Error('Type exactly "DELETE ALL" to confirm');
    }
    const pending = (await ctx.runQuery(internal.resetDbStore.getPending, {})) as any;
    if (!pending) throw new Error("No reset was requested — request a code first");
    if (pending.adminId !== me._id) {
  throw new Error("Only the admin who requested the reset can confirm it");
}
    if (Date.now() > pending.expiresAt) throw new Error("The code expired — request a new one");
    if (pending.code !== code.trim()) throw new Error("Wrong verification code");

    const counts: Record<string, number> = await ctx.runMutation(
      internal.resetDbStore.purgeAll,
      { adminId: me._id },
    );
    return { ok: true, counts };
  },
});

// ---- helpers (pure, exported for tests if ever needed) ----

export function validCodeUntil(now: number): number {
  return now + CODE_TTL_MS;
}
