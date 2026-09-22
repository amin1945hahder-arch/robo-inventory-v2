import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { hasPrinterPrivilege, requireAdmin, requireNonStudent, requirePrinter, requireUser } from "./lib";
import { telegramDM, telegramGroup } from "./notify";

// ===== 3D Print farm ========================================================
// Printers (admin-configured machines), filament spools (material + remaining
// weight + stock alerts) and print jobs (member requests → slicing help →
// printer queue → printing → done).

// --- Kiri:Moto device profiles -------------------------------------------------
/** Round a "1.25"-style string stock amount minus `deltaG` grams, unit-aware. */
function deductStockString(stock: string | undefined, unit: string | undefined, deltaG: number): string {
  const current = Number(stock ?? 0);
  const inUnits = unit === "kg" ? deltaG / 1000 : unit === "g" ? deltaG : 0;
  const next = Math.max(0, current - inUnits);
  return String(Math.round(next * 1000) / 1000);
}

// --- Printers ---------------------------------------------------------------
// The embedded slicer (Slicer Studio) is driven over Kiri:Moto's frame message
// API: the client pushes the printer profile (bed size, nozzle) directly and
// reads settings back via src/lib/kiri-process.ts.
// --- Printers ---------------------------------------------------------------

const printerFields = {
  name: v.string(),
  model: v.optional(v.string()),
  buildVolumeCm: v.optional(v.object({ w: v.number(), d: v.number(), h: v.number() })),
  nozzleMm: v.optional(v.number()),
  note: v.optional(v.string()),
};

/** All printers, alive first (idle/printing), then maintenance/offline. */
export const listPrinters = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("printers").collect();
    const order = { printing: 0, idle: 1, maintenance: 2, offline: 3 } as const;
    return rows
      .filter((p) => !p.deleted)
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  },
});

/** Admin creates or updates a printer. */
export const savePrinter = mutation({
  args: printerFields,
  handler: async (ctx, data) => {
    await requireAdmin(ctx);
    const { ...fields } = data;
    await ctx.db.insert("printers", { ...fields, status: "idle" });
  },
});

export const updatePrinter = mutation({
  args: { id: v.id("printers"), ...printerFields },
  handler: async (ctx, { id, ...fields }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, fields);
  },
});

/** Admin deletes a printer (soft). Blocked while a job is on it. */
export const deletePrinter = mutation({
  args: { id: v.id("printers") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const busy = await ctx.db
      .query("printJobs")
      .withIndex("by_printer", (q) => q.eq("printerId", id))
      .filter((q) => q.or(q.eq(q.field("status"), "printing"), q.eq(q.field("status"), "queued")))
      .first();
    if (busy) throw new Error("This printer still has queued or active jobs");
    await ctx.db.patch(id, { deleted: true, status: "offline" });
  },
});

/** Admin flips printer status manually (maintenance / back online). */
export const setPrinterStatus = mutation({
  args: {
    id: v.id("printers"),
    status: v.union(
      v.literal("idle"),
      v.literal("printing"),
      v.literal("maintenance"),
      v.literal("offline"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, { status });
  },
});

/** Admin logs routine upkeep or a repair against a printer. */
export const addMaintenance = mutation({
  args: {
    printerId: v.id("printers"),
    kind: v.union(v.literal("routine"), v.literal("repair")),
    text: v.string(),
    toStatus: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("printing"),
        v.literal("maintenance"),
        v.literal("offline"),
      ),
    ),
  },
  handler: async (ctx, { printerId, kind, text, toStatus }) => {
    const admin = await requireAdmin(ctx);
    await ctx.db.insert("printerMaintenance", {
      printerId,
      kind,
      text,
      byUserId: admin._id,
      at: Date.now(),
    });
    if (toStatus) await ctx.db.patch(printerId, { status: toStatus });
  },
});

