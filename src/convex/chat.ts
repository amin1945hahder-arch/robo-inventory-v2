import { v } from "convex/values";
import { internalMutation, mutation, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireAdmin, requireNonStudent, requireUser, safeImage } from "./lib";

/**
 * Chat relay backend.
 *
 * The database is a temporary pipe, not an archive. Messages are stored only
 * until every recipient has pulled them (and briefly after, for late
 * devices); each user's durable copy lives in their own IndexedDB. Nothing
 * here writes conversation content anywhere else, and a scheduled sweeper
 * keeps the relay tables tiny.
 */

const TYPING_TTL_MS = 6_000; // typing indicator expires after 6s of silence
const PRESENCE_TTL_MS = 60_000; // "online" window after the last heartbeat
const RELAY_TTL_MS = 12 * 60 * 60 * 1000; // sweep delivered messages after 12h
const ACKS_PAGE = 200;

// ---------- helpers ----------

async function dmKeyFor(ctx: QueryCtx, a: Id<"users">, b: Id<"users">) {
  return [a, b].sort().join(":");
}

async function getDmConversation(ctx: QueryCtx, key: string) {
  return ctx.db
    .query("chatConversations")
    .withIndex("by_dmKey", (q) => q.eq("dmKey", key))
    .first();
}

async function assertMembership(ctx: QueryCtx, convId: Id<"chatConversations">, userId: Id<"users">) {
  const conv = await ctx.db.get(convId);
  if (!conv || conv.deleted) throw new Error("Conversation not found");
  if (!conv.memberIds.some((m) => m === userId)) throw new Error("Not a member of this chat");
  return conv;
}

/** Recipients of a message = every member except the sender. */
function recipients(conv: { memberIds: Id<"users">[] }, senderId: Id<"users">) {
  return conv.memberIds.filter((m) => m !== senderId);
}

function minProfile(u: {
  name?: string;
  email?: string;
  image?: string;
  role?: string;
  lastSeenAt?: number;
} | null) {
  if (!u) return null;
  return { name: u.name, email: u.email, image: safeImage(u.image), role: u.role };
}

// ---------- user directory ----------

/** Everyone a user may chat with (any signed-in, non-anonymous person). */
export const listPeople = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => !u.isAnonymous)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        image: safeImage(u.image),
        role: u.role,
        clubRoles: u.clubRoles,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  },
});

// ---------- conversations ----------

/** All conversations the current user belongs to, with preview + counters. */
export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const all = await ctx.db.query("chatConversations").collect();
    const mine = all
      .filter((c) => !c.deleted && c.memberIds.some((m) => m === me._id))
      .sort((a, b) => (b.lastActivityAt ?? b._creationTime) - (a.lastActivityAt ?? a._creationTime));

    const out = [];
    for (const c of mine) {
      // Preview + unread estimate from the relay copy (best effort; the local
      // store is the source of truth once the device has synced).
      const recent = await ctx.db
        .query("chatMessages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
        .order("desc")
        .take(30);
      const visible = recent.filter((m) => !m.deletedForEveryone && !m.deletedForMe?.[me._id]);
      const last = visible[0];
      let lastSender = null;
      if (last) {
        const sender = await ctx.db.get(last.senderId);
        lastSender = sender ? { name: sender.name, image: safeImage(sender.image) } : null;
      }
      const unread = visible.filter(
        (m) => m.senderId !== me._id && !m.readBy.some((r) => r === me._id),
      ).length;

      const memberProfiles = [];
      for (const id of c.memberIds) {
        const u = await ctx.db.get(id);
        memberProfiles.push({
          _id: id,
          name: u?.name,
          email: u?.email,
          image: safeImage(u?.image),
          role: u?.role,
        });
      }
      out.push({
        _id: c._id,
        kind: c.kind,
        name: c.name,
        image: safeImage(c.image),
        projectId: c.projectId,
        createdBy: c.createdBy,
        memberIds: c.memberIds,
        memberProfiles,
        lastActivityAt: c.lastActivityAt ?? c._creationTime,
        preview: last
          ? {
              body: last.body,
              senderName: lastSender?.name ?? "Someone",
              senderImage: lastSender?.image,
              mine: last.senderId === me._id,
              at: last.createdAt,
              hasAttachment: Boolean(last.attachment),
            }
          : null,
        unread,
      });
    }
    return out;
  },
});

