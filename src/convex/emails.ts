"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { adminAllowList } from "./adminConfig";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function getVly() {
  const vlyAny = (await import("@vly-ai/integrations")) as any;
  const mod = vlyAny.default ?? vlyAny;
  const factory = mod.createVlyIntegrations ?? mod.vly?.createVlyIntegrations ?? mod.createVlyIntegrations;
  return factory({ deploymentToken: process.env.VLY_INTEGRATION_KEY! });
}

// Email every admin on the allow-list when a rental request arrives,
// with one-click approve/deny links (via the /decision HTTP endpoint).
export const sendRentalRequestEmail = action({
  args: {
    student: v.string(),
    partName: v.string(),
    partTag: v.string(),
    rentalId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { student, partName, partTag, rentalId, note }) => {
    const recipients = [...new Set([...adminAllowList(), process.env.ADMIN_EMAIL].filter(Boolean))] as string[];
    if (recipients.length === 0) return { sent: false, reason: "ADMIN_EMAILS not set" };

    // Links go to the Convex HTTP endpoint (CONVEX_SITE_URL is set automatically).
    const base = process.env.CONVEX_SITE_URL ?? "";
    const token = process.env.ADMIN_ACTION_TOKEN ?? "";
    const q = (approve: boolean) =>
      `rental=${encodeURIComponent(rentalId)}&approve=${approve ? 1 : 0}&token=${encodeURIComponent(token)}`;
    const approve = `${base}/decision?${q(true)}`;
    const deny = `${base}/decision?${q(false)}`;
    const canDecide = Boolean(base && token);

    const vly = await getVly();
    let sent = 0;
    for (const to of recipients) {
      const result = await vly.email.send({
        to,
        subject: `Rental request: ${partName} (${partTag}) — ${student}`,
        html: `<div style="font-family:sans-serif;max-width:520px">
          <h2 style="margin:0 0 12px">New rental request</h2>
          <p><b>${esc(student)}</b> requested to rent <b>${esc(partName)}</b> <span style="color:#666">(${esc(partTag)})</span>.</p>
          ${note ? `<p style="color:#444">Note: ${esc(note)}</p>` : ""}
          ${
            canDecide
              ? `<p style="margin:24px 0">
                   <a href="${approve}" style="background:#22d3ee;color:#04252b;padding:10px 18px;border-radius:6px;text-decoration:none;margin-right:8px;font-weight:600">Approve</a>
                   <a href="${deny}" style="background:#eee;color:#111;padding:10px 18px;border-radius:6px;text-decoration:none">Deny</a>
                 </p>`
              : `<p style="color:#888;font-size:12px">Set ADMIN_ACTION_TOKEN to enable one-click decisions from email.</p>`
          }
          <p style="color:#888;font-size:12px">Robotics Club Inventory — you can also handle this from the dashboard.</p>
        </div>`,
        text: `New rental request: ${student} -> ${partName} (${partTag}).`,
      });
      if (result?.success) sent += 1;
    }
    return { sent };
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
    const vly = await getVly();
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
