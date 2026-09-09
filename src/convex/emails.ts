"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Email to the admin when a rental request arrives, with approve/deny links.
export const sendRentalRequestEmail = action({
  args: {
    student: v.string(),
    partName: v.string(),
    partTag: v.string(),
    rentalId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { student, partName, partTag, rentalId, note }) => {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return { sent: false, reason: "ADMIN_EMAIL not set" };
    const base = process.env.APP_BASE_URL ?? "";
    const approve = `${base}/qr/decision?rental=${rentalId}&approve=1&token=${process.env.ADMIN_ACTION_TOKEN ?? ""}`;
    const deny = `${base}/qr/decision?rental=${rentalId}&approve=0&token=${process.env.ADMIN_ACTION_TOKEN ?? ""}`;
    const vlyAny = (await import("@vly-ai/integrations")) as any;
    const mod = vlyAny.default ?? vlyAny;
    const factory = mod.createVlyIntegrations ?? mod.vly?.createVlyIntegrations ?? mod.createVlyIntegrations;
    const vly = factory({
      deploymentToken: process.env.VLY_INTEGRATION_KEY!,
    });
    const result = await vly.email.send({
      to: adminEmail,
      subject: `Rental request: ${partName} (${partTag}) — ${student}`,
      html: `<div style="font-family:sans-serif;max-width:520px">
        <h2 style="margin:0 0 12px">New rental request</h2>
        <p><b>${esc(student)}</b> requested to rent <b>${esc(partName)}</b> <span style="color:#666">(${esc(partTag)})</span>.</p>
        ${note ? `<p style="color:#444">Note: ${esc(note)}</p>` : ""}
        <p style="margin:24px 0">
          <a href="${approve}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;margin-right:8px">Approve</a>
          <a href="${deny}" style="background:#eee;color:#111;padding:10px 18px;border-radius:6px;text-decoration:none">Deny</a>
        </p>
        <p style="color:#888;font-size:12px">Robotics Club Inventory — you can also handle this from the dashboard.</p>
      </div>`,
      text: `New rental request: ${student} -> ${partName} (${partTag}). Approve: ${approve} | Deny: ${deny}`,
    });
    return { sent: result?.success ?? false };
  },
});

// Notify the student of a decision on their request.
export const sendRentalDecisionEmail = action({
  args: {
    to: v.string(),
    student: v.string(),
    partName: v.string(),
    approved: v.boolean(),
  },
  handler: async (ctx, { to, student, partName, approved }) => {
    if (!to) return { sent: false };
    const vlyAny = (await import("@vly-ai/integrations")) as any;
    const mod = vlyAny.default ?? vlyAny;
    const factory = mod.createVlyIntegrations ?? mod.vly?.createVlyIntegrations ?? mod.createVlyIntegrations;
    const vly = factory({
      deploymentToken: process.env.VLY_INTEGRATION_KEY!,
    });
    const result = await vly.email.send({
      to,
      subject: approved ? `Approved: ${partName}` : `Request denied: ${partName}`,
      html: `<div style="font-family:sans-serif">
        <p>Hi ${esc(student)},</p>
        <p>Your request for <b>${esc(partName)}</b> was <b>${approved ? "approved 🎉" : "denied"}</b>.</p>
        ${approved ? `<p>Pick it up from the lab and scan the unit's QR tag when you do.</p>` : ""}
        <p style="color:#888;font-size:12px">Robotics Club Inventory</p>
      </div>`,
      text: `Hi ${student}, your request for ${partName} was ${approved ? "approved" : "denied"}.`,
    });
    return { sent: result?.success ?? false };
  },
});
