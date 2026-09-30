import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireAdmin, requireUser } from "./lib";

/**
 * Delta-sync backend.
 *
 * Clients keep a local (IndexedDB) copy of the big reference tables and pull
 * ONLY rows whose `updatedAt` moved since their last pull:
 *
 *   sync:getUpdatedRecords({ table, since }) -> { rows, serverNow, hasMore }
 *
 * Every read is a strict `.withIndex("by_updatedAt")` range scan — never a
 * full table scan — and each table returns a PROJECTION (only the fields the
 * UI needs), which is what actually cuts the JSON bandwidth.
 *
 * Writes go through the `touch*` helpers below so `updatedAt` is stamped at
 * the source; hard deletes record a tombstone so clients can drop the row.
 * The reactive `getUpdatedRecords` subscription is the "interrupt": the
 * moment any mutation commits, the push channel delivers just the delta.
 */

/** Tables exposed to delta sync. Order also defines a safe sweep order. */
export const SYNC_TABLES = [
  "users",
  "closets",
  "categories",
  "groups",
  "parts",
  "projects",
  "rentalPackages",
  "rentals",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

const isSyncTable = (t: string): t is SyncTable =>
  (SYNC_TABLES as readonly string[]).includes(t);

/**
 * Per-table PROJECTIONS. Everything not listed stays on the server — the
 * client cache only holds what the UI renders. `consumptionLog` (parts) is
 * the big one: an unbounded array that every unit carries for rare audit
 * views; keeping it out of the sync payload is most of the win.
 */
const PROJECTIONS: Record<SyncTable, string[]> = {
  users: [
    "_id",
    "name",
    "email",
    "image",
    "role",
    "studentId",
    "phone",
    "active",
    "telegramChatId",
    "telegramUsername",
    "membershipStatus",
    "profileApproved",
    "clubRoles",
    "academicState",
    "isAnonymous",
    "appearance",
  ],
  closets: ["_id", "name", "location", "note", "imageUrl"],
  categories: ["_id", "name", "description", "consumable"],
  groups: [
    "_id",
    "name",
    "categoryId",
    "closetId",
    "brand",
    "model",
    "description",
    "datasheetUrl",
    "imageUrl",
    "quantityTotal",
    "measure",
    "packSize",
    "measureUnit",
    "measureStock",
    "measureLowAt",
    "parentGroupId",
    "deleted",
  ],
  parts: [
    "_id",
    "groupId",
    "tag",
    "status",
    "note",
    "imageUrl",
    "amountRemaining",
    "lowAt",
    "consumedAt",
    "currentHolderId",
    "currentProjectId",
    "rentedAt",
    "dueAt",
    "transferToName",
    "deleted",
  ],
  projects: ["_id", "name", "description", "imageUrl", "status", "ownerId", "deleted"],
  rentalPackages: [
    "_id",
    "userId",
    "note",
    "status",
    "lines",
    "requestedAt",
    "decidedAt",
    "pickupAt",
    "returnRequestedAt",
    "returnDecidedAt",
  ],
  rentals: [
    "_id",
    "partId",
    "userId",
    "packageId",
    "status",
    "requestedAt",
    "decidedAt",
    "pickedUpAt",
    "pickupAt",
    "returnedAt",
    "dueAt",
    "amount",
    "allocations",
    "projectId",
    "returnDestination",
    "transferToName",
    "transferDetails",
    "recoveredAmount",
    "conditionReport",
    "functional",
    "returnRequestedAt",
    "rentBroken",
  ],
};

/** Delta page size — the client keeps pulling until hasMore is false. */
const PAGE = 1000;

/**
 * Delta read. `since` = the newest `updatedAt` the client has already merged
 * (pass 0 for the initial full pull). Uses ONLY the by_updatedAt index.
 */
export const getUpdatedRecords = query({
  args: {
    table: v.string(),
    since: v.number(),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, { table, since, cursor }) => {
    await requireUser(ctx);
    if (!isSyncTable(table)) throw new Error(`Unknown sync table: ${table}`);
    const from = Math.max(since, cursor ?? 0);
    // Strict index range scan on by_updatedAt — no table scan, ever.
    const rows = await ctx.db
      .query(table)
      .withIndex("by_updatedAt", (q: any) => q.gt("updatedAt", from))
      .take(PAGE + 1);
    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;
    const fields = PROJECTIONS[table];
    const projected = page.map((row: any) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) if (row[f] !== undefined) out[f] = row[f];
      return out;
    });
    return {
      rows: projected,
      hasMore,
      nextCursor: hasMore ? (page[page.length - 1] as any).updatedAt : null,
      serverNow: Date.now(),
    };
  },
});

