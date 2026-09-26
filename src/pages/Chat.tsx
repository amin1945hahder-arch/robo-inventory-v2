import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { TelegramLinkDialog } from "@/components/TelegramLinkDialog";
import { LoadingGif, LoadingGifInline } from "@/components/LoadingGif";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  FileDown,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Reply,
  RotateCcw,
  Search,
  Send,
  Smile,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import {
  chatDb,
  clearLocalConversation,
  deleteLocalConversation,
  type ChatBackupMeta,
  type LocalConversation,
  type LocalMessage,
} from "@/lib/chat-db";
import {
  backupConversation,
  blobToBase64,
  buildZip,
  buildAllChatsZip,
  downloadLastBackup,
  lastBackupOf,
  triggerBlobDownload,
} from "@/lib/chat-backup";
import {
  useChatSync,
  useConversationRelay,
  useConversationsSync,
} from "@/hooks/use-chat-sync";
import { toast } from "sonner";

const EMOJIS = ["👍", "🔥", "🤖", "⚡", "🔧", "🛠️", "📦", "✅", "❌", "🎉", "🤔", "😅", "🙌", "💡", "🚀", "❤️"];
const ATTACHMENT_LIMIT = 500_000;

function initials(name?: string, email?: string) {
  return (name ?? email ?? "?").slice(0, 1).toUpperCase();
}

function timeLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Ticks({ status }: { status: LocalMessage["status"] }) {
  if (status === "sending") return <LoadingGifInline size={18} className="size-3 text-muted-foreground" />;
  if (status === "sent") return <Check className="size-3.5 text-muted-foreground" />;
  if (status === "delivered") return <CheckCheck className="size-3.5 text-muted-foreground" />;
  if (status === "read") return <CheckCheck className="size-3.5 text-sky-400" />;
  return null;
}

function previewText(c: LocalConversation) {
  if (c.previewBody) {
    const prefix = c.previewMine ? "You: " : c.previewSenderName ? `${c.previewSenderName}: ` : "";
    return `${prefix}${c.previewBody}`;
  }
  if (!c.lastActivityAt) return "No messages yet";
  return `Active ${timeLabel(c.lastActivityAt)}`;
}