/** Maintenance history of one printer, newest first. */
export const listMaintenance = query({
  args: { printerId: v.id("printers") },
  handler: async (ctx, { printerId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("printerMaintenance")
      .withIndex("by_printer", (q) => q.eq("printerId", printerId))
      .collect();
    const users = await Promise.all(rows.map((r) => ctx.db.get(r.byUserId)));
    return rows
      .map((r, i) => ({
        _id: r._id,
        kind: r.kind,
        text: r.text,
        at: r.at,
        byName: users[i]?.name ?? "—",
      }))
      .sort((a, b) => b.at - a.at);
  },
});

// --- Filament spools ----------------------------------------------------------

export const listFilaments = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("filaments").collect();
    return rows.filter((f) => !f.archived).sort((a, b) => a.colorName.localeCompare(b.colorName));
  },
});

/** Admin/member-with-permission adds a spool to the farm shelf. */
export const addFilament = mutation({
  args: {
    brand: v.optional(v.string()),
    material: v.union(
      v.literal("PLA"),
      v.literal("PETG"),
      v.literal("ABS"),
      v.literal("TPU"),
      v.literal("ASA"),
      v.literal("PLA+"),
      v.literal("Other"),
    ),
    colorName: v.string(),
    colorHex: v.optional(v.string()),
    weightG: v.number(),
    remainingG: v.optional(v.string()),
    inventoryGroupId: v.optional(v.id("groups")),
    lowAtG: v.optional(v.number()),
  },
  handler: async (ctx, data) => {
    await requireNonStudent(ctx);
    await ctx.db.insert("filaments", {
      ...data,
      remainingG: data.remainingG ?? String(data.weightG),
      createdAt: Date.now(),
    });
  },
});

/** Edit a spool (price, low-stock threshold, remaining weight corrections). */
export const updateFilament = mutation({
  args: {
    id: v.id("filaments"),
    colorName: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    lowAtG: v.optional(v.number()),
    remainingG: v.optional(v.string()),
    inventoryGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, { id, ...patch }) => {
    await requireNonStudent(ctx);
    await ctx.db.patch(id, patch);
  },
});

/** Spool is empty/discarded — archived, never hard-deleted (jobs reference it). */
export const archiveFilament = mutation({
  args: { id: v.id("filaments") },
  handler: async (ctx, { id }) => {
    await requireNonStudent(ctx);
    await ctx.db.patch(id, { archived: true });
  },
});

async function notifyAdmins(ctx: MutationCtx, type: string, text: string, link?: string) {
  await ctx.db.insert("notifications", { forRole: "admin", type, text, link, read: false });
  const admins = await ctx.db
    .query("users")
    .filter((q) => q.eq(q.field("role"), "admin"))
    .collect();
  for (const admin of admins) {
    await telegramDM(ctx, admin, text, undefined, "printers");
  }
}

// --- Print jobs ---------------------------------------------------------------

/**
 * Member-facing list: their own jobs; admins AND anyone holding the printer
 * privilege see everything (they are the reviewers of the print farm).
 */
export const listJobs = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("printJobs").collect();
    const mine =
      user.role === "admin" || hasPrinterPrivilege(user)
        ? rows
        : rows.filter((j) => j.requesterId === user._id);
    const weight = {
      printing: 0,
      queued: 1,
      slicing: 2,
      need_slicing: 3,
      pending: 4,
      approved: 5,
      done: 6,
      failed: 7,
      denied: 8,
      canceled: 9,
    } as const;
    const users = new Map<Id<"users">, string>();
    const names = await Promise.all(
      [...new Set(mine.map((j) => j.requesterId))].map(async (id) => {
        const u = await ctx.db.get(id);
        return [id, u?.name ?? "—"] as const;
      }),
    );
    for (const [id, name] of names) users.set(id, name);
    return mine
      .sort((a, b) => weight[a.status] - weight[b.status] || a.createdAt - b.createdAt)
      .map((j) => ({ ...j, requesterName: users.get(j.requesterId) ?? "—" }));
  },
});

/**
 * Member submits a sliced part from Slicer Studio: the parsed stats and the
 * slicer's settings snapshot ride along for the admin to review. G-code is
 * NOT stored — it lives only in the member's browser and is downloaded
 * locally. Filament is NOT deducted at submission/approval — only at hand-over
 * (start of the actual print), per club policy.
 */
