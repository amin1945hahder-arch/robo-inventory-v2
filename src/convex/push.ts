import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { listAdmins, requireAdmin, requireUser } from "./lib";

/**
 * Real server push notifications over the standard Web Push protocol (VAPID).
 *
 * One code path for every platform that exposes the Push API:
 *  - Desktop browsers (Chrome/Edge/Firefox) + PWA installs
 *  - Android: Chrome/PWA and the wrapped APK webview
 *  - iOS 16.4+: home-screen PWAs (Safari requires the app to be installed)
 *  - Desktop wrappers (Windows/Linux/Mac) with the standard Push API
 *
 * Keys come from env: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY. The public key is
 * served to clients by pushVapidPublicKey (no secrets). The actual delivery
 * runs in the node runtime (pushSend.ts) because the protocol needs WebCrypto.
 */

type SubscriptionRow = {
  _id: string;
  userId: string;
  endpoint: string;
  keysP256dh: string;
  keysAuth: string;
};

/** Add/refresh the current device's push subscription for the signed-in user. */
export const savePushSubscription = mutation({
  args: {
    endpoint: v.string(),
    keysP256dh: v.string(),
    keysAuth: v.string(),
    userAgent: v.optional(v.string()),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, { endpoint, keysP256dh, keysAuth, userAgent, platform }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: user._id,
        keysP256dh,
        keysAuth,
        userAgent,
        platform,
      });
      return { ok: true, id: existing._id };
    }
    const id = await ctx.db.insert("pushSubscriptions", {
      userId: user._id,
      endpoint,
      keysP256dh,
      keysAuth,
      userAgent,
      platform,
      createdAt: Date.now(),
    });
    return { ok: true, id };
  },
});

/** Unsubscribe the current device (called when the browser drops the sub). */
export const removePushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

/** Admin overview of which devices receive pushes. */
export const listPushSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("pushSubscriptions").collect();
    const out = [];
    for (const r of rows) {
      const u = await ctx.db.get(r.userId);
      out.push({
        _id: r._id,
        userId: r.userId,
        userName: u?.name ?? u?.email ?? "?",
        platform: r.platform,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
      });
    }
    return out;
  },
});

/** The VAPID public key for the subscribe flow (no secrets here). */
export const pushVapidPublicKey = query({
  args: {},
  handler: async () => {
    return {
      key: process.env.VAPID_PUBLIC_KEY ?? null,
      configured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    };
  },
});

// ---- send pipeline ----------------------------------------------------------

/** All subscriptions for one user (used by the send mutation). */
export const subscriptionsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<SubscriptionRow[]> => {
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Push to every device of one user. Fire-and-forget from callers' perspective
 * — call it from any mutation via `internal.push.pushToUser`.
 */
export const pushToUser = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    tag: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { userId, title, body, tag, url },
  ): Promise<{ attempted: number; scheduled: number }> => {
    const subs = await ctx.runQuery(internal.push.subscriptionsForUser, { userId });
    if (subs.length === 0) return { attempted: 0, scheduled: 0 };
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return { attempted: subs.length, scheduled: 0 };
    }
    const payload = JSON.stringify({ title, body, tag: tag ?? "rc", url });
    // Deliveries are scheduled (mutations can't await actions); a dead
    // endpoint simply fails on the push service and is dropped on the next
    // subscription refresh.
    let scheduled = 0;
    for (const s of subs) {
      await ctx.scheduler.runAfter(0, internal.pushSend.pushDeliverOne, {
        endpoint: s.endpoint,
        p256dh: s.keysP256dh,
        auth: s.keysAuth,
        payload,
      });
      scheduled++;
    }
    return { attempted: subs.length, scheduled };
  },
});

/**
 * Send a real OS push to THIS user's subscribed devices — the "Send test"
 * button in Settings → push card. Any signed-in member can ping their own
 * devices; never anyone else's.
 */
export const sendTestPush = mutation({
  args: {},
  handler: async (ctx): Promise<{ sent: number; reason?: string }> => {
    const user = await requireUser(ctx);
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return { sent: 0, reason: "Push keys not configured on the server (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)." };
    }
    const subs = await ctx.runQuery(internal.push.subscriptionsForUser, {
      userId: user._id,
    });
    if (subs.length === 0) {
      return { sent: 0, reason: "No subscribed devices — enable push on this device first." };
    }
    await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
      userId: user._id,
      title: "RC",
      body: "Test notification — pushes are working 🎉",
      tag: "rc-test",
      url: "/dashboard",
    });
    return { sent: subs.length };
  },
});

/**
 * Push to all ADMINS — used for new requests, so the lab console pings every
 * admin device even when the app is closed.
 */
export const pushToAdmins = internalMutation({
  args: {
    title: v.string(),
    body: v.string(),
    tag: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, { title, body, tag, url }) => {
    // by_role index: reads only the admin rows, not every user doc — this
    // runs on EVERY new request, so the full scan was a hot-path cost.
    const admins = await listAdmins(ctx);
    let scheduled = 0;
    for (const a of admins) {
      await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
        userId: a._id,
        title,
        body,
        tag,
        url,
      });
      scheduled++;
    }
    return { admins: admins.length, scheduled };
  },
});