/** One conversation with full member profiles (chat header / group editor). */
export const getConversation = query({
  args: { id: v.id("chatConversations") },
  handler: async (ctx, { id }) => {
    const me = await requireUser(ctx);
    const conv = await assertMembership(ctx, id, me._id);
    const members = [];
    for (const mid of conv.memberIds) {
      const u = await ctx.db.get(mid);
      members.push({
        _id: mid,
        name: u?.name,
        email: u?.email,
        image: safeImage(u?.image),
        role: u?.role,
      });
    }
    return { conv, members };
  },
});

/** Find or create the 1-on-1 DM between me and another person. */
export const openDm = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireNonStudent(ctx);
    if (userId === me._id) throw new Error("You cannot DM yourself");
    const other = await ctx.db.get(userId);
    if (!other || other.isAnonymous) throw new Error("Person not found");

    const key = await dmKeyFor(ctx, me._id, userId);
    const existing = await getDmConversation(ctx, key);
    if (existing && !existing.deleted) return existing._id;

    return ctx.db.insert("chatConversations", {
      kind: "dm",
      dmKey: key,
      memberIds: [me._id, userId],
      lastActivityAt: Date.now(),
    });
  },
});

// ---------- admin-managed groups ----------

function assertAdmin(user: { role?: string }) {
  if (user.role !== "admin") throw new Error("Only admins can manage group chats");
}

export const createGroup = mutation({
  args: {
    name: v.string(),
    image: v.optional(v.string()),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, { name, image, memberIds }) => {
    const me = await requireUser(ctx);
    assertAdmin(me);
    const clean = name.trim();
    if (clean.length < 2) throw new Error("Group name is too short");
    const members = [...new Set(memberIds)];
    if (members.length < 2) throw new Error("Add at least two members");
    const id = await ctx.db.insert("chatConversations", {
      kind: "group",
      name: clean,
      image: image || undefined,
      createdBy: me._id,
      memberIds: members,
      lastActivityAt: Date.now(),
    });
    return id;
  },
});

export const updateGroup = mutation({
  args: {
    id: v.id("chatConversations"),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    memberIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, { id, name, image, memberIds }) => {
    const me = await requireUser(ctx);
    assertAdmin(me);
    const conv = await ctx.db.get(id);
    if (!conv || conv.kind !== "group" || conv.deleted) throw new Error("Group not found");
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      const clean = name.trim();
      if (clean.length < 2) throw new Error("Group name is too short");
      patch.name = clean;
    }
    if (image !== undefined) patch.image = image || undefined;
    if (memberIds !== undefined) {
      const members = [...new Set(memberIds)];
      if (members.length < 2) throw new Error("Add at least two members");
      patch.memberIds = members;
    }
    await ctx.db.patch(id, patch);
  },
});

export const deleteGroup = mutation({
  args: { id: v.id("chatConversations") },
  handler: async (ctx, { id }) => {
    const me = await requireUser(ctx);
    assertAdmin(me);
    const conv = await ctx.db.get(id);
    if (!conv || conv.kind !== "group" || conv.deleted) throw new Error("Group not found");
    await ctx.db.patch(id, { deleted: true });
    // Relay messages for a dead conversation are swept on the next pass.
  },
});

// ---------- project auto-groups ----------

/**
 * Called from projects.upsertProject. Creates the project's chat group named
 * after the project and auto-assigns all admins + the project owner.
 */
