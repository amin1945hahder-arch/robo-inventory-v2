import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireInteractingMember, requirePrinter, hasPrinterPrivilege } from "./lib";
import { requireActionPrinter } from "./authActions";
import { loadTurso } from "./tursoDb";
import { telegramPrinterDM, telegramGroup } from "./notify";

/**
 * 3D Print farm.
 *
 * Flow: member submits a request → a printer-privileged reviewer approves →
 * the job is scheduled on a printer with a spool (weight + minutes from the
 * slicer) → start → complete (real numbers, filament deducted) or fail.
 * Slicer-Studio submissions arrive with a settings snapshot embedded in the
 * note and no file at all — the G-code never touches the database.
 */

const MAX_QUEUE_PER_PRINTER = 20;

/** Next queue position on a printer (append at the end). */
async function nextQueuePos(ctx: any, printerId: Id<"printers">): Promise<number> {
  const rows = await ctx.db
    .query("printJobs")
    .withIndex("by_printer", (q: any) => q.eq("printerId", printerId))
    .collect();
  const queued = rows.filter((j: any) => j.status === "queued");
  return queued.reduce((m: number, j: any) => Math.max(m, j.queuePos ?? 0), 0) + 1;
}

/** Re-pack queue positions (1..n) after any removal from the queue. */
async function repackQueue(ctx: any, printerId: Id<"printers">) {
  const rows = await ctx.db
    .query("printJobs")
    .withIndex("by_printer", (q: any) => q.eq("printerId", printerId))
    .collect();
  const queued = rows
    .filter((j: any) => j.status === "queued")
    .sort((a: any, b: any) => (a.queuePos ?? 0) - (b.queuePos ?? 0));
  let pos = 1;
  for (const j of queued) {
    if (j.queuePos !== pos) await ctx.db.patch(j._id, { queuePos: pos });
    pos += 1;
  }
}

/** Deduct grams from a spool and its linked inventory unit (one ledger). */
async function deductSpool(ctx: any, filamentId: Id<"filaments">, grams: number) {
  const spool = await ctx.db.get(filamentId);
  if (!spool) return;
  const remaining = Math.max(0, Number(spool.remainingG ?? spool.weightG) - grams);
  await ctx.db.patch(spool._id, { remainingG: String(remaining) });
  // Mirror the deduction into the club-inventory group's per-unit ledger so
  // inventory stock and the print-farm shelf never disagree.
  if (spool.inventoryGroupId && spool.partId) {
    const unit = await ctx.db.get(spool.partId);
    if (unit && unit.status !== "rented") {
      const unitLeft = Math.max(0, Number(unit.amountRemaining ?? 0) - grams);
      await ctx.db.patch(unit._id, { amountRemaining: String(Number(unitLeft.toFixed(4))) });
      const units = await ctx.db
        .query("parts")
        .withIndex("by_group", (q: any) => q.eq("groupId", spool.inventoryGroupId))
        .filter((q: any) => q.neq(q.field("deleted"), true))
        .collect();
      await ctx.db.patch(spool.inventoryGroupId, {
        measureStock: String(
          Number(units.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0).toFixed(4)),
        ),
      });
    }
  }
}

/** Restore grams to a spool (canceled/failed prints) and its inventory unit. */
async function refundSpool(ctx: any, filamentId: Id<"filaments">, grams: number) {
  const spool = await ctx.db.get(filamentId);
  if (!spool) return;
  const remaining = Math.min(Number(spool.weightG), Number(spool.remainingG ?? 0) + grams);
  await ctx.db.patch(spool._id, { remainingG: String(remaining) });
  if (spool.inventoryGroupId && spool.partId) {
    const unit = await ctx.db.get(spool.partId);
    if (unit) {
      const unitLeft = Number(unit.amountRemaining ?? 0) + grams;
      await ctx.db.patch(unit._id, { amountRemaining: String(Number(unitLeft.toFixed(4))) });
      const units = await ctx.db
        .query("parts")
        .withIndex("by_group", (q: any) => q.eq("groupId", spool.inventoryGroupId))
        .filter((q: any) => q.neq(q.field("deleted"), true))
        .collect();
      await ctx.db.patch(spool.inventoryGroupId, {
        measureStock: String(
          Number(units.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0).toFixed(4)),
        ),
      });
    }
  }
}

