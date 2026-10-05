import { v } from "convex/values";
import { action, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireNonStudent, safeImage } from "./lib";
import { requireActionNonStudent, type AuthUserDoc } from "./authActions";
import { loadTurso } from "./tursoDb";
import type { BridgeDb } from "../lib/turso-bridge";
import { telegramDM } from "./notify";
import { diffLines, diffStat, mergeLines, type RowDecision } from "../lib/lineDiff";

/**
 * Project README — the GitHub-style front page of every project.
 *
 * Permissions (mirrors the workspace RBAC):
 *  - students/guests are blocked (requireNonStudent);
 *  - every assigned member can VIEW and EDIT;
 *  - the project LEAD and club ADMINS save directly;
 *  - any other member's Save becomes an edit REQUEST, reviewed in split view
 *    by the lead and admins (per-line approve/edit/reject with notes);
 *  - every change is recorded in `readmeHistory` for all members to see.
 */

const MAX_CONTENT = 400_000; // characters — a big README, well under row limits

type Access = {
  user: { _id: Id<"users">; name?: string; email?: string; role?: string };
  project: { _id: Id<"projects">; name: string; deleted?: boolean };
  mine: { role: "leader" | "member" } | null;
  isAdmin: boolean;
  isLeader: boolean;
  /** Assigned member (or admin) — may view + edit. */
  isMember: boolean;
  /** Lead/admin — their saves apply immediately. */
  canDirectSave: boolean;
  /** Lead/admin — may review other members' edit requests. */
  canReview: boolean;
};

async function projectAccess(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<Access> {
  const user = await requireNonStudent(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.deleted) throw new Error("Project not found");
  const rows = await ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  // ACTIVE membership only: ex-members / previous teams keep read history
  // (the history query is not gated by isMember) but cannot edit or review.
  const mine = rows.find((m) => m.projectId === projectId && !m.leftAt) ?? null;
  const isAdmin = user.role === "admin";
  const isLeader = mine?.role === "leader";
  return {
    user,
    project,
    mine,
    isAdmin,
    isLeader: !!isLeader,
    isMember: isAdmin || !!mine,
    canDirectSave: isAdmin || !!isLeader,
    canReview: isAdmin || !!isLeader,
  };
}

async function loadReadme(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  return ctx.db
    .query("projectReadmes")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
}

async function userName(ctx: QueryCtx | MutationCtx, id: Id<"users">) {
  const u = await ctx.db.get(id);
  return u?.name ?? u?.email ?? "Member";
}

/** Avatar for the editor/submitter chip shown next to the name. */
async function userAvatar(ctx: QueryCtx | MutationCtx, id: Id<"users">) {
  const u = await ctx.db.get(id);
  return safeImage(u?.image);
}

// ---- Turso twins of the helpers above (used by the converted actions) ----

async function projectAccessDb(
  db: BridgeDb,
  user: AuthUserDoc,
  projectId: Id<"projects">,
): Promise<Access> {
  const project = await db.get<Doc<"projects">>(projectId);
  if (!project || project.deleted) throw new Error("Project not found");
  const rows = await db
    .query<Doc<"projectMembers">>("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  const mine = rows.find((m) => m.projectId === projectId && !m.leftAt) ?? null;
  const isAdmin = user.role === "admin";
  const isLeader = mine?.role === "leader";
  return {
    user,
    project,
    mine: mine ? { role: mine.role } : null,
    isAdmin,
    isLeader: !!isLeader,
    isMember: isAdmin || !!mine,
    canDirectSave: isAdmin || !!isLeader,
    canReview: isAdmin || !!isLeader,
  };
}

async function loadReadmeDb(db: BridgeDb, projectId: Id<"projects">) {
  return db
    .query<Doc<"projectReadmes">>("projectReadmes")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
}

async function userNameDb(db: BridgeDb, id: Id<"users">) {
  const u = await db.get<Doc<"users">>(id);
  return u?.name ?? u?.email ?? "Member";
}

async function userAvatarDb(db: BridgeDb, id: Id<"users">) {
  const u = await db.get<Doc<"users">>(id);
  return safeImage(u?.image);
}

const decisionValidator = v.array(
  v.object({
    row: v.number(),
    approve: v.boolean(),
    replacement: v.optional(v.string()),
    note: v.optional(v.string()),
  }),
);

// ---------- queries ----------

/** README document + my permissions + pending edit requests for this project. */
export const get = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await requireActionNonStudent(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const access = await projectAccessDb(db, user, projectId);
    const doc = await loadReadmeDb(db, projectId);
    const pendingRows = await db
      .query<Doc<"readmeEditRequests">>("readmeEditRequests")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const pending: {
      _id: Id<"readmeEditRequests">;
      submittedBy: Id<"users">;
      submitterName: string;
      submitterImage?: string;
      requestedAt: number;
      note?: string;
      baseVersion: number;
      isMine: boolean;
    }[] = [];
    for (const r of pendingRows) {
      if (r.status !== "pending") continue;
      pending.push({
        _id: r._id,
        submittedBy: r.submittedBy,
        submitterName: await userNameDb(db, r.submittedBy),
        submitterImage: await userAvatarDb(db, r.submittedBy),
        requestedAt: r.requestedAt,
        note: r.note,
        baseVersion: r.baseVersion,
        isMine: r.submittedBy === access.user._id,
      });
    }
    pending.sort((a, b) => b.requestedAt - a.requestedAt);
    return {
      content: doc?.content ?? "",
      version: doc?.version ?? 0,
      updatedAt: doc?.updatedAt ?? 0,
      updatedByName: doc ? await userNameDb(db, doc.updatedBy) : null,
      updatedByImage: doc ? await userAvatarDb(db, doc.updatedBy) : null,
      canEdit: access.isMember,
      canDirectSave: access.canDirectSave,
      canReview: access.canReview,
      pending,
    };
  },
});