export const ensureProjectGroup = internalMutation({
  args: { projectId: v.id("projects"), name: v.string(), ownerId: v.optional(v.id("users")) },
  handler: async (ctx, { projectId, name, ownerId }) => {
    const existing = await ctx.db
      .query("chatConversations")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.deleted && existing.name !== name) patch.name = name;
      if (ownerId && !existing.memberIds.some((m) => m === ownerId)) {
        patch.memberIds = [...existing.memberIds, ownerId];
      }
      if (existing.deleted && Object.keys(patch).length > 0) patch.deleted = undefined;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    const admins = (await ctx.db.query("users").collect())
      .filter((u) => u.role === "admin")
      .map((u) => u._id);
    const memberIds = [...new Set([...admins, ...(ownerId ? [ownerId] : [])])];
    return ctx.db.insert("chatConversations", {
      kind: "group",
      name,
      projectId,
      createdBy: ownerId,
      memberIds: memberIds.length > 0 ? memberIds : admins,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Called on every project membership change (upsertProject with a new owner,
 * return-to-project flows, etc.): refreshes the group to admins + project
 * members. Non-project members are dropped automatically.
 */
export const syncProjectGroup = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    const group = await ctx.db
      .query("chatConversations")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!project || project.deleted) {
      if (group) await ctx.db.patch(group._id, { deleted: true });
      return;
    }
    if (!group) {
      await ctx.runMutation(internal.chat.ensureProjectGroup, {
        projectId,
        name: project.name,
        ownerId: project.ownerId,
      });
      return;
    }
    const admins = (await ctx.db.query("users").collect())
      .filter((u) => u.role === "admin")
      .map((u) => u._id);
    // The owner is the canonical project member in the current data model;
    // anyone who currently holds a part assigned to this project counts too.
    const holders = (
      await ctx.db
        .query("parts")
        .filter((q) => q.eq(q.field("currentProjectId"), projectId))
        .collect()
    )
      .map((p) => p.currentHolderId)
      .filter((x): x is Id<"users"> => Boolean(x));
    const memberIds = [...new Set([...admins, ...(project.ownerId ? [project.ownerId] : []), ...holders])];
    await ctx.db.patch(group._id, {
      name: project.name,
      deleted: undefined,
      memberIds: memberIds.length > 0 ? memberIds : admins,
    });
  },
});

// ---------- messages ----------

/** Live pull: messages for one conversation, acking delivery for the caller. */
export const pullMessages = query({
  args: { conversationId: v.id("chatConversations"), afterSeq: v.optional(v.number()) },
  handler: async (ctx, { conversationId, afterSeq }) => {
    const me = await requireUser(ctx);
    await assertMembership(ctx, conversationId, me._id);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(400);
    const fresh = rows
      .reverse()
      .filter((m) => (afterSeq ? m.createdAt > afterSeq : true))
      .filter((m) => !(m.deletedForMe as Record<string, boolean> | undefined)?.[me._id]);

    // Delivery ack: recipients pulling flips the sender's single gray tick
    // into the double gray tick. (A query may not write in Convex, so the
    // caller fires `ackDelivery` right after; status shown here is read-only.)
    return fresh.map((m) => ({
      _id: m._id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: m.deletedForEveryone ? "" : m.body,
      attachment: m.deletedForEveryone ? undefined : m.attachment,
      replyToId: m.replyToId,
      editedAt: m.editedAt,
      deletedForEveryone: Boolean(m.deletedForEveryone),
      clientTag: m.clientTag,
      createdAt: m.createdAt,
      status: m.deletedForEveryone
        ? "deleted"
        : m.readBy.some((r) => r === me._id)
          ? ("read" as const)
          : m.deliveredTo.some((d) => d === me._id)
            ? ("delivered" as const)
            : ("sent" as const),
    }));
  },
});

