"use node";

import { v } from "convex/values";
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

async function getVly() {
  const vlyAny = (await import("@vly-ai/integrations")) as any;
  const mod = vlyAny.default ?? vlyAny;
  const factory =
    mod.createVlyIntegrations ?? mod.vly?.createVlyIntegrations ?? mod.createVlyIntegrations;
  return factory({ deploymentToken: process.env.VLY_INTEGRATION_KEY! });
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

    const vly = await getVly();
    const result = await vly.email.send({
      to: me.email,
      subject: "Confirm database reset — verification code",
      html: resetEmailHtml(code),
      text: `Database reset requested. Your verification code: ${code} (expires in 10 minutes).`,
    });
    if (!result?.success) throw new Error("Could not send the verification email — try again");
    return { sent: true as const };
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

export function resetEmailHtml(code: string): string {
  return `<div style="font-family:sans-serif;max-width:520px">
    <h2 style="margin:0 0 12px">Database reset requested</h2>
    <p>Someone (hopefully you) requested a full database reset for the Robotics Club Inventory.</p>
    <p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:16px 0">${esc(code)}</p>
    <p>This code expires in 10 minutes. If you did not request this, ignore this email and do not share the code.</p>
    <p style="color:#888;font-size:12px">The app will also ask you to type DELETE ALL as a second confirmation.</p>
  </div>`;
}
