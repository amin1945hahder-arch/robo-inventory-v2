import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import Dexie from "dexie";
import { api } from "@/convex/_generated/api";
import { chatDb, newClientTag, type LocalMessage } from "@/lib/chat-db";

/**
 * Real-time sync engine.
 *
 * Convex subscriptions act as the live relay pipe: new relay rows are pulled
 * and immediately persisted into the local Dexie store (IndexedDB), then
 * acknowledged (delivered → read). The outbox drains pending sends, and a
 * heartbeat keeps presence/typing fresh. Restart-safe: the durable log is
 * always local, the relay is only a pipe.
 */

type RelayMessage = {
  _id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachment?: { name: string; mime: string; size: number; dataUrl: string };
  replyToId?: string;
  editedAt?: number;
  deletedForEveryone: boolean;
  clientTag?: string;
  createdAt: number;
};

const HEARTBEAT_MS = 25_000;

export function useChatSync(meId: string | undefined, meName: string | undefined) {
  const send = useMutation(api.chat.sendMessage);
  const editMessage = useMutation(api.chat.editMessage);
  const deleteMessage = useMutation(api.chat.deleteMessage);
  const ackDelivery = useMutation(api.chat.ackDelivery);
  const markRead = useMutation(api.chat.markRead);
  const setTyping = useMutation(api.chat.setTyping);
  const heartbeat = useMutation(api.chat.heartbeat);

  const draining = useRef(false);

  // ---- presence heartbeat ----
  useEffect(() => {
    if (!meId) return;
    heartbeat().catch(() => undefined);
    const t = setInterval(() => heartbeat().catch(() => undefined), HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [meId, heartbeat]);

  // ---- outbox drain ----
  const drainOutbox = useCallback(async () => {
    if (!meId || draining.current) return;
    draining.current = true;
    try {
      const pending = await chatDb.outbox.orderBy("createdAt").toArray();
      for (const item of pending) {
        try {
          await send({
            conversationId: item.conversationId as never,
            body: item.body,
            replyToId: item.replyToId as never,
            attachment: item.attachment,
            clientTag: item.tag,
          });
          // Promote the local pending row to a synced message.
          const localId = `local-${item.tag}`;
          const row = await chatDb.messages.get(localId);
          if (row) {
            await chatDb.messages.put({ ...row, synced: true, status: "sent" });
          }
          await chatDb.outbox.delete(item.tag);
        } catch {
          // Network hiccup: leave in outbox; retried on the next drain.
          break;
        }
      }
    } finally {
      draining.current = false;
    }
  }, [meId, send]);

  useEffect(() => {
    void drainOutbox();
    const t = setInterval(() => void drainOutbox(), 4_000);
    return () => clearInterval(t);
  }, [drainOutbox]);

  // ---- typing ----
  const notifyTyping = useCallback(
    (conversationId: string | undefined) => {
      setTyping({ conversationId: conversationId as never }).catch(() => undefined);
    },
    [setTyping],
  );

  const markConversationRead = useCallback(
    (conversationId: string) => {
      if (!meId) return;
      markRead({ conversationId: conversationId as never }).catch(() => undefined);
    },
    [meId, markRead],
  );

  return {
    sendToRelay: async (args: {
      conversationId: string;
      body: string;
      replyToId?: string;
      attachment?: LocalMessage["attachment"];
    }) => {
      const tag = newClientTag();
      const now = Date.now();
      // Optimistic local row.
      await chatDb.messages.put({
        id: `local-${tag}`,
        conversationId: args.conversationId,
        senderId: meId ?? "",
        senderName: meName,
        body: args.body,
        attachment: args.attachment,
        replyToId: args.replyToId,
        clientTag: tag,
        createdAt: now,
        status: "sending",
        synced: false,
      });
      await chatDb.outbox.put({
        tag,
        conversationId: args.conversationId,
        body: args.body,
        replyToId: args.replyToId,
        attachment: args.attachment,
        createdAt: now,
      });
      void drainOutbox();
      return tag;
    },
    editMessage: async (id: string, body: string) => {
      await chatDb.messages.update(id, { body, editedAt: Date.now() });
      await editMessage({ id: id as never, body }).catch(() => undefined);
    },
    deleteForEveryone: async (id: string) => {
      await chatDb.messages.update(id, { status: "deleted", deletedForEveryone: true, body: "" });
      await deleteMessage({ id: id as never, forEveryone: true }).catch(() => undefined);
    },
    deleteForMe: async (id: string) => {
      await chatDb.messages.delete(id);
      await deleteMessage({ id: id as never, forEveryone: false }).catch(() => undefined);
    },
    notifyTyping,
    markConversationRead,
    drainOutbox,
  };
}

/**
 * Subscribes to the relay for one conversation and mirrors everything into
 * the local store. Returns nothing — it is a pure side-effect hook.
 */
export function useConversationRelay(
  conversationId: string | undefined,
  meId: string | undefined,
  meName: string | undefined,
) {
  const rows = useQuery(
    api.chat.pullMessages,
    conversationId ? { conversationId: conversationId as never } : "skip",
  ) as RelayMessage[] | undefined;
  const ackDelivery = useMutation(api.chat.ackDelivery);
  const markRead = useMutation(api.chat.markRead);
  const { sendToRelay, editMessage, deleteForEveryone, deleteForMe, notifyTyping } =
    useChatSync(meId, meName);

  useEffect(() => {
    if (!conversationId || !meId || !rows) return;
    void (async () => {
      let newest = 0;
      for (const m of rows) {
        const existing = await chatDb.messages.get(m._id);
        if (existing) {
          // Relay edits propagate to the local copy while the row is alive.
          if (
            m.editedAt &&
            (!existing.editedAt || m.editedAt > existing.editedAt) &&
            existing.status !== "deleted"
          ) {
            await chatDb.messages.update(m._id, { body: m.body, editedAt: m.editedAt });
          }
          if (m.deletedForEveryone && existing.status !== "deleted") {
            await chatDb.messages.update(m._id, {
              status: "deleted",
              deletedForEveryone: true,
              body: "",
            });
          }
        } else {
          const isMine = m.senderId === meId;
          // Dedupe my optimistic row once the relay echoes it back.
          if (isMine && m.clientTag) {
            const opt = await chatDb.messages.get(`local-${m.clientTag}`);
            if (opt) {
              await chatDb.messages.delete(opt.id);
              await chatDb.messages.put({
                ...opt,
                id: m._id,
                synced: true,
                status: "delivered",
              });
              newest = Math.max(newest, m.createdAt);
              continue;
            }
          }
          const senderProfile = await resolveSender(m.conversationId, m.senderId);
          await chatDb.messages.put({
            id: m._id,
            conversationId: m.conversationId,
            senderId: m.senderId,
            senderName: senderProfile?.name,
            senderImage: senderProfile?.image,
            body: m.deletedForEveryone ? "" : m.body,
            attachment: m.deletedForEveryone ? undefined : m.attachment,
            replyToId: m.replyToId ?? undefined,
            editedAt: m.editedAt,
            deletedForEveryone: m.deletedForEveryone,
            clientTag: m.clientTag,
            createdAt: m.createdAt,
            status: "delivered",
            synced: true,
          });
          // Unread bump for other people's messages.
          if (!isMine) {
            const conv = await chatDb.conversations.get(m.conversationId);
            if (conv) {
              await chatDb.conversations.update(m.conversationId, {
                unread: (conv.unread ?? 0) + 1,
                lastActivityAt: Math.max(conv.lastActivityAt ?? 0, m.createdAt),
              });
            }
          }
        }
        newest = Math.max(newest, m.createdAt);
      }
      // Acks: delivered (gray double tick) + read (blue double tick).
      const others = rows.filter((m) => m.senderId !== meId);
      if (others.length > 0) {
        await ackDelivery({ conversationId: conversationId as never }).catch(() => undefined);
        if (document.hasFocus()) {
          await markRead({ conversationId: conversationId as never }).catch(() => undefined);
          await chatDb.conversations.update(conversationId, { unread: 0 });
        }
      }
      if (newest > 0) {
        await chatDb.conversations.update(conversationId, { lastActivityAt: newest }).catch(
          () => undefined,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId, rows]);

  return { sendToRelay, editMessage, deleteForEveryone, deleteForMe, notifyTyping };
}

/** Sender display data comes from the locally mirrored member directory. */
async function resolveSender(conversationId: string, senderId: string) {
  const conv = await chatDb.conversations.get(conversationId);
  return conv?.memberProfiles.find((m) => m._id === senderId);
}

/** Conversations list subscription: mirrors the relay directory locally. */
export function useConversationsSync(meId?: string) {
  const relay = useQuery(api.chat.listConversations, {});
  useEffect(() => {
    if (!relay) return;
    void (async () => {
      for (const c of relay) {
        const existing = await chatDb.conversations.get(c._id as unknown as string);
        // Local last-message cache: shows the newest message we have on this
        // device (relay previews disappear after sweeping).
        const lastLocal = await chatDb.messages
          .where("[conversationId+createdAt]")
          .between(
            [c._id, Dexie.minKey],
            [c._id, Dexie.maxKey],
          )
          .last();
        await chatDb.conversations.put({
          id: c._id,
          kind: c.kind,
          name: c.name,
          image: c.image,
          projectId: c.projectId,
          memberIds: c.memberIds,
          memberProfiles: c.memberProfiles,
          lastActivityAt: Math.max(c.lastActivityAt, lastLocal?.createdAt ?? 0),
          previewBody: lastLocal
            ? lastLocal.status === "deleted"
              ? "Message deleted"
              : lastLocal.body || (lastLocal.attachment ? `📎 ${lastLocal.attachment.name}` : "")
            : null,
          previewMine: lastLocal ? lastLocal.senderId === meId : false,
          previewSenderName: lastLocal?.senderName,
          // Local unread counter wins (it reflects what THIS device saw);
          // a fresh conversation starts at the relay's estimate.
          unread: existing?.unread ?? c.unread,
        });
      }
      const ids = new Set(relay.map((c) => c._id as unknown as string));
      const local = await chatDb.conversations.toArray();
      for (const c of local) {
        if (!ids.has(c.id)) await chatDb.conversations.delete(c.id);
      }
    })();
  }, [relay]);
  return relay;
}