/** Send a message into a conversation (relay row; recipients pull it). */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("chatConversations"),
    body: v.string(),
    replyToId: v.optional(v.id("chatMessages")),
    attachment: v.optional(
      v.object({ name: v.string(), mime: v.string(), size: v.number(), dataUrl: v.string() }),
    ),
    clientTag: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, body, replyToId, attachment, clientTag }) => {
    const me = await requireNonStudent(ctx);
    const conv = await assertMembership(ctx, conversationId, me._id);
    const text = body.trim();
    if (!text && !attachment) throw new Error("Message is empty");
    if (text.length > 4000) throw new Error("Message is too long (max 4000 chars)");
    if (attachment && attachment.dataUrl.length > 700_000) {
      throw new Error("Attachment too large — keep files under ~500 KB");
    }
    if (clientTag) {
      const dup = await ctx.db
        .query("chatMessages")
        .withIndex("by_clientTag", (q) => q.eq("clientTag", clientTag))
        .first();
      if (dup) return dup._id; // idempotent retry after a network flap
    }
    const id = await ctx.db.insert("chatMessages", {
      conversationId,
      senderId: me._id,
      body: text,
      replyToId,
      attachment,
      clientTag: clientTag || undefined,
      deliveredTo: [],
      readBy: [],
      createdAt: Date.now(),
    });
    await ctx.db.patch(conversationId, { lastActivityAt: Date.now() });
    void conv;
    return id;
  },
});

/** Edit my own message (content stays relay-visible until swept). */
export const editMessage = mutation({
  args: { id: v.id("chatMessages"), body: v.string() },
  handler: async (ctx, { id, body }) => {
    const me = await requireNonStudent(ctx);
    const msg = await ctx.db.get(id);
    if (!msg) throw new Error("Message not found");
    if (msg.senderId !== me._id) throw new Error("You can edit only your own messages");
    if (msg.deletedForEveryone) throw new Error("This message was deleted");
    const text = body.trim();
    if (!text && !msg.attachment) throw new Error("Message is empty");
    await ctx.db.patch(id, { body: text, editedAt: Date.now() });
  },
});

/** Delete for everyone (sender or admin) or just for me (any member). */
export const deleteMessage = mutation({
  args: { id: v.id("chatMessages"), forEveryone: v.boolean() },
  handler: async (ctx, { id, forEveryone }) => {
    const me = await requireNonStudent(ctx);
    const msg = await ctx.db.get(id);
    if (!msg) throw new Error("Message not found");
    const conv = await ctx.db.get(msg.conversationId);
    if (!conv || !conv.memberIds.some((m) => m === me._id)) throw new Error("Not a member of this chat");
    if (forEveryone) {
      if (msg.senderId !== me._id && me.role !== "admin") {
        throw new Error("Only the sender or an admin can delete for everyone");
      }
      await ctx.db.patch(id, { deletedForEveryone: true, body: "", attachment: undefined });
    } else {
      const mine = (msg.deletedForMe as Record<string, boolean> | undefined) ?? {};
      mine[me._id] = true;
      await ctx.db.patch(id, { deletedForMe: mine });
    }
  },
});

/** Clear a conversation locally (caller wipes IndexedDB) and mark the relay
 *  copies addressed to me as deleted — the other side keeps their copy. */