/** One pending request with its diff snapshots — used by the review dialog. */
export const getRequest = action({
  args: { requestId: v.id("readmeEditRequests") },
  handler: async (ctx, { requestId }) => {
    const user = await requireActionNonStudent(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const req = await db.get<Doc<"readmeEditRequests">>(requestId);
    if (!req) return null;
    const access = await projectAccessDb(db, user, req.projectId);
    if (!access.isMember) throw new Error("You are not assigned to this project");
    return {
      _id: req._id,
      projectId: req.projectId,
      status: req.status,
      baseContent: req.baseContent,
      proposedContent: req.proposedContent,
      baseVersion: req.baseVersion,
      note: req.note,
      requestedAt: req.requestedAt,
      submittedBy: req.submittedBy,
      submitterName: await userNameDb(db, req.submittedBy),
      submitterImage: await userAvatarDb(db, req.submittedBy),
      canReview: access.canReview && req.submittedBy !== access.user._id,
    };
  },
});

/** Full README history — visible to every assigned member. */
export const history = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await requireActionNonStudent(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    await projectAccessDb(db, user, projectId);
    const entries = await db
      .query<Doc<"readmeHistory">>("readmeHistory")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
    const ids = new Set<string>();
    for (const e of entries) {
      ids.add(e.editedBy);
      if (e.reviewerId) ids.add(e.reviewerId);
    }
    const names = new Map<string, string>();
    const images = new Map<string, string | undefined>();
    await Promise.all(
      [...ids].map(async (id) => {
        const u = await db.get<Doc<"users">>(id as Id<"users">);
        names.set(id, u?.name ?? u?.email ?? "Member");
        images.set(id, safeImage(u?.image));
      }),
    );
    return entries.map((e) => ({
      _id: e._id,
      at: e.at,
      source: e.source,
      outcome: e.outcome ?? null,
      content: e.content,
      editedByName: names.get(e.editedBy) ?? "Member",
      editedByImage: images.get(e.editedBy) ?? null,
      reviewerName: e.reviewerId ? (names.get(e.reviewerId) ?? "Member") : null,
      reviewerImage: e.reviewerId ? (images.get(e.reviewerId) ?? null) : null,
      requestId: e.requestId ?? null,
      added: e.added ?? 0,
      removed: e.removed ?? 0,
      changed: e.changed ?? 0,
      rejectNotes: e.rejectNotes ?? [],
    }));
  },
});

/**
 * Pending README edit requests visible in the Requests console:
 * site admins see all, a project lead sees the projects they lead.
 */