export const submitSlicedJob = mutation({
  args: {
    name: v.string(),
    note: v.optional(v.string()),
    grams: v.optional(v.number()),
    minutes: v.optional(v.number()),
    deviceName: v.optional(v.string()),
    snapshot: v.optional(v.object({
      groups: v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          rows: v.array(v.object({ label: v.string(), value: v.string() })),
        }),
      ),
    })),
  },
  handler: async (ctx, args) => {
    const user = await requirePrinter(ctx);
    const jobId = await ctx.db.insert("printJobs", {
      requesterId: user._id,
      name: args.name,
      details: args.note,
      estWeightG: args.grams,
      estMinutes: args.minutes,
      status: "pending",
      priority: "normal",
      createdAt: Date.now(),
      slicingNote: args.snapshot
        ? JSON.stringify({ deviceName: args.deviceName, groups: args.snapshot.groups })
        : args.deviceName,
    });
    await notifyAdmins(
      ctx,
      "print_job",
      `🖨️ ${user.name ?? "A member"} submitted a sliced print for approval: "${args.name}"${args.grams ? ` (~${args.grams} g)` : ""}.`,
      `/printing3d`,
    );
    return jobId;
  },
});

/** Farm stats for the dashboard: counts by status + live printer count. */
export const farmStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const jobs = await ctx.db.query("printJobs").collect();
    const printers = (await ctx.db.query("printers").collect()).filter((p) => !p.deleted);
    const filaments = (await ctx.db.query("filaments").collect()).filter((f) => !f.archived);
    const byStatus = (s: string) => jobs.filter((j) => j.status === s).length;
    // "approved" jobs are waiting for slicing/file hand-over, not for review.
    // denied requests are closed requests — reviewed, not queued.
    const lowFilaments = filaments.filter(
      (f) => f.lowAtG !== undefined && Number(f.remainingG) <= f.lowAtG,
    ).length;
    return {
      printers: printers.length,
      printing: printers.filter((p) => p.status === "printing").length,
      maintenance: printers.filter((p) => p.status === "maintenance").length,
      queue: byStatus("queued") + byStatus("pending") + byStatus("approved") + byStatus("need_slicing") + byStatus("slicing"),
      active: byStatus("printing"),
      done: byStatus("done"),
      failed: byStatus("failed"),
      spools: filaments.length,
      lowFilaments,
    };
  },
});
/**
 * Transient upload URL for print parts. The browser PUTs the browsed file
 * here, relays the storage id to telegram.relayPrintFile, and the blob is
 * deleted right after — the database tables never hold the file.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePrinter(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Member submits a new print request with a part file BROWSED from their
 * device. Nothing about the file is stored server-side: the client relays
 * the bytes to the print-farm Telegram group (printer archive); the request
 * only records the file's name and size for the review trail.
 * STL / 3MF parts should instead go through Slicer Studio (the dialog says
 * so) — this path is primarily for ready-to-print G-code.
 */
export const createJob = mutation({
  args: {
    name: v.string(),
    details: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileSizeKb: v.optional(v.number()),
    estWeightG: v.optional(v.number()),
    estMinutes: v.optional(v.number()),
    // Member asks for slicing help right away (no file/unsure how to slice).
    needSlicing: v.optional(v.boolean()),
    slicingNote: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("normal"), v.literal("high"))),
  },
  handler: async (ctx, args) => {
    const user = await requirePrinter(ctx);
    const jobId = await ctx.db.insert("printJobs", {
      requesterId: user._id,
      name: args.name,
      details: args.details,
      fileName: args.fileName,
      estWeightG: args.estWeightG,
      estMinutes: args.estMinutes,
      status: args.needSlicing ? "need_slicing" : "pending",
      slicingNote: args.slicingNote,
      priority: args.priority ?? "normal",
      createdAt: Date.now(),
    });
    await notifyAdmins(
      ctx,
      "print_job",
      `🖨️ ${user.name ?? "A member"} requested a print: "${args.name}"${args.fileName ? ` (${args.fileName})` : ""}${args.needSlicing ? " (needs slicing help)" : ""} — awaiting approval.`,
      `/printing3d`,
    );
    await telegramGroup(
      ctx,
      `🖨️ New print request: ${args.name} — from ${user.name ?? "member"}${args.fileName ? ` · ${args.fileName}` : ""}${args.needSlicing ? " · needs slicing help" : ""}`,
      undefined,
      "printers",
    );
    return jobId;
  },
});

