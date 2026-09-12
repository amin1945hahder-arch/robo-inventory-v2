import JSZip from "jszip";
import {
  chatDb,
  conversationExport,
  transcriptOf,
  type LocalMessage,
} from "./chat-db";

/**
 * Client-side chat archiving.
 *
 * A backup zip contains, per conversation:
 *   messages.json         — structured, parseable log
 *   chat_transcript.txt   — human-readable transcript
 *   media/<n>_<name>      — every binary attachment
 *
 * File name: `${User}_${Chat_Name}_${date}_Backup.zip` (sanitized).
 */

function sanitize(s: string) {
  return (s || "chat")
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 48) || "chat";
}

function dateStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeUserName(name?: string) {
  return sanitize(name || "user");
}

function safeChatName(
  members: { _id?: string; name?: string; email?: string }[],
  groupName?: string,
  kind?: string,
  meId?: string,
) {
  if (groupName) return sanitize(groupName);
  if (kind === "dm" && meId) {
    const other = members.filter((m) => m._id !== meId);
    return sanitize(other[0]?.name ?? other[0]?.email ?? "direct");
  }
  return sanitize("chat");
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function buildZip(
  conversationId: string,
  userName: string,
  meId: string,
): Promise<{ blob: Blob; fileName: string } | null> {
  const { conversation, messages } = await conversationExport(conversationId);
  if (!conversation) return null;

  const chatName = safeChatName(
    conversation.memberProfiles,
    conversation.name,
    conversation.kind,
    meId,
  );
  const visible = messages.filter((m) => !m.deletedForEveryone && m.status !== "deleted");

  const zip = new JSZip();
  // 1) Structured log
  zip.file(
    "messages.json",
    JSON.stringify(
      {
        app: "RoboShelf",
        schema: 1,
        exportedAt: new Date().toISOString(),
        user: userName,
        conversation: {
          id: conversation.id,
          kind: conversation.kind,
          name: conversation.name ?? null,
          projectId: conversation.projectId ?? null,
          members: conversation.memberProfiles,
        },
        messages: visible.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderName: m.senderName ?? null,
          body: m.body,
          createdAt: m.createdAt,
          editedAt: m.editedAt ?? null,
          replyToId: m.replyToId ?? null,
          attachment: m.attachment
            ? { name: m.attachment.name, mime: m.attachment.mime, size: m.attachment.size }
            : null,
          attachmentFile: m.attachment ? `media/${mediaFileName(m.attachment.name)}` : null,
        })),
      },
      null,
      2,
    ),
  );
  // 2) Human transcript
  zip.file("chat_transcript.txt", transcriptOf(visible, chatName, userName));
  // 3) Media
  const media = zip.folder("media");
  let mediaCount = 0;
  const used = new Map<string, number>();
  for (const m of visible) {
    if (!m.attachment) continue;
    const base = mediaFileName(m.attachment.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const name = n === 1 ? base : `${n}_${base}`;
    const bytes = dataUrlToBytes(m.attachment.dataUrl);
    media?.file(name, bytes);
    mediaCount += 1;
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const fileName = `${safeUserName(userName)}_${chatName}_${dateStamp()}_Backup.zip`;
  return { blob, fileName, mediaCount } as { blob: Blob; fileName: string; mediaCount: number };
}

function mediaFileName(name: string) {
  return sanitize(name) || "file.bin";
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Export one conversation and remember it as the user's last backup. */
export async function backupConversation(
  conversationId: string,
  userName: string,
  meId: string,
): Promise<string | null> {
  const out = await buildZip(conversationId, userName, meId);
  if (!out) return null;
  triggerDownload(out.blob, out.fileName);
  const { conversation, messages } = await conversationExport(conversationId);
  const chatName =
    conversation?.name ||
    conversation?.memberProfiles.find((m) => m._id !== meId)?.name ||
    "chat";
  await chatDb.backups.put({
    chatKey: `${meId}_${conversationId}`,
    chatName,
    userName,
    lastBackupAt: Date.now(),
    fileName: out.fileName,
  });
  return out.fileName;
}

/** Re-download the most recent backup this user made of a conversation. */
export async function downloadLastBackup(conversationId: string, meId: string) {
  const meta = await chatDb.backups.get(`${meId}_${conversationId}`);
  if (!meta) return null;
  const out = await buildZip(conversationId, meta.userName, meId);
  if (!out) return null;
  triggerDownload(out.blob, out.fileName);
  return meta;
}

/** Metadata shown in the UI ("last backup: …"). */
export async function lastBackupOf(conversationId: string, meId: string) {
  return chatDb.backups.get(`${meId}_${conversationId}`) ?? null;
}

/** Restore a previously exported zip back into the local store (media
 *  attachments are recovered from the archive). */
export async function restoreFromZip(file: File): Promise<{ restored: number }> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const jsonFile = zip.file("messages.json");
  if (!jsonFile) throw new Error("Not a RoboShelf chat backup (messages.json missing)");
  const parsed = JSON.parse(await jsonFile.async("string")) as {
    conversation?: { id?: string; name?: string | null; members?: { _id: string; name?: string }[] };
    messages?: {
      id: string;
      senderId: string;
      senderName?: string | null;
      body: string;
      createdAt: number;
      editedAt?: number | null;
      replyToId?: string | null;
      attachmentFile?: string | null;
      attachment?: { name: string; mime: string; size: number } | null;
    }[];
  };
  const convId = parsed.conversation?.id;
  if (!convId || !parsed.messages) throw new Error("Backup is missing conversation data");

  const existing = await chatDb.conversations.get(convId);
  const conv = existing ?? {
    id: convId,
    kind: "group" as const,
    name: parsed.conversation?.name ?? undefined,
    memberIds: (parsed.conversation?.members ?? []).map((m) => m._id),
    memberProfiles: parsed.conversation?.members ?? [],
    lastActivityAt: Date.now(),
    unread: 0,
  };

  const mediaByPath = new Map<string, JSZip.JSZipObject>();
  zip.forEach((path, entry) => {
    if (!entry.dir && path.startsWith("media/")) mediaByPath.set(path, entry);
  });

  const rows: LocalMessage[] = [];
  for (const m of parsed.messages) {
    let attachment;
    if (m.attachmentFile) {
      const entry = mediaByPath.get(m.attachmentFile);
      if (entry) {
        const bytes = await entry.async("uint8array");
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        attachment = {
          name: m.attachment?.name ?? m.attachmentFile.replace(/^media\/\d*_?/, ""),
          mime: m.attachment?.mime ?? "application/octet-stream",
          size: m.attachment?.size ?? bytes.length,
          dataUrl: `data:${attachment0(m)};base64,${btoa(bin)}`,
        };
      }
    }
    rows.push({
      id: m.id,
      conversationId: convId,
      senderId: m.senderId,
      senderName: m.senderName ?? undefined,
      body: m.body,
      attachment,
      replyToId: m.replyToId ?? undefined,
      editedAt: m.editedAt ?? undefined,
      createdAt: m.createdAt,
      status: "read",
      synced: true,
    });
  }

  await chatDb.transaction("rw", chatDb.conversations, chatDb.messages, async () => {
    await chatDb.conversations.put(conv);
    for (const r of rows) await chatDb.messages.put(r);
  });
  return { restored: rows.length };
}

function attachment0(m: { attachment?: { mime: string } | null }) {
  return m.attachment?.mime ?? "application/octet-stream";
}
