import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Rent-card PDF relay queue.
 *
 * Automated rent-card posts (approve / return / assign / package) must look
 * EXACTLY like the manual "Send PDF to group" PDF. Server-side vector PDF
 * rendering can't do Arabic, so instead of drawing the card twice we reuse
 * the browser pipeline:
 *
 *   1. the mutation that used to post a card inserts a QUEUED job here
 *      (card data + caption — identical fields the dialog would show)
 *   2. the RentCardRelay client (mounted app-wide for admins) subscribes to
 *      the oldest queued job, renders the card OFF-SCREEN with the same
 *      component the dialog shows, rasterizes → PDF (rent-card-hifi.ts)
 *   3. the client uploads the base64 PDF; the action relays it to Telegram
 *      as ONE message: document + every detail on its own caption line
 *   4. the job is marked sent — or skipped if no client rendered it in time
 *
 * Result: every automated card is byte-for-byte the same pipeline as the
 * manual button — perfect Arabic, identical layout.
 */

/** Oldest queued job, for the relay client to claim (reactive subscription). */
export const nextQueuedPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("rentCardJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
  },
});

/** Claim a job for rendering (guards against two tabs racing). Returns the
 *  attempt count so a failing client can decide to skip instead of looping. */
export const claim = mutation({
  args: { jobId: v.id("rentCardJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "gone", attempts: 0 };
    if (job.status !== "queued")
      return { ok: false as const, reason: "not-queued", attempts: job.attempts };
    await ctx.db.patch(jobId, {
      status: "sending",
      attempts: job.attempts + 1,
      updatedAt: Date.now(),
    });
    return { ok: true as const, attempts: job.attempts + 1 };
  },
});

/** Give up a claim (client failed to render) — back to the queue, or skip
 *  entirely after repeated failures so a broken client can't loop forever. */
export const release = mutation({
  args: { jobId: v.id("rentCardJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "sending") return;
    await ctx.db.patch(jobId, {
      status: job.attempts >= 3 ? "skipped" : "queued",
      updatedAt: Date.now(),
    });
  },
});

/** Renderer upload → relay to the Telegram group. Returns the send result so
 *  the client can mark the job sent/skipped (or the action did it already). */
export const deliver = internalMutation({
  args: {
    jobId: v.id("rentCardJobs"),
    pdfBase64: v.string(),
    fileName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { jobId, pdfBase64, fileName },
  ): Promise<{ sent: boolean; reason?: string }> => {
    const job = await ctx.db.get(jobId);
    if (!job) return { sent: false, reason: "job-gone" };

    const cfg = await ctx.runQuery(internal.settings.getTelegramConfigQuery, {});
    const token: string = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    const groupChatId: string = cfg.clubGroupChatId || process.env.TELEGRAM_CHAT_ID || "";
    if (!token) {
      await ctx.db.patch(jobId, { status: "skipped", updatedAt: Date.now() });
      return { sent: false, reason: "no-bot-token" };
    }
    if (!groupChatId) {
      await ctx.db.patch(jobId, { status: "skipped", updatedAt: Date.now() });
      return { sent: false, reason: "no-group-chat-id" };
    }
    if (cfg.notificationsOn === false) {
      await ctx.db.patch(jobId, { status: "skipped", updatedAt: Date.now() });
      return { sent: false, reason: "disabled-in-settings" };
    }

    const bin = atob(pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const name = (fileName || `rent-card-${job.card.tag}.pdf`).slice(0, 64);
    const form = new FormData();
    form.append("chat_id", groupChatId);
    // Telegram allows 0–1024 chars for a document caption.
    form.append("caption", job.caption.slice(0, 1024));
    form.append("document", new Blob([bytes], { type: "application/pdf" }), name);

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.warn(`[telegram] relay sendDocument failed: ${res.status}`);
        await ctx.db.patch(jobId, {
          status: job.attempts >= 3 ? "skipped" : "queued",
          updatedAt: Date.now(),
        });
        return { sent: false, reason: `http-${res.status}` };
      }
      await ctx.db.patch(jobId, { status: "sent", updatedAt: Date.now() });
      return { sent: true };
    } catch (e) {
      console.warn("[telegram] relay send error", e);
      await ctx.db.patch(jobId, {
        status: job.attempts >= 3 ? "skipped" : "queued",
        updatedAt: Date.now(),
      });
      return { sent: false, reason: "send-error" };
    }
  },
});

/** Public mutation wrapper so the client can hand the rendered PDF over.
 *  Any signed-in member may deliver — the job itself is trusted data created
 *  server-side; whoever is online renders it and helps the club. */
export const submitPdf = mutation({
  args: {
    jobId: v.id("rentCardJobs"),
    pdfBase64: v.string(),
    fileName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { jobId, pdfBase64, fileName },
  ): Promise<{ sent: boolean; reason?: string }> => {
    if ((await getAuthUserId(ctx)) === null) throw new Error("Sign in first");
    return await ctx.runMutation(internal.rentCardRelay.deliver, {
      jobId,
      pdfBase64,
      fileName,
    });
  },
});

/** Housekeeping: reclaim stuck "sending" jobs and drop finished ones. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("rentCardJobs")
      .withIndex("by_status", (q) => q.eq("status", "sending"))
      .collect();
    for (const j of stale) {
      const age = now - (j.updatedAt ?? j.createdAt);
      if (age > 60_000) {
        await ctx.db.patch(j._id, {
          status: j.attempts >= 3 ? "skipped" : "queued",
          updatedAt: now,
        });
      }
    }
    // Delete terminal jobs after 10 minutes.
    for (const status of ["sent", "skipped"] as const) {
      const done = await ctx.db
        .query("rentCardJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const j of done) {
        if (now - (j.updatedAt ?? j.createdAt) > 600_000) await ctx.db.delete(j._id);
      }
    }
  },
});