/**
 * Approve a print request — allowed for admins AND members holding the
 * printer privilege (per club policy both roles review the farm).
 * The request moves to "approved" and its author is notified.
 */
export const approveJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, note }) => {
    const reviewer = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "pending" && job.status !== "need_slicing")
      throw new Error("Only pending requests can be approved");
    await ctx.db.patch(jobId, {
      status: "approved",
      approvedBy: reviewer._id,
      denialNote: note,
    });
    const requester = await ctx.db.get(job.requesterId);
    await telegramDM(
      ctx,
      requester ?? {},
      `✅ Your print "${job.name}" was approved by ${reviewer.name ?? "the team"}${note ? `: ${note}` : ""}. Next: slice it in Slicer Studio (or hand the file over) and schedule it on a printer.`,
      reviewer,
      "printers",
    );
  },
});

/** Deny a print request — same reviewer rules as approve. */
export const denyJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, note }) => {
    const reviewer = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "pending" && job.status !== "need_slicing")
      throw new Error("Only pending requests can be denied");
    await ctx.db.patch(jobId, {
      status: "denied",
      finishedAt: Date.now(),
      approvedBy: reviewer._id,
      denialNote: note,
    });
    const requester = await ctx.db.get(job.requesterId);
    await telegramDM(
      ctx,
      requester ?? {},
      `❌ Your print "${job.name}" was declined by ${reviewer.name ?? "the team"}${note ? `: ${note}` : ""}. Talk to the team if you want it reconsidered.`,
      reviewer,
      "printers",
    );
  },
});

/**
 * Archive a finished print: hides it from the active history list (soft
 * delete) and closes the paper trail. Reviewer rules as above.
 */
export const archiveJob = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    const reviewer = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (!["done", "failed", "canceled", "denied"].includes(job.status))
      throw new Error("Only finished prints can be archived");
    await ctx.db.patch(jobId, { archivedAt: Date.now() });
    void reviewer;
  },
});

/** Member flags their pending job: "please slice it for me" + note. */
export const requestSlicingHelp = mutation({
  args: { jobId: v.id("printJobs"), note: v.optional(v.string()) },
  handler: async (ctx, { jobId, note }) => {
    const user = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.requesterId !== user._id && user.role !== "admin")
      throw new Error("Only the requester can ask for help on this job");
    if (!["pending", "need_slicing"].includes(job.status))
      throw new Error("This job is already being prepared");
    await ctx.db.patch(jobId, { status: "need_slicing", slicingNote: note });
    await notifyAdmins(
      ctx,
      "print_job",
      `🧩 Slicing help requested for "${job.name}"${note ? `: ${note}` : ""}`,
      `/printing3d`,
    );
  },
});

/** Anyone with the printer privilege (or an admin) claims the slicing task. */
export const claimSlicing = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    const claimer = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    await ctx.db.patch(jobId, { status: "slicing", slicingBy: claimer._id });
    const requester = await ctx.db.get(job.requesterId);
    await telegramDM(
      ctx,
      requester ?? {},
      `🧩 ${claimer.name ?? "A teammate"} took your print "${job.name}" for slicing — you'll be notified when it's scheduled.`,
      claimer,
      "printers",
    );
  },
});

