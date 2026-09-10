import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  MessageSquare,
  Pencil,
  Send,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

type Person = {
  user: {
    _id: string;
    name?: string;
    email?: string;
    image?: string;
    role?: string;
    studentId?: string;
    phone?: string;
    clubRoles?: string[];
    academicState?: string;
    major?: string;
    studentCode?: string;
    telegramChatId?: string;
    membershipStatus?: string;
  };
  activeRentals: number;
  pending: number;
};

// Club positions and academic states are admin-editable lists stored in the
// DB (Settings → Club lists). Fall back to these defaults until loaded.
const FALLBACK_ROLES = [
  "رئيس نادي الروبوت",
  "منسق النادي",
  "عضو علمي",
  "عضو إداري",
  "مدرب",
  "عضو إعلامي",
];
const FALLBACK_STATES = ["دكتوراه", "جامعي", "مُتخرج", "ماجستير"];

function ClubRoleChip({ role }: { role: string }) {
  const isHead = role === "رئيس نادي الروبوت";
  const isCoord = role === "منسق النادي";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        isHead
          ? "border-primary/40 bg-primary/15 text-primary"
          : isCoord
            ? "border-violet-400/40 bg-violet-500/10 text-violet-400"
            : "border-border bg-muted/60 text-muted-foreground"
      }`}
    >
      {role}
    </span>
  );
}

function PersonRow({
  person,
  isMe,
  isAdminGroup,
  onEdit,
  onDelete,
  onToggleMembership,
  onMessage,
}: {
  person: Person;
  isMe: boolean;
  isAdminGroup: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleMembership: () => void;
  onMessage: () => void;
}) {
  const { user, activeRentals, pending } = person;
  const isEx = user.membershipStatus === "ex";
  return (
    <li className={`flex flex-wrap items-center gap-3 px-4 py-3 ${isEx ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            isAdminGroup ? "bg-primary/15 text-primary" : "bg-muted"
          }`}
        >
          {isAdminGroup ? (
            <ShieldCheck className="size-4" />
          ) : (
            (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {user.name ?? "Unnamed"}
            {isMe && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
            {isEx && (
              <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                ex-member
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {user.studentCode && <span className="font-mono">{user.studentCode} · </span>}
            {[user.email, user.studentId, user.phone].filter(Boolean).join(" · ") || "—"}
          </p>
          {(user.clubRoles?.length || user.academicState || user.major || user.telegramChatId) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {(user.clubRoles ?? []).map((r) => (
                <ClubRoleChip key={r} role={r} />
              ))}
              {user.academicState && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {user.academicState}
                </span>
              )}
              {user.major && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {user.major}
                </span>
              )}
              {user.telegramChatId && (
                <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
                  Telegram ✓
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <span
        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          isAdminGroup
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border text-muted-foreground"
        }`}
      >
        {isAdminGroup ? "Admin" : "Member"}
      </span>
      <span className="text-xs text-muted-foreground">
        {activeRentals} active · {pending} pending
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-7" title="Send a Telegram message" onClick={onMessage}>
          <MessageSquare className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title="Edit profile" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={isEx ? "Mark as active member" : "Mark as ex-member"}
          onClick={onToggleMembership}
        >
          {isEx ? <UserPlus className="size-3.5" /> : <UserMinus className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive"
          title="Delete from app"
          disabled={activeRentals > 0 || pending > 0}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

export default function AdminPeople() {
  const { user: me } = useAuth();
  const people = useQuery(api.notifications.listPeople, {});
  const dbRoles = useQuery(api.clubLists.getList, { key: "clubRoles" });
  const dbStates = useQuery(api.clubLists.getList, { key: "academicStates" });
  const CLUB_ROLES = dbRoles ?? FALLBACK_ROLES;
  const ACADEMIC_STATES = dbStates ?? FALLBACK_STATES;
  const updateProfile = useMutation(api.users.updatePersonProfile);
  const setMembership = useMutation(api.users.setMembershipStatus);
  const deletePerson = useMutation(api.users.deletePerson);
  const dmMember = useMutation(api.parts.adminDmMember);

  const [editing, setEditing] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const [messaging, setMessaging] = useState<Person | null>(null);
  const [messageText, setMessageText] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // edit form state
  const [editRole, setEditRole] = useState<"admin" | "member">("member");
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editAcademic, setEditAcademic] = useState("");
  const [editMajor, setEditMajor] = useState("");
  const [editTelegram, setEditTelegram] = useState("");

  const openEdit = (p: Person) => {
    setEditing(p);
    setEditRole(p.user.role === "admin" ? "admin" : "member");
    setEditRoles(p.user.clubRoles ?? []);
    setEditAcademic(p.user.academicState ?? "");
    setEditMajor(p.user.major ?? "");
    setEditTelegram(p.user.telegramChatId ?? "");
  };

  const toggleRole = (r: string) => {
    setEditRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  };

  const submit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await updateProfile({
        userId: editing.user._id as any,
        role: editRole,
        clubRoles: editRoles,
        academicState: editAcademic || undefined,
        major: editMajor.trim() || undefined,
        telegramChatId: editTelegram.trim() || undefined,
      });
      toast.success("Profile updated");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleMembership = async (p: Person) => {
    const toEx = p.user.membershipStatus !== "ex";
    try {
      await setMembership({ userId: p.user._id as any, status: toEx ? "ex" : "active" });
      toast.success(
        toEx
          ? `${p.user.name ?? "Person"} marked as ex-member`
          : `${p.user.name ?? "Person"} marked as active member`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deletePerson({ userId: deleting.user._id as any });
      toast.success("Person removed from the app");
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!messaging) return;
    setMsgBusy(true);
    try {
      await dmMember({ userId: messaging.user._id as any, text: messageText });
      toast.success(
        messaging.user.telegramChatId
          ? "Message sent via the bot"
          : "No chat linked — posted in the club group tagging them instead",
      );
      setMessaging(null);
      setMessageText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setMsgBusy(false);
    }
  };

  const all = people ?? [];
  const admins = all.filter((p) => p.user.role === "admin");
  const activeMembers = all.filter((p) => p.user.role !== "admin" && p.user.membershipStatus !== "ex");
  const exMembers = all.filter((p) => p.user.role !== "admin" && p.user.membershipStatus === "ex");

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">People</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Club members, their positions (رئيس / منسق / علمي / إداري / مدرب / إعلامي), Telegram
              delivery, and rental activity.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            ✏️ edit roles · ➖ ex-member · 🗑 remove (blocked while they hold parts)
          </p>
        </header>

        {people === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
            <Users className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No members have signed in yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* Admins always on top so they're easy to spot */}
            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" /> Admins ({admins.length})
              </h2>
              {admins.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No admins yet — the first user to sign in is promoted automatically.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {admins.map((p) => (
                    <PersonRow
                      key={p.user._id}
                      person={p}
                      isMe={p.user._id === me?._id}
                      isAdminGroup
                      onEdit={() => openEdit(p)}
                      onDelete={() => setDeleting(p)}
                      onToggleMembership={() => toggleMembership(p)}
                      onMessage={() => {
                        setMessaging(p);
                        setMessageText("");
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Users className="size-4 text-muted-foreground" /> Members ({activeMembers.length})
              </h2>
              {activeMembers.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No active members yet — share the sign-in link with the club.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {activeMembers.map((p) => (
                    <PersonRow
                      key={p.user._id}
                      person={p}
                      isMe={p.user._id === me?._id}
                      isAdminGroup={false}
                      onEdit={() => openEdit(p)}
                      onDelete={() => setDeleting(p)}
                      onToggleMembership={() => toggleMembership(p)}
                      onMessage={() => {
                        setMessaging(p);
                        setMessageText("");
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>

            {exMembers.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <UserMinus className="size-4" /> Ex-members ({exMembers.length})
                </h2>
                <ul className="divide-y rounded-lg border border-dashed">
                  {exMembers.map((p) => (
                    <PersonRow
                      key={p.user._id}
                      person={p}
                      isMe={p.user._id === me?._id}
                      isAdminGroup={false}
                      onEdit={() => openEdit(p)}
                      onDelete={() => setDeleting(p)}
                      onToggleMembership={() => toggleMembership(p)}
                      onMessage={() => {
                        setMessaging(p);
                        setMessageText("");
                      }}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit member — {editing?.user.name ?? "Person"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 py-1">
              <div className="grid gap-2">
                <Label>Access level</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={editRole === "admin" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setEditRole("admin")}
                  >
                    <ShieldCheck className="size-4" /> Admin
                  </Button>
                  <Button
                    type="button"
                    variant={editRole === "member" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setEditRole("member")}
                  >
                    Member
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Club position (select all that apply)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {CLUB_ROLES.map((r) => {
                    const on = editRoles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleRole(r)}
                        className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                          on
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Academic state</Label>
                  <Select value={editAcademic} onValueChange={setEditAcademic}>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">—</SelectItem>
                      {ACADEMIC_STATES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Major</Label>
                  <Input
                    value={editMajor}
                    onChange={(e) => setEditMajor(e.target.value)}
                    placeholder="ميكاترونيكس"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Telegram chat ID</Label>
                <Input
                  value={editTelegram}
                  onChange={(e) => setEditTelegram(e.target.value)}
                  placeholder="e.g. 7895718 — for direct Telegram updates"
                />
                <p className="text-[11px] text-muted-foreground">
                  The member can find their chat id by messaging the club bot; decisions and updates
                  are delivered there when TELEGRAM_BOT_TOKEN is set.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Telegram DM dialog */}
      <Dialog open={Boolean(messaging)} onOpenChange={(v) => !v && setMessaging(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" /> Message {messaging?.user.name ?? "member"}
            </DialogTitle>
            <DialogDescription>
              Sent by the club bot to their Telegram DM
              {messaging?.user.telegramChatId
                ? " (chat is linked)"
                : messaging?.user.telegramUsername
                  ? " — no chat yet, they'll be tagged in the club group instead"
                  : " — they haven't linked Telegram yet"}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="e.g. Please return the Arduino Uno by Friday — another project needs it."
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMessaging(null)}>
              Cancel
            </Button>
            <Button onClick={sendMessage} disabled={msgBusy || !messageText.trim()}>
              <Send className="size-4" /> {msgBusy ? "Sending…" : "Send via bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.user.name ?? "this person"}?</DialogTitle>
            <DialogDescription>
              This permanently deletes their account from the app. Past rental history stays
              readable as “(removed)”. They cannot hold any parts — process returns first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              <Trash2 className="size-4" /> {busy ? "Removing…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
