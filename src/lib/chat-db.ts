import Dexie, { type Table } from "dexie";

/**
 * Local-first chat storage.
 *
 * Every conversation log lives HERE — in the signed-in user's browser
 * (IndexedDB via Dexie). The Convex relay only carries live messages between
 * online devices and sweeps them shortly after; nothing conversation-related
 * is persisted in the cloud database.
 */

export type ChatAttachment = {
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
};

export type LocalMessage = {
  id: string; // relay message id (or local-<uuid> for pending outbox items)
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderImage?: string;
  body: string;
  attachment?: ChatAttachment;
  replyToId?: string;
  replyPreview?: { body: string; senderName?: string };
  editedAt?: number;
  deletedForEveryone?: boolean;
  clientTag?: string;
  createdAt: number;
  // Local tick state: sent (queued) → delivered (recipient pulled) → read
  status: "sending" | "sent" | "delivered" | "read" | "deleted";
  synced: boolean; // false while it still lives only in the outbox
};

export type LocalConversation = {
  id: string;
  kind: "dm" | "group";
  name?: string; // group name
  image?: string; // group avatar
  projectId?: string;
  memberIds: string[];
  memberProfiles: { _id: string; name?: string; email?: string; image?: string; role?: string }[];
  lastActivityAt: number;
  unread: number;
  // Local last-message cache for the conversation list (relay previews are
  // swept server-side, so the list shows what THIS device knows).
  previewBody?: string | null;
  previewMine?: boolean;
  previewSenderName?: string;
  // Deleted-for-me semantics are LOCAL only — clearing a chat never touches
  // other members' copies.
  clearedBeforeSeq?: number; // hides older relay rows on re-sync
};

export type OutboxItem = {
  tag: string; // clientTag (idempotency key)
  conversationId: string;
  body: string;
  replyToId?: string;
  attachment?: ChatAttachment;
  createdAt: number;
};

export type ChatBackupMeta = {
  chatKey: string; // "<user>_<conversationId>"
  chatName: string;
  userName: string;
  lastBackupAt: number;
  fileName: string;
};

class RoboShelfChatDB extends Dexie {
  messages!: Table<LocalMessage, string>;
  conversations!: Table<LocalConversation, string>;
  outbox!: Table<OutboxItem, string>;
  backups!: Table<ChatBackupMeta, string>;

  constructor() {
    super("roboshelf-chat");
    this.version(1).stores({
      messages: "id, conversationId, [conversationId+createdAt], clientTag, status",
      conversations: "id, lastActivityAt",
      outbox: "tag, conversationId, createdAt",
      backups: "chatKey, lastBackupAt",
    });
  }
}

export const chatDb = new RoboShelfChatDB();

/** Random idempotency tag for outgoing messages. */
export function newClientTag() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Everything needed to build a backup zip for one conversation. */
export async function conversationExport(conversationId: string) {
  const conv = await chatDb.conversations.get(conversationId);
  const messages = await chatDb.messages
    .where("[conversationId+createdAt]")
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
    .toArray();
  return { conversation: conv ?? null, messages };
}

export async function clearLocalConversation(conversationId: string) {
  await chatDb.transaction("rw", chatDb.messages, chatDb.outbox, async () => {
    await chatDb.messages.where("conversationId").equals(conversationId).delete();
    await chatDb.outbox.where("conversationId").equals(conversationId).delete();
  });
}

export async function deleteLocalConversation(conversationId: string) {
  await chatDb.transaction(
    "rw",
    chatDb.conversations,
    chatDb.messages,
    chatDb.outbox,
    async () => {
      await chatDb.conversations.delete(conversationId);
      await chatDb.messages.where("conversationId").equals(conversationId).delete();
      await chatDb.outbox.where("conversationId").equals(conversationId).delete();
    },
  );
}

/** Human-readable transcript (used inside the backup zip). */
export function transcriptOf(
  messages: LocalMessage[],
  conversationName: string,
  userName: string,
): string {
  const lines: string[] = [
    `RoboShelf chat transcript — ${conversationName}`,
    `Exported for: ${userName}`,
    `Exported at: ${new Date().toLocaleString("en-GB")}`,
    `${"=".repeat(52)}`,
    "",
  ];
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const m of sorted) {
    const who = m.senderName ?? m.senderId;
    const when = new Date(m.createdAt).toLocaleString("en-GB");
    if (m.deletedForEveryone || m.status === "deleted") {
      lines.push(`[${when}] ${who}: (message deleted)`);
      continue;
    }
    let text = m.body;
    if (m.attachment) text += ` [attachment: ${m.attachment.name}]`;
    if (m.replyToId) text += ` (↩ reply)`;
    if (m.editedAt) text += ` (edited)`;
    lines.push(`[${when}] ${who}: ${text}`);
  }
  return lines.join("\n");
}