/** Reviewer (admin or printer role) pushes the job onto a printer's queue. */
export const scheduleJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    printerId: v.id("printers"),
    filamentId: v.id("filaments"),
    weightG: v.number(),
    minutes: v.number(),
  },
  handler: async (ctx, { jobId, printerId, filamentId, weightG, minutes }) => {
    const operator = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (!["approved", "pending", "need_slicing", "slicing"].includes(job.status))
      throw new Error("Only approved jobs can be scheduled");
    const filament = await ctx.db.get(filamentId);
    if (!filament || filament.archived) throw new Error("That spool is no longer available");
    if (Number(filament.remainingG) < weightG)
      throw new Error(`Spool has only ${filament.remainingG} g left`);
    // Queue position: after all jobs already queued on this printer.
    const queued = await ctx.db
      .query("printJobs")
      .withIndex("by_printer", (q) => q.eq("printerId", printerId))
      .filter((q) => q.eq(q.field("status"), "queued"))
      .collect();
    const queuePos = queued.reduce((max, j) => Math.max(max, j.queuePos ?? 0), 0) + 1;
    await ctx.db.patch(jobId, {
      status: "queued",
      printerId,
      filamentId,
      weightG,
      minutes,
      queuePos,
      slicingBy: job.slicingBy ?? operator._id,
    });
    const requester = await ctx.db.get(job.requesterId);
    const printer = await ctx.db.get(printerId);
    await telegramDM(
      ctx,
      requester ?? {},
      `✅ Your print "${job.name}" is scheduled on ${printer?.name ?? "a printer"} — ${weightG} g, ~${Math.round(minutes)} min. Position in queue: ${queuePos}.`,
      undefined,
      "printers",
    );
  },
});

/** Reviewer (admin or printer role) starts the next queued job. */
export const startPrint = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    const operator = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || !job.printerId) throw new Error("Job is not scheduled on a printer");
    if (job.status !== "queued") throw new Error("Only queued jobs can start");
    const printer = await ctx.db.get(job.printerId);
    if (printer?.status === "printing")
      throw new Error(`${printer.name} is already printing another job`);
    await ctx.db.patch(jobId, { status: "printing", startedAt: Date.now(), operatedBy: operator._id });
    await ctx.db.patch(job.printerId, { status: "printing" });
    // Everyone queued behind moves up.
    const behind = await ctx.db
      .query("printJobs")
      .withIndex("by_printer", (q) => q.eq("printerId", job.printerId))
      .filter((q) => q.eq(q.field("status"), "queued"))
      .collect();
    for (const j of behind) {
      if ((j.queuePos ?? 0) > (job.queuePos ?? 0))
        await ctx.db.patch(j._id, { queuePos: (j.queuePos ?? 1) - 1 });
    }
    const requester = await ctx.db.get(job.requesterId);
    await telegramDM(
      ctx,
      requester ?? {},
      `🖨️ Your print "${job.name}" just started on ${printer?.name ?? "the printer"}.`,
      undefined,
      "printers",
    );
  },
});

/**
 * Admin completes a print: deduct filament, compute the real cost, close the
 * job, free the printer and notify the requester + club group.
 */
export const completePrint = mutation({
  args: {
    jobId: v.id("printJobs"),
    weightG: v.number(),
    minutes: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, weightG, minutes, note }) => {
    const admin = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "printing") throw new Error("Only a printing job can be completed");
    const printer = job.printerId ? await ctx.db.get(job.printerId) : null;
    const filament = job.filamentId ? await ctx.db.get(job.filamentId) : null;
    await ctx.db.patch(jobId, {
      status: "done",
      finishedAt: Date.now(),
      weightG,
      minutes,
      failureNote: note,
      operatedBy: admin._id,
    });
    if (printer) await ctx.db.patch(printer._id, { status: "idle" });
    if (filament) {
      const remaining = deductStockString(filament.remainingG, "g", weightG);
      await ctx.db.patch(filament._id, { remainingG: remaining });
      // Mirror the deduction into the club inventory ledger, when linked.
      if (filament.inventoryGroupId) {
        const group = await ctx.db.get(filament.inventoryGroupId);
        if (group?.measureStock !== undefined) {
          await ctx.db.patch(group._id, {
            measureStock: deductStockString(group.measureStock, group.measureUnit, weightG),
          });
        }
      }
      const lowAt = filament.lowAtG;
      if (lowAt !== undefined && Number(remaining) <= lowAt) {
        await notifyAdmins(
          ctx,
          "filament_low",
          `⚠️ Filament low: ${filament.colorName} ${filament.material} — ${remaining} g left (threshold ${lowAt} g).`,
          `/printing3d`,
        );
      }
    }
    const requester = await ctx.db.get(job.requesterId);
    await telegramDM(
      ctx,
      requester ?? {},
      `✅ "${job.name}" is done! Come pick it up. Material used: ${weightG} g · print time ${Math.round(minutes)} min.`,
      undefined,
      "printers",
    );
    await telegramGroup(
      ctx,
      `🖨️ Print finished: ${job.name} by ${requester?.name ?? "member"} — ${weightG} g in ${Math.round(minutes)} min on ${printer?.name ?? "the farm"}.`,
      undefined,
      "printers",
    );
  },
});

