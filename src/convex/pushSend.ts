"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Web Push delivery (node runtime) — the protocol needs WebCrypto + the
 * `web-push` library, so it lives in its own "use node" module. Called by
 * push.pushToUser / push.pushToAdmins for each subscribed device.
 *
 * Payload encryption is per-subscription (p256dh + auth), so the FULL
 * subscription object must be passed — not just the endpoint.
 */
export const pushDeliverOne = internalAction({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, { endpoint, p256dh, auth, payload }) => {
    void ctx;
    void p256dh;
    void auth;
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPublicKey || !vapidPrivateKey) {
      throw new Error("push keys not configured");
    }
    const mod = (await import("web-push")) as unknown as {
      sendNotification: (
        endpoint: string,
        options: { publicKey: string; privateKey: string },
        payload?: string,
      ) => Promise<unknown>;
    };
    await mod.sendNotification(
      endpoint,
      { publicKey: vapidPublicKey, privateKey: vapidPrivateKey },
      payload,
    );
    return { ok: true };
  },
});
