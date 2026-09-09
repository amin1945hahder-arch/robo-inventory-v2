import type { MutationCtx } from "./_generated/server";

/**
 * WhatsApp notifications via Twilio's Programmable Messaging API.
 * No SDK needed — a plain fetch to the REST endpoint.
 *
 * Activation keys (paste into the project's Keys/API keys tab):
 *   TWILIO_ACCOUNT_SID      — from the Twilio console
 *   TWILIO_AUTH_TOKEN       — from the Twilio console
 *   TWILIO_PHONE_NUMBER     — your WhatsApp-enabled Twilio number, e.g. +14155238886
 *   ADMIN_PHONES            — optional: comma-separated admin numbers, e.g. +963996063235,+963930756990
 *                             (defaults to the phone fields of admin users in the DB)
 *
 * Until TWILIO_* keys are set, every call returns { sent: false } and the app
 * keeps working with email + in-app notifications only.
 */

function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

function isConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );
}

export async function sendWhatsApp(
  to: string,
  body: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (!isConfigured()) return { sent: false, reason: "not-configured" };
  const number = toE164(to);
  if (!number) return { sent: false, reason: "bad-number" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_PHONE_NUMBER!.startsWith("whatsapp:")
    ? process.env.TWILIO_PHONE_NUMBER!
    : `whatsapp:${process.env.TWILIO_PHONE_NUMBER!}`;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: `whatsapp:${number}`,
          From: from,
          Body: body,
        }).toString(),
      },
    );
    if (!res.ok) return { sent: false, reason: `twilio:${res.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: "error" };
  }
}

/** Admin WhatsApp numbers: ADMIN_PHONES env (comma-separated E.164 numbers)
 *  or, falling back, the phone fields of admin users in the database. */
export async function adminPhones(ctx: MutationCtx): Promise<string[]> {
  const fromEnv = (process.env.ADMIN_PHONES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  const users = await ctx.db.query("users").collect();
  return users
    .filter((u) => u.role === "admin" && u.phone)
    .map((u) => u.phone!);
}