/** Failed print: log it, free the printer and record a repair entry. */
export const failPrint = mutation({
  args: { jobId: v.id("printJobs"), reason: v.string() },
  handler: async (ctx, { jobId, reason }) => {
    const admin = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (!["printing", "queued"].includes(job.status))
      throw new Error("Only an active or queued job can be marked failed");
    await ctx.db.patch(jobId, {
      status: "failed",
      finishedAt: Date.now(),
      failureNote: reason,
      operatedBy: admin._id,
    });
    if (job.printerId) {
      await ctx.db.patch(job.printerId, { status: "maintenance" });
      await ctx.db.insert("printerMaintenance", {
        printerId: job.printerId,
        kind: "repair",
        text: `Failed print "${job.name}": ${reason}`,
        byUserId: admin._id,
        at: Date.now(),
      });
    }
    const requester = await ctx.db.get(job.requesterId);
    await telegramDM(
      ctx,
      requester ?? {},
      `❌ Your print "${job.name}" failed (${reason}). We'll requeue it once the printer is fixed — or talk to the team.`,
      undefined,
      "printers",
    );
  },
});

/** Requester cancels while pending/slicing; admin can cancel anything queued. */
export const cancelJob = mutation({
  args: { jobId: v.id("printJobs"), reason: v.optional(v.string()) },
  handler: async (ctx, { jobId, reason }) => {
    const user = await requireNonStudent(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    const isAdmin = user.role === "admin";
    // The requester may always cancel their own pending job; touching someone
    // else's (or anything queued) needs the printer privilege.
    if (job.requesterId !== user._id && !hasPrinterPrivilege(user))
      throw new Error("Printer access required");
    if (job.requesterId !== user._id && !isAdmin) throw new Error("Not your job");
    if (!isAdmin && !["pending", "need_slicing", "slicing"].includes(job.status))
      throw new Error("Ask an admin to cancel a job that is already queued");
    if (job.status === "queued" && job.printerId) {
      const behind = await ctx.db
        .query("printJobs")
        .withIndex("by_printer", (q) => q.eq("printerId", job.printerId))
        .filter((q) => q.eq(q.field("status"), "queued"))
        .collect();
      for (const j of behind) {
        if ((j.queuePos ?? 0) > (job.queuePos ?? 0))
          await ctx.db.patch(j._id, { queuePos: (j.queuePos ?? 1) - 1 });
      }
    }
    await ctx.db.patch(jobId, {
      status: "canceled",
      finishedAt: Date.now(),
      failureNote: reason,
    });
  },
});

// --- Overdue sweeper (cron) ----------------------------------------------------

/** Cron: DM admins when a job has been "printing" 50% past its estimate. */
export const sweepOverduePrints = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const printing = await ctx.db
      .query("printJobs")
      .withIndex("by_status", (q) => q.eq("status", "printing"))
      .collect();
    for (const job of printing) {
      const estimate = (job.minutes ?? 0) * 1.5 * 60_000;
      if (!estimate || !job.startedAt) continue;
      if (now - job.startedAt > estimate) {
        await notifyAdmins(
          ctx,
          "print_overdue",
          `⏰ "${job.name}" is overdue on the printer (${Math.round((now - job.startedAt) / 60000)} min elapsed vs ~${Math.round(job.minutes ?? 0)} planned) — check it.`,
          `/printing3d`,
        );
      }
    }
  },
});