function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0">
          <Smile className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="grid w-56 grid-cols-8 gap-1 p-2">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="rounded p-1 text-lg hover:bg-muted"
            onClick={() => {
              onPick(e);
              setOpen(false);
            }}
          >
            {e}
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const meId = user?._id;
  const meName = user?.name ?? user?.email;
  const isAdmin = user?.role === "admin";

  useConversationsSync(meId);
  const people = useQuery(api.chat.listPeople, {});
  const presence = useQuery(api.chat.presenceState, {});

  const openDm = useMutation(api.chat.openDm);
  const createGroup = useMutation(api.chat.createGroup);
  const deliverBackup = useAction(api.chatActions.deliverBackup);

  const { sendToRelay, editMessage, deleteForEveryone, deleteForMe, notifyTyping, markConversationRead } =
    useChatSync(meId, meName);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [convs, setConvs] = useState<LocalConversation[]>([]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [results, setResults] = useState<{ message: LocalMessage; convName: string }[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const [attachment, setAttachment] = useState<LocalMessage["attachment"] | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [backupMeta, setBackupMeta] = useState<ChatBackupMeta | null>(null);
  const [backupAllBusy, setBackupAllBusy] = useState(false);
  const [showTelegramLink, setShowTelegramLink] = useState(false);
  // Where archives go (admin setting). "download" keeps everything local;
  // telegram modes deliver to Telegram INSTEAD of downloading a .zip.
  const backupDest = useQuery(api.settings.getMyBackupDestination, {});
  const telegramDest = backupDest?.mode === "telegram" || backupDest?.mode === "telegram-dm";
  const needsTelegramSetup =
    telegramDest && Boolean(meId) && !user?.telegramChatId && !showTelegramLink;
  const [autoSync, setAutoSync] = useState(() => localStorage.getItem("roboshelf_chat_autosync") === "1");
  const [lastAutoSync, setLastAutoSync] = useState<number | null>(() => {
    const raw = localStorage.getItem("roboshelf_chat_autosync_last");
    return raw ? Number(raw) : null;
  });
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    setConvs(await chatDb.conversations.orderBy("lastActivityAt").reverse().toArray());
  }, []);

  const loadMessages = useCallback(async (cid: string) => {
    const rows = await chatDb.messages.where("conversationId").equals(cid).toArray();
    setMessages(rows.sort((a, b) => a.createdAt - b.createdAt));
  }, []);

  useEffect(() => {
    void loadConversations();
    const t = setInterval(() => void loadConversations(), 2_000);
    return () => clearInterval(t);
  }, [loadConversations]);

  const active = convs.find((c) => c.id === activeId) ?? null;
  const activeMembers = active?.memberProfiles ?? [];
  const relay = useConversationRelay(activeId ?? undefined, meId, meName);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
    const t = setInterval(() => void loadMessages(activeId), 1_500);
    return () => clearInterval(t);
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (activeId && meId)
      void lastBackupOf(activeId, meId).then((meta) => setBackupMeta(meta ?? null));
  }, [activeId, meId]);

  // Daily auto-backup: when enabled, a full archive runs once per day while
  // the app is open (checked every 10 minutes; state lives in localStorage so
  // it survives reloads). Follows the admin-set destination: delivered to
  // Telegram when configured (no download), saved locally otherwise.
  useEffect(() => {
    localStorage.setItem("roboshelf_chat_autosync", autoSync ? "1" : "0");
    if (!autoSync || !meId) return;
    const DAY = 24 * 36e5;
    const run = async () => {
      const last = Number(localStorage.getItem("roboshelf_chat_autosync_last") ?? 0);
      if (Date.now() - last < DAY) return;
      try {
        const out = await buildAllChatsZip(meName ?? "user", meId);
        if (out) {
          // Follow the admin-set destination: Telegram modes deliver the
          // archive without downloading it; download mode saves locally.
          let delivered = false;
          if (telegramDest) {
            try {
              const res = await deliverBackup({
                fileName: out.fileName,
                dataBase64: await blobToBase64(out.blob),
                caption: `RoboShelf auto-backup — ${out.chatCount} conversations`,
              });
              delivered = Boolean(res?.sent);
            } catch {
              delivered = false;
            }
          }
          if (!delivered) {
            triggerBlobDownload(out.blob, out.fileName);
            toast.info(`Daily chat backup saved: ${out.fileName}`);
          } else {
            toast.info(`Daily chat backup delivered to Telegram (${out.chatCount} chats)`);
          }
          localStorage.setItem("roboshelf_chat_autosync_last", String(Date.now()));
          setLastAutoSync(Date.now());
        }
      } catch {
        /* silent — the next interval retries */
      }
    };
    void run();
    const t = setInterval(() => void run(), 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, meId, meName, telegramDest]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeId]);

  useEffect(() => {
    if (!activeId) return;
    markConversationRead(activeId);
    void chatDb.conversations.update(activeId, { unread: 0 }).then(() => loadConversations());
  }, [activeId, markConversationRead, loadConversations]);

  const presenceOnline = (userId: string) => Boolean(presence?.online?.[userId]);
  const isTyping = useMemo(() => {
    if (!activeId || !presence?.typing) return [] as string[];
    return presence.typing
      .filter((t) => t.userId !== meId)
      .map((t) => activeMembers.find((m) => m._id === t.userId)?.name ?? "Someone");
  }, [activeId, presence, activeMembers, meId]);

  const title = active
    ? active.kind === "group"
      ? active.name ?? "Group"
      : activeMembers.find((m) => m._id !== meId)?.name ??
        activeMembers.find((m) => m._id !== meId)?.email ??
        "Direct chat"
    : "";
  const activePartner = active?.kind === "dm" ? activeMembers.find((m) => m._id !== meId) : undefined;

  // ---- actions ----

  // Telegram destination banner: nudge once per session until linked.
  const tgNudgeShown = useRef(false);
  useEffect(() => {
    if (needsTelegramSetup && !tgNudgeShown.current) {
      tgNudgeShown.current = true;
      toast.info("Backups go to Telegram — set your @username to receive yours", {
        action: { label: "Set up", onClick: () => setShowTelegramLink(true) },
        duration: 8000,
      });
    }
  }, [needsTelegramSetup]);

  const handleSend = async () => {
    if (!activeId) return;
    const body = text.trim();
    if (!body && !attachment) return;
    if (editing) {
      const id = editing.id;
      setEditing(null);
      setText("");
      await editMessage(id, body);
      void loadMessages(activeId);
      return;
    }
    setText("");
    const reply = replyTo;
    setReplyTo(null);
    const att = attachment;
    setAttachment(null);
    await sendToRelay({
      conversationId: activeId,
      body,
      replyToId: reply?.id,
      attachment: att ?? undefined,
    });
    void loadMessages(activeId);
  };

  const handleFile = (file: File) => {
    if (file.size > ATTACHMENT_LIMIT) {
      toast.error("Attachments are limited to ~500 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setAttachment({
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: String(reader.result),
      });
    reader.readAsDataURL(file);
  };

  const openDmWith = async (userId: string) => {
    try {
      const id = await openDm({ userId: userId as never });
      setShowNewChat(false);
      await loadConversations();
      setActiveId(id as unknown as string);
      setMobileView("thread");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open chat");
    }
  };

  const submitGroup = async () => {
    try {
      const id = await createGroup({
        name: newGroupName,
        memberIds: newGroupMembers as never,
      });
      setNewGroupName("");
      setNewGroupMembers([]);
      setShowNewChat(false);
      await loadConversations();
      setActiveId(id as unknown as string);
      setMobileView("thread");
      toast.success("Group created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the group");
    }
  };

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      const lower = q.toLowerCase();
      const out: { message: LocalMessage; convName: string }[] = [];
      for (const c of convs) {
        const msgs = await chatDb.messages.where("conversationId").equals(c.id).toArray();
        for (const m of msgs) {
          if (!m.deletedForEveryone && m.status !== "deleted" && m.body.toLowerCase().includes(lower)) {
            out.push({
              message: m,
              convName:
                c.kind === "group"
                  ? c.name ?? "Group"
                  : c.memberProfiles.find((p) => p._id !== meId)?.name ?? "Direct",
            });
          }
        }
      }
      out.sort((a, b) => b.message.createdAt - a.message.createdAt);
      setResults(out.slice(0, 50));
    },
    [convs, meId],
  );

  useEffect(() => {
    void runSearch(globalSearch);
  }, [globalSearch, runSearch]);

  if (!meId) {
    return (
      <AppShell>
        <LoadingGif size={48} label={null} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="grid h-[calc(100vh-11rem)] grid-cols-1 overflow-hidden rounded-lg border md:grid-cols-[320px_1fr]">
        {/* ===== list column ===== */}
        <div className={cn("flex min-h-0 flex-col border-r", mobileView === "thread" && "hidden md:flex")}>
          <div className="flex items-center gap-2 border-b p-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search messages…"
                className="h-8 pl-7 text-sm"
              />
            </div>
            <Button size="icon" className="size-8 shrink-0" onClick={() => setShowNewChat(true)} title="New chat">
              <MessageSquarePlus className="size-4" />
            </Button>
          </div>

          {globalSearch.trim() ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No matches in your local history.</p>
              ) : (
                results.map(({ message, convName }) => (
                  <button
                    key={message.id}
                    className="w-full rounded-md p-2 text-left hover:bg-muted/60"
                    onClick={() => {
                      setActiveId(message.conversationId);
                      setGlobalSearch("");
                      setMobileView("thread");
                    }}
                  >
                    <p className="text-xs font-medium">{convName}</p>
                    <p className="truncate text-xs text-muted-foreground">{message.body || "[attachment]"}</p>
                    <p className="text-[10px] text-muted-foreground">{timeLabel(message.createdAt)}</p>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {convs.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No conversations yet — start one with the ＋ button.
                </p>
              ) : (
                convs.map((c) => {
                  const isGroup = c.kind === "group";
                  const partner = c.memberProfiles.find((m) => m._id !== meId);
                  const online = !isGroup && partner ? presenceOnline(partner._id) : false;
                  const name = isGroup ? c.name ?? "Group" : partner?.name ?? partner?.email ?? "Direct";
                  return (
                    <button
                      key={c.id}
                      className={cn(
                        "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        activeId === c.id && "bg-muted",
                      )}
                      onClick={() => {
                        setActiveId(c.id);
                        setMobileView("thread");
                      }}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="size-9">
                          <AvatarImage src={isGroup ? c.image : partner?.image} />
                          <AvatarFallback className="text-xs">
                            {isGroup ? "#" : initials(partner?.name, partner?.email)}
                          </AvatarFallback>
                        </Avatar>
                        {online && (
                          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{name}</p>
                          {c.unread > 0 && (
                            <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                              {c.unread}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{previewText(c)}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
          <div className="border-t px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                Local-first: messages live on this device.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                disabled={backupAllBusy}
                onClick={async () => {
                  // Telegram destination: the archive is delivered there
                  // INSTEAD of downloading — but only once the member has
                  // their @username set (and a linked chat for DM mode).
                  if (telegramDest) {
                    if (!user?.telegramUsername) {
                      setShowTelegramLink(true);
                      toast.info("Set your Telegram @username first so the backup can reach you");
                      return;
                    }
                    if (backupDest?.mode === "telegram-dm" && !user?.telegramChatId) {
                      setShowTelegramLink(true);
                      toast.info("Link your chat id once — then backups land in your Telegram DMs");
                      return;
                    }
                  }
                  setBackupAllBusy(true);
                  try {
                    const out = await buildAllChatsZip(meName ?? "user", meId ?? "");
                    if (!out) {
                      toast.info("Nothing to back up yet");
                      return;
                    }
                    const caption = `RoboShelf chat backup — ${out.chatCount} conversations`;
                    if (telegramDest) {
                      // Telegram destination: deliver the archive, no local
                      // download (the admin chose Telegram as the store).
                      try {
                        const res = await deliverBackup({
                          fileName: out.fileName,
                          dataBase64: await blobToBase64(out.blob),
                          caption,
                        });
                        if (res?.sent) toast.success(`Backup delivered to Telegram (${out.chatCount} chats)`);
                        else toast.error("Telegram delivery failed — check the bot settings");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Telegram delivery failed");
                      }
                    } else {
                      triggerBlobDownload(out.blob, out.fileName);
                      toast.success(`Backup saved: ${out.fileName}`);
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Backup failed");
                  } finally {
                    setBackupAllBusy(false);
                  }
                }}
              >
                {backupAllBusy ? <LoadingGifInline size={18} className="size-3" /> : <FileDown className="size-3" />}
                Backup everything
              </Button>
            </div>
            {/* Auto-sync: a scheduled backup routine the user opts into. */}
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => {
                    setAutoSync(e.target.checked);
                    if (e.target.checked) toast.info("Auto-backup enabled — a zip is saved daily while the app is open");
                  }}
                />
                Daily auto-backup
              </label>
              {autoSync && lastAutoSync && (
                <span className="text-[10px] text-muted-foreground">
                  last: {new Date(lastAutoSync).toLocaleDateString("en-GB")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ===== thread column ===== */}
        <div className={cn("flex min-h-0 flex-col", mobileView === "list" && "hidden md:flex")}>
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <MessageSquarePlus className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Pick a conversation, or start a new one.</p>
              <Button variant="outline" size="sm" onClick={() => setShowNewChat(true)}>
                Start a chat
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b p-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 md:hidden"
                  onClick={() => {
                    setMobileView("list");
                    setActiveId(null);
                  }}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <Avatar className="size-9">
                  <AvatarImage src={active.kind === "group" ? active.image : activePartner?.image} />
                  <AvatarFallback className="text-xs">
                    {active.kind === "group" ? "#" : initials(activePartner?.name, activePartner?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {isTyping.length > 0
                      ? `${isTyping.join(", ")} typing…`
                      : active.kind === "group"
                        ? `${activeMembers.length} members`
                        : activePartner && presenceOnline(activePartner._id)
                          ? "online"
                          : "offline"}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <ChevronDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem
                      onClick={async () => {
                        // Telegram destination: deliver to Telegram instead
                        // of downloading (username must be set first).
                        if (telegramDest) {
                          if (!user?.telegramUsername) {
                            setShowTelegramLink(true);
                            toast.info("Set your Telegram @username first so the backup can reach you");
                            return;
                          }
                          if (backupDest?.mode === "telegram-dm" && !user?.telegramChatId) {
                            setShowTelegramLink(true);
                            toast.info("Link your chat id once — then backups land in your Telegram DMs");
                            return;
                          }
                        }
                        const out = await buildZip(active.id, meName ?? "user", meId ?? "");
                        if (!out) {
                          toast.info("Nothing to back up yet");
                          return;
                        }
                        await chatDb.backups.put({
                          chatKey: `${meId}_${active.id}`,
                          chatName: title,
                          userName: meName ?? "user",
                          lastBackupAt: Date.now(),
                          fileName: out.fileName,
                        });
                        setBackupMeta((await lastBackupOf(active.id, meId ?? undefined)) ?? null);
                        if (telegramDest) {
                          try {
                            const res = await deliverBackup({
                              fileName: out.fileName,
                              dataBase64: await blobToBase64(out.blob),
                              caption: `RoboShelf chat backup — ${title}`,
                            });
                            if (res?.sent) toast.success("Backup delivered to Telegram");
                            else toast.error("Telegram delivery failed — check the bot settings");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Telegram delivery failed");
                          }
                        } else {
                          triggerBlobDownload(out.blob, out.fileName);
                          toast.success(`Backup saved: ${out.fileName}`);
                        }
                      }}
                    >
                      <FileDown className="size-4" />
                      {telegramDest ? "Backup this chat (→ Telegram)" : "Backup this chat (.zip)"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        const meta = await downloadLastBackup(active.id, meId ?? undefined);
                        if (meta) toast.info(`Re-downloaded ${meta.fileName}`);
                        else toast.error("No previous backup on this device");
                      }}
                    >
                      <RotateCcw className="size-4" />
                      Load last backup{backupMeta ? ` (${backupMeta.fileName.slice(0, 24)}…)` : ""}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        await clearLocalConversation(active.id);
                        await loadMessages(active.id);
                        toast.success("Conversation cleared on this device");
                      }}
                    >
                      <Trash2 className="size-4" /> Clear for me
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={async () => {
                        await deleteLocalConversation(active.id);
                        setActiveId(null);
                        await loadConversations();
                        toast.success("Conversation removed locally");
                      }}
                    >
                      <X className="size-4" /> Delete local copy
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
                {messages.map((m, idx) => {
                  const mine = m.senderId === meId;
                  const showDay =
                    idx === 0 ||
                    new Date(messages[idx - 1].createdAt).toDateString() !==
                      new Date(m.createdAt).toDateString();
                  const replied = m.replyToId ? messages.find((x) => x.id === m.replyToId) : undefined;
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <div className="my-3 flex items-center gap-3">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                          </span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <div className={cn("group flex", mine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-xl border px-3 py-2 text-sm shadow-sm sm:max-w-[70%]",
                            mine ? "border-primary/30 bg-primary/15" : "border-border bg-card",
                            m.status === "deleted" && "italic text-muted-foreground",
                          )}
                        >
                          {!mine && active.kind === "group" && (
                            <p className="mb-0.5 text-[11px] font-medium text-primary">
                              {m.senderName ?? "Member"}
                            </p>
                          )}
                          {replied && (
                            <div className="mb-1 rounded border-l-2 border-primary/50 bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                              <span className="font-medium">{replied.senderName ?? "Member"}:</span>{" "}
                              {replied.body.slice(0, 80) || "[attachment]"}
                            </div>
                          )}
                          {m.status === "deleted" ? (
                            <p className="text-xs italic">This message was deleted</p>
                          ) : (
                            <>
                              {m.attachment?.mime.startsWith("image/") ? (
                                <img
                                  src={m.attachment.dataUrl}
                                  alt={m.attachment.name}
                                  className="mb-1 max-h-48 rounded border border-border/60"
                                />
                              ) : m.attachment ? (
                                <a
                                  href={m.attachment.dataUrl}
                                  download={m.attachment.name}
                                  className="mb-1 flex items-center gap-2 rounded bg-muted/60 px-2 py-1 text-xs underline"
                                >
                                  <Paperclip className="size-3" /> {m.attachment.name}
                                </a>
                              ) : null}
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                                {m.editedAt && <span>(edited)</span>}
                                {timeLabel(m.createdAt)}
                                {mine && <Ticks status={m.status} />}
                              </div>
                            </>
                          )}
                        </div>
                        {m.status !== "deleted" && (
                          <div
                            className={cn(
                              "ml-1 flex items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                              mine && "order-first mr-1",
                            )}
                          >
                            <Button variant="ghost" size="icon" className="size-6" title="Reply" onClick={() => setReplyTo(m)}>
                              <Reply className="size-3" />
                            </Button>
                            {mine && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                title="Edit"
                                onClick={() => {
                                  setEditing(m);
                                  setText(m.body);
                                }}
                              >
                                <Pencil className="size-3" />
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-6" title="Delete">
                                  <Trash2 className="size-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {mine && (
                                  <DropdownMenuItem onClick={() => void deleteForEveryone(m.id)}>
                                    Delete for everyone
                                  </DropdownMenuItem>
                                )}
                                {isAdmin && !mine && (
                                  <DropdownMenuItem onClick={() => void deleteForEveryone(m.id)}>
                                    Delete for everyone (admin)
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => void deleteForMe(m.id)}>
                                  Delete for me
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {isTyping.length > 0 && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="flex gap-0.5">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
                    </span>
                    {isTyping.join(", ")} typing…
                  </p>
                )}
                <div ref={bottomRef} />
              </div>

              {replyTo && (
                <div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                  <Reply className="size-3" />
                  Replying to {replyTo.senderName ?? "member"}: {replyTo.body.slice(0, 60) || "[attachment]"}
                  <button className="ml-auto" onClick={() => setReplyTo(null)}>
                    <X className="size-3" />
                  </button>
                </div>
              )}
              {editing && (
                <div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                  <Pencil className="size-3" /> Editing message
                  <button
                    className="ml-auto"
                    onClick={() => {
                      setEditing(null);
                      setText("");
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}

              <div className="border-t p-2">
                {attachment && (
                  <div className="mx-2 mb-1 flex items-center gap-2 rounded bg-muted/60 px-2 py-1 text-xs">
                    <Paperclip className="size-3" /> {attachment.name}
                    <button className="ml-auto" onClick={() => setAttachment(null)}>
                      <X className="size-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-1">
                  <EmojiPicker onPick={(e) => setText((t) => t + e)} />
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach a file"
                  >
                    <Paperclip className="size-4" />
                  </Button>
                  <textarea
                    value={text}
                    rows={1}
                    onChange={(e) => {
                      setText(e.target.value);
                      notifyTyping(activeId ?? undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Message…"
                    className="max-h-28 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button size="icon" className="size-9 shrink-0" onClick={() => void handleSend()}>
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== new chat / group dialog ===== */}
      <Dialog open={showNewChat} onOpenChange={setShowNewChat}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a conversation</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Direct messages are open to everyone. Group chats are created by admins only.
          </p>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Direct message</p>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
              {(people ?? [])
                .filter((p) => p._id !== meId)
                .map((p) => (
                  <button
                    key={p._id}
                    className="flex w-full items-center gap-2 rounded p-1.5 text-left hover:bg-muted/60"
                    onClick={() => void openDmWith(p._id)}
                  >
                    <Avatar className="size-6">
                      <AvatarImage src={p.image} />
                      <AvatarFallback className="text-[10px]">{initials(p.name, p.email)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{p.name ?? p.email}</span>
                  </button>
                ))}
            </div>
          </div>
          {isAdmin && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                New group (admin)
              </p>
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
              />
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
                {(people ?? [])
                  .filter((p) => p._id !== meId)
                  .map((p) => {
                    const on = newGroupMembers.includes(p._id);
                    return (
                      <button
                        key={p._id}
                        className={cn(
                          "flex w-full items-center gap-2 rounded p-1.5 text-left hover:bg-muted/60",
                          on && "bg-primary/10",
                        )}
                        onClick={() =>
                          setNewGroupMembers((prev) =>
                            prev.includes(p._id) ? prev.filter((x) => x !== p._id) : [...prev, p._id],
                          )
                        }
                      >
                        <Avatar className="size-6">
                          <AvatarImage src={p.image} />
                          <AvatarFallback className="text-[10px]">{initials(p.name, p.email)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{p.name ?? p.email}</span>
                        {on && <Check className="ml-auto size-3.5 text-primary" />}
                      </button>
                    );
                  })}
              </div>
              <Button
                className="w-full"
                disabled={newGroupName.trim().length < 2 || newGroupMembers.length < 2}
                onClick={() => void submitGroup()}
              >
                Create group
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Telegram onboarding: shown whenever a backup needs a linked account */}
      <TelegramLinkDialog open={showTelegramLink} onOpenChange={setShowTelegramLink} />
    </AppShell>
  );
}