export const pendingAll = action({
  args: {},
  handler: async (ctx) => {
    const user = await requireActionNonStudent(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    let pending = await db
      .query<Doc<"readmeEditRequests">>("readmeEditRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (user.role !== "admin") {
      const memberships = await db
        .query<Doc<"projectMembers">>("projectMembers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const led = new Set(
        memberships
          .filter((m) => m.role === "leader" && !m.leftAt)
          .map((m) => String(m.projectId)),
      );
      pending = pending.filter((r) => led.has(String(r.projectId)));
    }
    const rows = await Promise.all(
      pending.map(async (r) => {
        const project = await db.get<Doc<"projects">>(r.projectId);
        if (!project || project.deleted) return null;
        const submitter = await db.get<Doc<"users">>(r.submittedBy);
        return {
          _id: r._id,
          projectId: r.projectId,
          projectName: project.name,
          submittedByName: submitter?.name ?? submitter?.email ?? "Member",
          submittedByImage: safeImage(submitter?.image),
          submittedByEmail: submitter?.email ?? "",
          requestedAt: r.requestedAt,
          note: r.note,
          baseVersion: r.baseVersion,
        };
      }),
    );
    return rows
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.requestedAt - a.requestedAt);
  },
});

// ---------- mutations ----------

/** Save the README: lead/admin apply instantly; other members open a request. */
export const save = mutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, content, note }) => {
    const access = await projectAccess(ctx, projectId);
    if (!access.isMember) throw new Error("Only assigned project members can edit the README");
    if (content.length > MAX_CONTENT) {
      throw new Error(`README is too large (max ${MAX_CONTENT.toLocaleString()} characters)`);
    }
    const now = Date.now();
    const doc = await loadReadme(ctx, projectId);
    const prev = doc?.content ?? "";

    if (access.canDirectSave) {
      const version = (doc?.version ?? 0) + 1;
      if (doc) {
        await ctx.db.patch(doc._id, {
          content,
          version,
          updatedBy: access.user._id,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("projectReadmes", {
          projectId,
          content,
          version: 1,
          updatedBy: access.user._id,
          updatedAt: now,
        });
      }
      const stat = diffStat(diffLines(prev, content));
      await ctx.db.insert("readmeHistory", {
        projectId,
        content,
        source: "direct",
        editedBy: access.user._id,
        at: now,
        added: stat.added,
        removed: stat.removed,
        changed: stat.changed,
      });
      return { mode: "direct" as const };
    }

    // Regular member → replace their own pending request or create one.
    const existing = await ctx.db
      .query("readmeEditRequests")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const own = existing.find(
      (r) => r.status === "pending" && r.submittedBy === access.user._id,
    );
    if (own) {
      await ctx.db.patch(own._id, {
        baseVersion: doc?.version ?? 0,
        baseContent: prev,
        proposedContent: content,
        note: note?.trim() || undefined,
        requestedAt: now,
      });
      return { mode: "request" as const, requestId: own._id };
    }
    const requestId = await ctx.db.insert("readmeEditRequests", {
      projectId,
      baseVersion: doc?.version ?? 0,
      baseContent: prev,
      proposedContent: content,
      note: note?.trim() || undefined,
      submittedBy: access.user._id,
      requestedAt: now,
      status: "pending",
    });
    // Tell the reviewers it exists: in-app feed + OS push to every admin
    // device (only for NEW requests — re-saving an own pending one is silent).
    const who = access.user.name ?? access.user.email ?? "A member";
    const body = `${who} wants to edit the ${access.project.name} README`;
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "readme_request",
      text: body,
      link: "/admin/requests?tab=readme",
    });
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "README edit request",
      body,
      tag: "roboshelf-readme",
      url: "/admin/requests?tab=readme",
    });
    return { mode: "request" as const, requestId };
  },
});

/** Withdraw your own pending request. */
export const cancel = mutation({
  args: { requestId: v.id("readmeEditRequests") },
  handler: async (ctx, { requestId }) => {
    const user = await requireNonStudent(ctx);
    const req = await ctx.db.get(requestId);
    if (!req || req.status !== "pending") throw new Error("Request not found");
    if (req.submittedBy !== user._id) throw new Error("You can only withdraw your own request");
    await ctx.db.delete(requestId);
    return { ok: true };
  },
});

/**
 * Tell the SUBMITTER how their request went: OS push always, Telegram DM
 * when they linked the club bot (matches the other decision flows).
 */