export const clearConversationForMe = mutation({
  args: { conversationId: v.id("chatConversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireUser(ctx);
    await assertMembership(ctx, conversationId, me._id);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    for (const m of rows) {
      const mine = (m.deletedForMe as Record<string, boolean> | undefined) ?? {};
      if (!mine[me._id]) {
        mine[me._id] = true;
        await ctx.db.patch(m._id, { deletedForMe: mine });
      }
    }
  },
});

/** Admin: wipe every relay message of a conversation for everyone. */
export const adminClearConversation = mutation({
  args: { conversationId: v.id("chatConversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireUser(ctx);
    if (me.role !== "admin") throw new Error("Admin access required");
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    for (const m of rows) await ctx.db.delete(m._id);
  },
});

// ---------- acks / presence / typing ----------

/** Mark messages of a conversation read by me (blue ticks for the sender). */
export const markRead = mutation({
  args: { conversationId: v.id("chatConversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireUser(ctx);
    await assertMembership(ctx, conversationId, me._id);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(ACKS_PAGE);
    for (const m of rows) {
      if (m.senderId !== me._id && !m.readBy.some((r) => r === me._id)) {
        await ctx.db.patch(m._id, { readBy: [...m.readBy, me._id] });
      }
    }
  },
});

/** Typing indicator: stores WHERE I am typing; cleared by TTL (query side). */
export const setTyping = mutation({
  args: { conversationId: v.optional(v.id("chatConversations")) },
  handler: async (ctx, { conversationId }) => {
    const me = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("chatPresence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        typingInConversationId: conversationId,
        typingAt: conversationId ? now : undefined,
        lastSeenAt: now,
      });
    } else {
      await ctx.db.insert("chatPresence", {
        userId: me._id,
        typingInConversationId: conversationId,
        typingAt: conversationId ? now : undefined,
        lastSeenAt: now,
      });
    }
  },
});

/** Presence heartbeat (open app = online). */
export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("chatPresence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("chatPresence", { userId: me._id, lastSeenAt: now });
    }
  },
});

/** Live presence + typing state for a set of users/conversation. */
export const presenceState = query({
  args: { conversationId: v.optional(v.id("chatConversations")) },
  handler: async (ctx, { conversationId }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("chatPresence").collect();
    const now = Date.now();
    const online: Record<string, number> = {};
    for (const r of rows) {
      if (r.lastSeenAt && now - r.lastSeenAt < PRESENCE_TTL_MS) online[r.userId] = r.lastSeenAt;
    }
    let typing: { userId: string; at: number }[] = [];
    if (conversationId) {
      typing = rows
        .filter(
          (r) =>
            r.typingInConversationId === conversationId &&
            r.typingAt &&
            now - r.typingAt < TYPING_TTL_MS,
        )
        .map((r) => ({ userId: r.userId, at: r.typingAt as number }));
    }
    return { online, typing };
  },
});

// ---------- sweeper (keeps the relay empty) ----------

/**
 * Scheduled every few minutes from convex/crons.ts: deletes messages that
 * every recipient has pulled (delivered) and are older than RELAY_TTL_MS, or
 * that nobody has pulled for 48h (dead devices), plus stale typing rows.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const DEAD_TTL = 48 * 60 * 60 * 1000;
    const msgs = await ctx.db.query("chatMessages").collect();
    let deleted = 0;
    for (const m of msgs) {
      const conv = await ctx.db.get(m.conversationId);
      if (!conv || conv.deleted) {
        await ctx.db.delete(m._id);
        deleted += 1;
        continue;
      }
      const rcp = recipients(conv, m.senderId);
      const acked = rcp.every((r) => m.deliveredTo.some((d) => d === r));
      const age = now - m.createdAt;
      if ((acked && age > RELAY_TTL_MS) || age > DEAD_TTL) {
        await ctx.db.delete(m._id);
        deleted += 1;
      }
    }
    const presence = await ctx.db.query("chatPresence").collect();
    for (const p of presence) {
      if (p.typingAt && now - p.typingAt > TYPING_TTL_MS * 4) {
        await ctx.db.patch(p._id, { typingInConversationId: undefined, typingAt: undefined });
      }
    }
    return { deleted };
  },
});

/** Called right after pullMessages: records the caller's delivery ack. */
export const ackDelivery = mutation({
  args: { conversationId: v.id("chatConversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await requireUser(ctx);
    await assertMembership(ctx, conversationId, me._id);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(ACKS_PAGE);
    for (const m of rows) {
      if (m.senderId !== me._id && !m.deliveredTo.some((d) => d === me._id)) {
        await ctx.db.patch(m._id, { deliveredTo: [...m.deliveredTo, me._id] });
      }
    }
  },
});