async function memberRef(ctx: any, userId: Id<"users">) {
  const u = await ctx.db.get(userId);
  return {
    name: u?.name ?? u?.email,
    telegramUsername: u?.telegramUsername,
    telegramChatId: u?.telegramChatId,
  };
}

// ===== Printers =====

export const listPrinters = action({
  args: {},
  handler: async (ctx) => {
    await requireActionPrinter(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const rows = await db.query<Doc<"printers">>("printers").filter((q) => q.neq(q.field("deleted"), true)).collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const savePrinter = mutation({
  args: {
    name: v.string(),
    model: v.optional(v.string()),
    buildVolumeCm: v.optional(v.object({ w: v.number(), d: v.number(), h: v.number() })),
    nozzleMm: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { name, model, buildVolumeCm, nozzleMm, note }) => {
    await requireAdmin(ctx);
    const id = await ctx.db.insert("printers", {
      name: name.trim(),
      model: model?.trim(),
      buildVolumeCm,
      nozzleMm,
      note: note?.trim(),
      status: "idle",
    });
    await telegramGroup(ctx, `🖨️ New printer registered on the farm: ${name.trim()}${model ? ` (${model.trim()})` : ""}.`, undefined, "printers");
    return id;
  },
});

export const updatePrinter = mutation({
  args: {
    id: v.id("printers"),
    name: v.string(),
    model: v.optional(v.string()),
    buildVolumeCm: v.optional(v.object({ w: v.number(), d: v.number(), h: v.number() })),
    nozzleMm: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, model, buildVolumeCm, nozzleMm, note }) => {
    await requireAdmin(ctx);
    const printer = await ctx.db.get(id);
    if (!printer || printer.deleted) throw new Error("Printer not found");
    await ctx.db.patch(id, {
      name: name.trim(),
      model: model?.trim(),
      buildVolumeCm,
      nozzleMm,
      note: note?.trim(),
    });
    return { ok: true };
  },
});

export const setPrinterStatus = mutation({
  args: {
    id: v.id("printers"),
    status: v.union(v.literal("idle"), v.literal("printing"), v.literal("maintenance"), v.literal("offline")),
  },
  handler: async (ctx, { id, status }) => {
    await requirePrinter(ctx);
    const printer = await ctx.db.get(id);
    if (!printer || printer.deleted) throw new Error("Printer not found");
    await ctx.db.patch(id, { status });
    return { ok: true };
  },
});

export const deletePrinter = mutation({
  args: { id: v.id("printers") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const printer = await ctx.db.get(id);
    if (!printer || printer.deleted) throw new Error("Printer not found");
    const jobs = await ctx.db
      .query("printJobs")
      .withIndex("by_printer", (q) => q.eq("printerId", id))
      .collect();
    const busy = jobs.filter((j) => j.status === "queued" || j.status === "printing");
    if (busy.length > 0) {
      throw new Error("This printer still has queued/printing jobs — clear the queue first");
    }
    await ctx.db.patch(id, { deleted: true });
    return { ok: true };
  },
});

export const addMaintenance = mutation({
  args: {
    printerId: v.id("printers"),
    kind: v.union(v.literal("routine"), v.literal("repair")),
    text: v.string(),
  },
  handler: async (ctx, { printerId, kind, text }) => {
    const me = await requirePrinter(ctx);
    const printer = await ctx.db.get(printerId);
    if (!printer || printer.deleted) throw new Error("Printer not found");
    const clean = text.trim();
    if (!clean) throw new Error("Describe the maintenance entry");
    await ctx.db.insert("printerMaintenance", {
      printerId,
      kind,
      text: clean,
      byUserId: me._id,
      at: Date.now(),
    });
    await telegramGroup(
      ctx,
      `${kind === "repair" ? "🔧" : "🧰"} ${printer.name}: ${clean.slice(0, 200)} (by ${me.name ?? me.email})`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

// ===== Filament spools =====

export const listFilaments = action({
  args: {},
  handler: async (ctx) => {
    await requireActionPrinter(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    return await db
      .query<Doc<"filaments">>("filaments")
      .withIndex("by_archived", (q) => q.eq("archived", undefined))
      .collect();
  },
});

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
    lowAtG: v.optional(v.number()),
    inventoryGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, { brand, material, colorName, colorHex, weightG, lowAtG, inventoryGroupId }) => {
    await requirePrinter(ctx);
    if (!Number.isFinite(weightG) || weightG <= 0) throw new Error("Spool weight must be > 0");
    const group = inventoryGroupId ? await ctx.db.get(inventoryGroupId) : null;
    if (inventoryGroupId && (!group || group.deleted)) {
      throw new Error("Inventory group not found");
    }
    let partId: Id<"parts"> | undefined;
    const remaining = weightG;
    if (inventoryGroupId && group) {
      if (group.measure !== "weight") {
        throw new Error("The linked inventory group must be a weight-tracked group (kg/g)");
      }
      // One inventory unit mirrors the spool so both ledgers move together.
      const partIdNew = await ctx.db.insert("parts", {
        groupId: inventoryGroupId,
        tag: `SPOOL-${material}-${colorName.trim().slice(0, 12).toUpperCase()}-${Date.now() % 1000}`,
        status: "available",
        note: `Print-farm spool: ${material} ${colorName.trim()}`,
        amountRemaining: String(remaining),
        lowAt: String(lowAtG ?? 0),
      });
      partId = partIdNew;
      const units = await ctx.db
        .query("parts")
        .withIndex("by_group", (q: any) => q.eq("groupId", inventoryGroupId))
        .filter((q: any) => q.neq(q.field("deleted"), true))
        .collect();
      await ctx.db.patch(inventoryGroupId, {
        measureStock: String(
          Number(units.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0).toFixed(4)),
        ),
      });
    }
    await ctx.db.insert("filaments", {
      brand: brand?.trim(),
      material,
      colorName: colorName.trim(),
      colorHex,
      weightG,
      remainingG: String(remaining),
      inventoryGroupId: inventoryGroupId ?? undefined,
      partId,
      lowAtG,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const updateFilament = mutation({
  args: {
    id: v.id("filaments"),
    colorName: v.string(),
    colorHex: v.optional(v.string()),
    remainingG: v.optional(v.string()),
    lowAtG: v.optional(v.number()),
    inventoryGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, { id, colorName, colorHex, remainingG, lowAtG, inventoryGroupId }) => {
    await requirePrinter(ctx);
    const spool = await ctx.db.get(id);
    if (!spool || spool.archived) throw new Error("Spool not found");
    const patch: Record<string, unknown> = {
      colorName: colorName.trim(),
      colorHex,
      lowAtG,
    };
    if (remainingG !== undefined) {
      const n = Number(remainingG);
      if (!Number.isFinite(n) || n < 0) throw new Error("Remaining grams must be ≥ 0");
      patch.remainingG = String(Math.min(n, spool.weightG));
    }
    if (inventoryGroupId !== undefined && inventoryGroupId !== spool.inventoryGroupId) {
      // Relinking: retire the old mirror unit and mint a new one.
      if (spool.partId) {
        await ctx.db.patch(spool.partId, { deleted: true });
      }
      if (spool.inventoryGroupId) {
        const units = await ctx.db
          .query("parts")
          .withIndex("by_group", (q: any) => q.eq("groupId", spool.inventoryGroupId))
          .filter((q: any) => q.neq(q.field("deleted"), true))
          .collect();
        await ctx.db.patch(spool.inventoryGroupId, {
          measureStock: String(
            Number(units.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0).toFixed(4)),
          ),
        });
      }
      if (inventoryGroupId) {
        const group = await ctx.db.get(inventoryGroupId);
        if (!group || group.deleted) throw new Error("Inventory group not found");
        if (group.measure !== "weight") {
          throw new Error("The linked inventory group must be a weight-tracked group (kg/g)");
        }
        const partIdNew = await ctx.db.insert("parts", {
          groupId: inventoryGroupId,
          tag: `SPOOL-${spool.material}-${colorName.trim().slice(0, 12).toUpperCase()}-${Date.now() % 1000}`,
          status: "available",
          note: `Print-farm spool: ${spool.material} ${colorName.trim()}`,
          amountRemaining: String(Number(spool.remainingG ?? spool.weightG)),
          lowAt: String(lowAtG ?? 0),
        });
        patch.partId = partIdNew;
        const units = await ctx.db
          .query("parts")
          .withIndex("by_group", (q: any) => q.eq("groupId", inventoryGroupId))
          .filter((q: any) => q.neq(q.field("deleted"), true))
          .collect();
        await ctx.db.patch(inventoryGroupId, {
          measureStock: String(
            Number(units.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0).toFixed(4)),
          ),
        });
      } else {
        patch.partId = undefined;
        patch.inventoryGroupId = undefined;
      }
      patch.inventoryGroupId = inventoryGroupId ?? undefined;
    }
    await ctx.db.patch(id, patch);
    return { ok: true };
  },
});

export const archiveFilament = mutation({
  args: { id: v.id("filaments") },
  handler: async (ctx, { id }) => {
    await requirePrinter(ctx);
    const spool = await ctx.db.get(id);
    if (!spool || spool.archived) throw new Error("Spool not found");
    const used = await ctx.db
      .query("printJobs")
      .filter((q) => q.eq(q.field("filamentId"), id))
      .filter((q) => q.eq(q.field("status"), "queued"))
      .first();
    if (used) throw new Error("A queued job still draws from this spool — reschedule it first");
    await ctx.db.patch(id, { archived: true });
    // Empty mirror units leave the inventory shelf too.
    if (spool.partId) {
      await ctx.db.patch(spool.partId, { deleted: true });
    }
    if (spool.inventoryGroupId) {
      const units = await ctx.db
        .query("parts")
        .withIndex("by_group", (q: any) => q.eq("groupId", spool.inventoryGroupId))
        .filter((q: any) => q.neq(q.field("deleted"), true))
        .collect();
      await ctx.db.patch(spool.inventoryGroupId, {
        measureStock: String(
          Number(units.reduce((s: number, p: any) => s + Number(p.amountRemaining ?? 0), 0).toFixed(4)),
        ),
      });
    }
    return { ok: true };
  },
});

// ===== Print jobs =====

export const listJobs = action({
  args: {},
  handler: async (ctx) => {
    await requireActionPrinter(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const rows = await db.query<Doc<"printJobs">>("printJobs").collect();
    const out = [];
    for (const j of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const requester = await db.get<Doc<"users">>(j.requesterId);
      out.push({
        ...j,
        requesterName: requester?.name ?? requester?.email ?? "Member",
      });
    }
    return out;
  },
});

export const farmStats = action({
  args: {},
  handler: async (ctx) => {
    await requireActionPrinter(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const printers = await db.query<Doc<"printers">>("printers").filter((q) => q.neq(q.field("deleted"), true)).collect();
    const jobs = await db.query<Doc<"printJobs">>("printJobs").collect();
    const spools = await db.query<Doc<"filaments">>("filaments").collect();
    const activeSpools = spools.filter((s) => !s.archived);
    return {
      printers: printers.length,
      printing: printers.filter((p) => p.status === "printing").length,
      maintenance: printers.filter((p) => p.status === "maintenance").length,
      queue: jobs.filter((j) => j.status === "queued").length,
      active: jobs.filter((j) => j.status === "printing").length,
      done: jobs.filter((j) => j.status === "done").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      spools: activeSpools.length,
      lowFilaments: activeSpools.filter(
        (s) => s.lowAtG !== undefined && Number(s.remainingG) <= s.lowAtG,
      ).length,
    };
  },
});

/** Any signed-in, approved member can submit a print request. */
export const createJob = mutation({
  args: {
    name: v.string(),
    details: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileSizeKb: v.optional(v.number()),
    estWeightG: v.optional(v.number()),
    estMinutes: v.optional(v.number()),
    needSlicing: v.optional(v.boolean()),
    slicingNote: v.optional(v.string()),
  },
  handler: async (ctx, { name, details, fileName, fileSizeKb, estWeightG, estMinutes, needSlicing, slicingNote }) => {
    const me = await requireInteractingMember(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("Name the part");
    const id = await ctx.db.insert("printJobs", {
      requesterId: me._id,
      name: clean,
      details: details?.trim(),
      fileName: fileName?.trim(),
      estWeightG,
      estMinutes,
      status: "pending",
      priority: "normal",
      needSlicing: needSlicing ? true : undefined,
      slicingNote: slicingNote?.trim(),
      createdAt: Date.now(),
    });
    await telegramGroup(
      ctx,
      `🧾 ${me.name ?? me.email} requested a print: “${clean}”${fileName ? ` (${fileName}${fileSizeKb ? `, ${fileSizeKb} KB` : ""})` : ""}${estWeightG ? ` · ~${estWeightG} g` : ""}${needSlicing ? " — needs help slicing" : ""}. Awaiting review.`,
      undefined,
      "printers",
    );
    return id;
  },
});

/**
 * Slicer-Studio submission: stats + the full settings snapshot (as JSON in the
 * note) — never the G-code itself. Lands in the same review pipeline.
 */
export const submitSlicedJob = mutation({
  args: {
    name: v.string(),
    note: v.optional(v.string()),
    grams: v.optional(v.number()),
    minutes: v.optional(v.number()),
    deviceName: v.optional(v.string()),
    snapshot: v.optional(
      v.object({
        groups: v.array(
          v.object({
            id: v.string(),
            title: v.string(),
            rows: v.array(v.object({ label: v.string(), value: v.string() })),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, { name, note, grams, minutes, deviceName, snapshot }) => {
    const me = await requirePrinter(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("Name the part");
    const details = [
      deviceName ? `Sliced for: ${deviceName}` : null,
      grams ? `Est. filament: ${grams} g` : null,
      minutes ? `Est. duration: ${minutes} min` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const id = await ctx.db.insert("printJobs", {
      requesterId: me._id,
      name: clean,
      details: [details, note?.trim()].filter(Boolean).join("\n\n") || undefined,
      estWeightG: grams,
      estMinutes: minutes,
      status: "pending",
      priority: "normal",
      createdAt: Date.now(),
    });
    await telegramGroup(
      ctx,
      `🔪 ${me.name ?? me.email} submitted a sliced job: “${clean}”${deviceName ? ` for ${deviceName}` : ""}${grams ? ` · ~${grams} g` : ""}. Awaiting review.`,
      undefined,
      "printers",
    );
    return id;
  },
});

/** Transient blob upload for the G-code relay — the file never persists. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireInteractingMember(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const approveJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, note }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (job.status !== "pending") throw new Error("This request was already handled");
    await ctx.db.patch(jobId, {
      status: job.needSlicing ? "need_slicing" : "approved",
      approvedBy: me._id,
      denialNote: note?.trim() || undefined,
    });
    const ref = await memberRef(ctx, job.requesterId);
    await telegramPrinterDM(
      ctx,
      ref,
      `✅ Your print request “${job.name}” was approved — next comes scheduling on the queue.`,
    );
    await telegramGroup(
      ctx,
      `✅ ${me.name ?? me.email} approved the print request “${job.name}” (${job.requesterId === me._id ? "own" : "member"}).`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

export const denyJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, note }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (job.status !== "pending") throw new Error("This request was already handled");
    await ctx.db.patch(jobId, {
      status: "denied",
      approvedBy: me._id,
      denialNote: note?.trim() || undefined,
    });
    const ref = await memberRef(ctx, job.requesterId);
    await telegramPrinterDM(
      ctx,
      ref,
      `❌ Your print request “${job.name}” was denied${note?.trim() ? `: ${note.trim()}` : ""}.`,
    );
    return { ok: true };
  },
});

export const claimSlicing = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (job.status !== "need_slicing") throw new Error("This job is not waiting for slicing");
    await ctx.db.patch(jobId, { status: "slicing", slicingBy: me._id });
    await telegramGroup(
      ctx,
      `🧑‍🔧 ${me.name ?? me.email} took the slicing task for “${job.name}”.`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

export const scheduleJob = mutation({
  args: {
    jobId: v.id("printJobs"),
    printerId: v.id("printers"),
    filamentId: v.id("filaments"),
    weightG: v.number(),
    minutes: v.number(),
  },
  handler: async (ctx, { jobId, printerId, filamentId, weightG, minutes }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (!["approved", "slicing"].includes(job.status)) {
      throw new Error("Only approved (or claimed-slicing) jobs can be scheduled");
    }
    const printer = await ctx.db.get(printerId);
    if (!printer || printer.deleted) throw new Error("Printer not found");
    if (printer.status === "maintenance" || printer.status === "offline") {
      throw new Error("That printer is under maintenance or offline");
    }
    const spool = await ctx.db.get(filamentId);
    if (!spool || spool.archived) throw new Error("Spool not found");
    if (!Number.isFinite(weightG) || weightG <= 0) throw new Error("Set the filament weight (g)");
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Set the print duration (min)");
    if (weightG > Number(spool.remainingG)) {
      throw new Error(`The spool only has ${spool.remainingG} g left — pick a full one`);
    }
    const queued = await ctx.db
      .query("printJobs")
      .withIndex("by_printer", (q) => q.eq("printerId", printerId))
      .collect();
    if (queued.filter((j) => j.status === "queued").length >= MAX_QUEUE_PER_PRINTER) {
      throw new Error("That printer's queue is full");
    }
    const queuePos = await nextQueuePos(ctx, printerId);
    await ctx.db.patch(jobId, {
      status: "queued",
      printerId,
      filamentId,
      weightG,
      minutes,
      queuePos,
    });
    await telegramGroup(
      ctx,
      `📆 “${job.name}” scheduled on ${printer.name} (#${queuePos} in queue) — ${weightG} g of ${spool.colorName}, ~${Math.round(minutes / 60)} h.`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

export const startPrint = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (job.status !== "queued") throw new Error("Only queued jobs can be started");
    const printer = job.printerId ? await ctx.db.get(job.printerId) : null;
    if (!printer) throw new Error("The job has no printer");
    const current = await ctx.db
      .query("printJobs")
      .withIndex("by_printer", (q: any) => q.eq("printerId", printer._id))
      .collect();
    if (current.some((j: any) => j.status === "printing")) {
      throw new Error("That printer is already printing — finish the current job first");
    }
    const now = Date.now();
    await ctx.db.patch(jobId, { status: "printing", startedAt: now, operatedBy: me._id });
    await ctx.db.patch(printer._id, { status: "printing" });
    // Queue positions shift up.
    await repackQueue(ctx, printer._id);
    await telegramGroup(
      ctx,
      `▶️ “${job.name}” started on ${printer.name}${job.weightG ? ` (${job.weightG} g)` : ""}.`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

export const completePrint = mutation({
  args: {
    jobId: v.id("printJobs"),
    weightG: v.number(),
    minutes: v.number(),
  },
  handler: async (ctx, { jobId, weightG, minutes }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (job.status !== "printing") throw new Error("Only a printing job can be finished");
    if (!Number.isFinite(weightG) || weightG <= 0) throw new Error("Set the real filament used (g)");
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Set the real duration (min)");
    if (job.filamentId) await deductSpool(ctx, job.filamentId, weightG);
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: "done",
      finishedAt: now,
      weightG,
      minutes,
      operatedBy: me._id,
    });
    const printer = job.printerId ? await ctx.db.get(job.printerId) : null;
    if (printer) {
      const remaining = await ctx.db
        .query("printJobs")
        .withIndex("by_printer", (q: any) => q.eq("printerId", printer._id))
        .collect();
      await ctx.db.patch(printer._id, {
        status: remaining.some((j: any) => j._id !== jobId && j.status === "printing") ? "printing" : "idle",
      });
    }
    const spool = job.filamentId ? await ctx.db.get(job.filamentId) : null;
    const low = spool?.lowAtG !== undefined && Number(spool.remainingG) <= spool.lowAtG;
    await telegramGroup(
      ctx,
      `🏁 “${job.name}” finished on ${printer?.name ?? "?"} — ${weightG} g, ${Math.round(minutes)} min.${spool ? ` Spool ${spool.colorName}: ${spool.remainingG} g left${low ? " ⚠️ LOW" : ""}.` : ""}`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

export const failPrint = mutation({
  args: {
    jobId: v.id("printJobs"),
    reason: v.string(),
  },
  handler: async (ctx, { jobId, reason }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (job.status !== "printing" && job.status !== "queued") {
      throw new Error("Only a printing/queued job can be marked failed");
    }
    const clean = reason.trim();
    if (!clean) throw new Error("Describe what went wrong");
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: "failed",
      finishedAt: now,
      failureNote: clean,
      operatedBy: me._id,
    });
    const printer = job.printerId ? await ctx.db.get(job.printerId) : null;
    if (printer) {
      await ctx.db.patch(printer._id, { status: "maintenance" });
      await ctx.db.insert("printerMaintenance", {
        printerId: printer._id,
        kind: "repair",
        text: `Failed print “${job.name}”: ${clean}`.slice(0, 400),
        byUserId: me._id,
        at: now,
      });
      await repackQueue(ctx, printer._id);
    }
    // No deduction: failed prints don't consume counted filament.
    await telegramGroup(
      ctx,
      `⚠️ “${job.name}” failed on ${printer?.name ?? "?"}: ${clean} — printer to maintenance, ${job.weightG ?? "?"} g not deducted.`,
      undefined,
      "printers",
    );
    return { ok: true };
  },
});

export const cancelJob = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    const me = await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    const canCancel =
      job.requesterId === me._id || hasPrinterPrivilege(me);
    if (!canCancel) throw new Error("Not your request");
    if (!["pending", "approved", "need_slicing", "slicing", "queued"].includes(job.status)) {
      throw new Error("This job is already finished or printing");
    }
    if (job.status === "queued" && !hasPrinterPrivilege(me)) {
      throw new Error("Queued jobs are canceled by the printer crew");
    }
    await ctx.db.patch(jobId, { status: "canceled" });
    if (job.printerId && job.status === "queued") {
      await repackQueue(ctx, job.printerId);
    }
    return { ok: true };
  },
});

export const archiveJob = mutation({
  args: { jobId: v.id("printJobs") },
  handler: async (ctx, { jobId }) => {
    await requirePrinter(ctx);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Print job not found");
    if (!["done", "failed", "canceled", "denied"].includes(job.status)) {
      throw new Error("Only finished jobs can be archived");
    }
    await ctx.db.patch(jobId, { archivedAt: Date.now() });
    return { ok: true };
  },
});

// ===== Cron: overdue print sweep =====

/**
 * Every 15 min: prints running past 2× their planned duration (min 60 min)
 * get flagged to the printer group once. Nothing is auto-canceled — the crew
 * decides; the flag just stops silent all-night prints.
 */
export const sweepOverduePrints = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("printJobs")
      .withIndex("by_status", (q) => q.eq("status", "printing"))
      .collect();
    const now = Date.now();
    let flagged = 0;
    for (const job of rows) {
      const started = job.startedAt ?? job.createdAt;
      const planMin = job.minutes ?? 60;
      const overdueAfterMs = Math.max(60, planMin * 2) * 60_000;
      if (now - started < overdueAfterMs) continue;
      if (job.failureNote?.startsWith("overdue:")) continue; // already flagged
      const printer = job.printerId ? await ctx.db.get(job.printerId) : null;
      await ctx.db.patch(job._id, {
        failureNote: `overdue: running ${Math.round((now - started) / 60_000)} min (planned ${planMin})`,
      });
      await telegramGroup(
        ctx,
        `⏰ “${job.name}” on ${printer?.name ?? "?"} is overdue — running ${Math.round((now - started) / 60_000)} min vs planned ${planMin}. Check the machine.`,
        undefined,
        "printers",
      );
      flagged += 1;
    }
    return { flagged };
  },
});