async function notifyReviewOutcome(
  ctx: MutationCtx,
  req: { projectId: Id<"projects">; submittedBy: Id<"users"> },
  reviewer: { name?: string; email?: string },
  outcome: "approved" | "partial" | "denied",
): Promise<void> {
  const submitter = await ctx.db.get(req.submittedBy);
  if (!submitter) return;
  const project = await ctx.db.get(req.projectId);
  const projectName = project?.name ?? "the project";
  const reviewerName = reviewer.name ?? reviewer.email ?? "your lead";
  const title =
    outcome === "denied"
      ? "README edits declined"
      : outcome === "partial"
        ? "README edits partly approved"
        : "README edits approved";
  const detail =
    outcome === "denied"
      ? `Nothing was applied — ${reviewerName} left feedback on your request.`
      : outcome === "partial"
        ? `Some lines are now live on the ${projectName} README — the rest have feedback.`
        : `Your changes are now live on the ${projectName} README.`;
  await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
    userId: submitter._id,
    title,
    body: detail,
    tag: "roboshelf-readme",
    url: `/projects/${req.projectId}?tab=readme`,
  });
  if (submitter.telegramChatId || submitter.telegramUsername) {
    await telegramDM(
      ctx,
      {
        name: submitter.name ?? submitter.email,
        telegramChatId: submitter.telegramChatId,
        telegramUsername: submitter.telegramUsername,
      },
      `📝 ${title}: ${detail}`,
      { name: reviewer.name ?? reviewer.email },
      "projects",
    );
  }
}

/**
 * Review an edit request with per-line decisions. The server recomputes the
 * diff from the stored snapshots (never trusts client row indices blindly),
 * merges approved lines (including reviewer-edited replacements), stores the
 * rejection notes and writes the history entry.
 */
export const review = mutation({
  args: { requestId: v.id("readmeEditRequests"), decisions: decisionValidator },
  handler: async (ctx, { requestId, decisions }) => {
    const req = await ctx.db.get(requestId);
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("This request was already reviewed");
    const access = await projectAccess(ctx, req.projectId);
    if (!access.canReview) throw new Error("Only the project lead or an admin can review");
    if (req.submittedBy === access.user._id) throw new Error("You cannot review your own request");

    const rows = diffLines(req.baseContent, req.proposedContent);
    const map: Record<number, RowDecision> = {};
    for (const d of decisions) {
      if (d.row < 0 || d.row >= rows.length || rows[d.row].type === "same") continue;
      map[d.row] = { approve: d.approve, replacement: d.replacement, note: d.note };
    }
    const merged = mergeLines(req.baseContent, rows, map);
    const now = Date.now();
    const rejectNotes = merged.rejected.map((r) => ({
      line: r.row.index,
      text: r.row.newLine ?? r.row.baseLine ?? "",
      note: r.note,
    }));
    const decisionRows = Object.entries(map).map(([row, d]) => ({
      row: Number(row),
      approve: d.approve !== false,
      replacement: d.replacement,
      note: d.note,
    }));

    if (merged.applied === 0) {
      // Nothing approved → the request is denied, the README stays as-is.
      await ctx.db.patch(requestId, {
        status: "denied",
        decidedAt: now,
        decidedBy: access.user._id,
        decisions: decisionRows,
      });
      const doc = await loadReadme(ctx, req.projectId);
      await ctx.db.insert("readmeHistory", {
        projectId: req.projectId,
        content: doc?.content ?? "",
        source: "reviewed",
        outcome: "denied",
        editedBy: req.submittedBy,
        reviewerId: access.user._id,
        at: now,
        requestId,
        added: 0,
        removed: 0,
        changed: 0,
        rejectNotes,
      });
      await notifyReviewOutcome(ctx, req, access.user, "denied");
      return { outcome: "denied" as const };
    }

    // Apply the merged text to the README.
    const doc = await loadReadme(ctx, req.projectId);
    const version = (doc?.version ?? 0) + 1;
    if (doc) {
      await ctx.db.patch(doc._id, {
        content: merged.text,
        version,
        updatedBy: access.user._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("projectReadmes", {
        projectId: req.projectId,
        content: merged.text,
        version: 1,
        updatedBy: access.user._id,
        updatedAt: now,
      });
    }
    const stat = diffStat(diffLines(doc?.content ?? "", merged.text));
    const outcome = rejectNotes.length > 0 ? ("partial" as const) : ("approved" as const);
    await ctx.db.patch(requestId, {
      status: "approved",
      decidedAt: now,
      decidedBy: access.user._id,
      decisions: decisionRows,
      finalContent: merged.text,
    });
    await ctx.db.insert("readmeHistory", {
      projectId: req.projectId,
      content: merged.text,
      source: "reviewed",
      outcome,
      editedBy: req.submittedBy,
      reviewerId: access.user._id,
      at: now,
      requestId,
      added: stat.added,
      removed: stat.removed,
      changed: stat.changed,
      rejectNotes,
    });
    await notifyReviewOutcome(ctx, req, access.user, outcome);
    return { outcome };
  },
});