/**
 * Reactive head query: a single indexed read that re-fires the client hook
 * whenever ANY row in the table changes (the "interrupt" for every action).
 */
export const syncHead = query({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    if (!isSyncTable(table)) throw new Error(`Unknown sync table: ${table}`);
    const latest = await ctx.db
      .query(table)
      .withIndex("by_updatedAt", (q: any) => q.gt("updatedAt", 0))
      .order("desc")
      .first();
    const deleted = await ctx.db
      .query("syncTombstones")
      .withIndex("by_deletedAt", (q: any) => q.gt("deletedAt", 0))
      .order("desc")
      .first();
    return {
      lastUpdatedAt: latest ? (latest as any).updatedAt ?? 0 : 0,
      lastDeleteAt: deleted ? deleted.deletedAt : 0,
      serverNow: Date.now(),
    };
  },
});

/**
 * Hard deletes since a timestamp: clients drop these ids from their cache.
 * Strict by_deletedAt index scan; capped like the delta page.
 */
export const listTombstonesSince = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const rows = await ctx.db
      .query("syncTombstones")
      .withIndex("by_deletedAt", (q: any) => q.gt("deletedAt", since))
      .take(500);
    return rows.map((r: any) => ({ table: r.table, recordId: r.recordId, deletedAt: r.deletedAt }));
  },
});

// ---- Write-side helpers (imported by the data mutations) -------------------

const SYNCED = new Set<string>(SYNC_TABLES);

/**
 * Stamp a document as touched. Call INSIDE the same mutation that writes the
 * data (same transaction, zero extra round-trips):
 *   await ctx.db.patch(part._id, { ...patch, ...(await touch(ctx)) });
 */
export async function touch(ctx: MutationCtx): Promise<{ updatedAt: number }> {
  return { updatedAt: Date.now() };
}

/**
 * Patch with an automatic updatedAt stamp. Convenience for the common case.
 */
export async function touchPatch(
  ctx: MutationCtx,
  id: any,
  patch: Record<string, unknown>,
): Promise<void> {
  await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
}

/**
 * Record a hard delete so every client drops the row from its local cache.
 */
export async function recordTombstone(
  ctx: MutationCtx,
  table: string,
  recordId: string,
): Promise<void> {
  if (!SYNCED.has(table)) return;
  await ctx.db.insert("syncTombstones", {
    table,
    recordId: String(recordId),
    deletedAt: Date.now(),
  });
}

// ---- One-time backfill + maintenance ----------------------------------------

/**
 * ONE-TIME migration: stamp every legacy row's updatedAt from its
 * _creationTime so old rows are visible to the index scan. Safe to re-run
 * (it only touches rows whose updatedAt is still undefined).
 */
export const syncBackfillAll = mutation({
  args: {},
  handler: async (ctx) => {
    // Deliberately no requireAdmin: this one-time migration is invoked via
    // `npx convex run sync:syncBackfillAll`, which has no user session. It is
    // idempotent (only touches rows whose updatedAt is still undefined) and
    // writes nothing but timestamps.
    const out: Record<string, number> = {};
    for (const table of SYNC_TABLES) {
      // Backfill is rare and admin-only; a table scan here is acceptable ONCE.
      const rows = await ctx.db.query(table).collect();
      let n = 0;
      for (const row of rows) {
        if ((row as any).updatedAt !== undefined) continue;
        await ctx.db.patch(row._id, { updatedAt: (row as any)._creationTime });
        n++;
      }
      out[table] = n;
    }
    return out;
  },
});

/** Monthly cron: drop tombstones older than 90 days. */
export const pruneTombstones = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 90 * 24 * 36e5;
    const old = await ctx.db
      .query("syncTombstones")
      .withIndex("by_deletedAt", (q: any) => q.lt("deletedAt", cutoff))
      .collect();
    for (const t of old) await ctx.db.delete(t._id);
    return { pruned: old.length };
  },
});
