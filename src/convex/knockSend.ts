"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Knock delivery (node runtime) — @knocklabs/node needs Node APIs, so it lives
 * in its own "use node" module, exactly like pushSend.ts / emails.ts.
 *
 * Contract (same as the Telegram/WhatsApp/email channels): mutations schedule
 * these fire-and-forget from src/convex/knock.ts, and every failure path
 * RETURNS a result instead of throwing — a missing key or a Knock outage can
 * never block the mutation that asked for the notification.
 *
 * Environment (project Keys tab):
 *   KNOCK_API_KEY     — secret server key (dashboard.knock.app → Platform → API keys)
 *   KNOCK_SIGNING_KEY — RS256 key used by signUserToken for in-app feed auth
 *
 * Workflows triggered here — create them in the Knock dashboard with exactly
 * these data bindings:
 *   rental-request   data: student, partName, partTag, rentalId, note
 *                    actor: the requesting member
 *   rental-decision  data: partName, partTag, approved
 *                    actor: the deciding admin (when known)
 *
 * Knock user IDs are Convex user IDs, so they line up with the token issued by
 * inboxToken below (signUserToken(user._id)).
 */

const recipientArg = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
});

/** Fire one workflow for a set of recipients (scheduled from mutations). */
export const trigger = internalAction({
  args: {
    workflow: v.string(),
    recipients: v.array(recipientArg),
    actor: v.optional(v.object({ id: v.string(), name: v.optional(v.string()) })),
    data: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (_ctx, { workflow, recipients, actor, data }) => {
    const apiKey = process.env.KNOCK_API_KEY;
    if (!apiKey) return { ok: false, reason: "KNOCK_API_KEY not set" };
    if (recipients.length === 0) return { ok: false, reason: "no recipients" };
    try {
      const { Knock } = await import("@knocklabs/node");
      const knock = new Knock({ apiKey });
      // Inline identification: Knock upserts each user straight from the
      // payload, so there is no separate sync step to keep in step with the
      // users table.
      const res = await knock.workflows.trigger(workflow, {
        recipients: recipients.map((r) => {
          if (!r.name && !r.email) return r.id;
          return {
            id: r.id,
            ...(r.name ? { name: r.name } : {}),
            ...(r.email ? { email: r.email } : {}),
          };
        }),
        ...(actor ? { actor: actor.name ? { id: actor.id, name: actor.name } : actor.id } : {}),
        ...(data ? { data } : {}),
      });
      return { ok: true, workflowRunId: res.workflow_run_id };
    } catch (err) {
      // Log for the dashboard, but never rethrow: this runs as a scheduled
      // action and the calling mutation has already committed.
      console.error(`Knock trigger "${workflow}" failed`, err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },
});

/**
 * Short-lived RS256 JWT for Knock's in-app feed components (KnockFeedProvider
 * etc.), signed with KNOCK_SIGNING_KEY. Call from the client with useAction —
 * the caller's identity flows through runQuery into the internal query, so a
 * user can only ever get a token for THEMSELVES.
 */
export const inboxToken = action({
  args: {},
  handler: async (ctx) => {
    const signingKey = process.env.KNOCK_SIGNING_KEY;
    if (!signingKey) return { token: null, configured: false, signedIn: false };
    const user = await ctx.runQuery(internal.users.currentInternalUser, {});
    if (!user) return { token: null, configured: true, signedIn: false };
    try {
      const { signUserToken } = await import("@knocklabs/node");
      const token = await signUserToken(user._id, { signingKey });
      return { token, configured: true, signedIn: true };
    } catch (err) {
      console.error("Knock in-app token failed", err);
      return { token: null, configured: true, signedIn: true };
    }
  },
});
