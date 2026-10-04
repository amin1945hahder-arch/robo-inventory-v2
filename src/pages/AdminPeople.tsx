import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ageFromIso } from "@/lib/utils";
import { printerPrivilegeLabel } from "@/lib/printer-role";
import { Printer } from "lucide-react";
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
import { asMessage } from "@/components/EditRentalDialog";
import {
  ArrowDownWideNarrow,
  MessageSquare,
  Pencil,
  GraduationCap,
  Send,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

// PersonForm: shared fields between "Add person" and the edit dialog so the
// add flow matches what admins already edit later.
type AddPersonState = {
  name: string;
  email: string;
  role: "admin" | "member" | "student";
  studentId: string;
  phone: string;
  clubRoles: string[];
  academicState: string;
  major: string;
  dateOfBirth: string;
  githubUrl: string;
  telegramChatId: string;
};
const EMPTY_ADD: AddPersonState = {
  name: "",
  email: "",
  role: "member",
  studentId: "",
  phone: "",
  clubRoles: [],
  academicState: "",
  major: "",
  dateOfBirth: "",
  githubUrl: "",
  telegramChatId: "",
};

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
    dateOfBirth?: string;
    githubUrl?: string;
    telegramChatId?: string;
    telegramUsername?: string;
    membershipStatus?: string;
    profileApproved?: boolean;
    printerRole?: boolean;
  };
  activeRentals: number;
  pending: number;
};

// Sort options for the people lists (dropdown in the header).
type SortKey = "name" | "rank" | "age" | "added" | "rentals";
const SORTERS: Record<SortKey, { label: string; cmp: (a: Person, b: Person) => number }> = {
  name: {
    label: "Name A→Z",
    cmp: (a, b) => (a.user.name ?? a.user.email ?? "").localeCompare(b.user.name ?? b.user.email ?? ""),
  },
  rank: {
    label: "Rank / positions",
    cmp: (a, b) => (b.user.clubRoles?.length ?? 0) - (a.user.clubRoles?.length ?? 0),
  },
  age: {
    label: "Age (young → old)",
    cmp: (a, b) => (ageFromIso(a.user.dateOfBirth) ?? 999) - (ageFromIso(b.user.dateOfBirth) ?? 999),
  },
  added: {
    label: "Newest first",
    cmp: (a, b) => b.user._id.localeCompare(a.user._id),
  },
  rentals: {
    label: "Most active rentals",
    cmp: (a, b) => b.activeRentals - a.activeRentals,
  },
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
}) {  const { user, activeRentals, pending } = person;
  const isEx = user.membershipStatus === "ex";
  const age = ageFromIso(user.dateOfBirth);
  const navigate = useNavigate();
  return (
    <li className={`flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center ${isEx ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className={`size-8 shrink-0 border ${isAdminGroup ? "ring-1 ring-primary/40" : ""}`}>
          <AvatarImage src={user.image} />
          <AvatarFallback className="text-xs font-semibold">
            {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {/* Clicking a person opens their full profile (also the QR target). */}
            <button
              type="button"
              className="hover:underline"
              title="Open profile"
              onClick={() => navigate(`/person/${user._id}`)}
            >
              {user.name ?? "Unnamed"}
            </button>
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
          {(user.clubRoles?.length ||
            user.academicState ||
            user.major ||
            user.telegramChatId ||
            age !== null ||
            user.githubUrl ||
            user.printerRole) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {(user.clubRoles ?? []).map((r) => (
                <ClubRoleChip key={r} role={r} />
              ))}
              {user.printerRole && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                  <Printer className="size-2.5" /> printer
                </span>
              )}
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
              {age !== null && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {age} yrs
                </span>
              )}
              {user.githubUrl && (
                <a
                  href={user.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  GitHub
                </a>
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
      {/* Chip rows: meta chips on their own row, then the icon actions row —
          beside the identity only with real width headroom. */}
      <div className="flex flex-wrap items-center gap-2 wide:ml-auto wide:justify-end">
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            isAdminGroup
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          {isAdminGroup ? "Admin" : "Member"}
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {activeRentals} active · {pending} pending
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
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
  const peopleRaw = useQuery(api.notifications.listPeople, {});
  const dbRoles = useQuery(api.clubLists.getList, { key: "clubRoles" });
  const dbStates = useQuery(api.clubLists.getList, { key: "academicStates" });
  const CLUB_ROLES = dbRoles ?? FALLBACK_ROLES;
  const ACADEMIC_STATES = dbStates ?? FALLBACK_STATES;
  const [sortKey, setSortKey] = useState<SortKey>("name");
  // Sort applied to each section (admins/members/ex) independently.
  const sorted = useMemo(() => {
    const cmp = SORTERS[sortKey].cmp;
    return [...(peopleRaw ?? [])].sort(cmp);
  }, [peopleRaw, sortKey]);
  const updateProfile = useMutation(api.users.updatePersonProfile);
  const setPrinterRole = useMutation(api.users.setPrinterRole);
  const setMembership = useMutation(api.users.setMembershipStatus);
  const deletePerson = useMutation(api.users.deletePerson);
  const dmMember = useMutation(api.parts.adminDmMember);

  const people = sorted;

  const [editing, setEditing] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const [messaging, setMessaging] = useState<Person | null>(null);
  const [messageText, setMessageText] = useState("");
  const [msgBusy, setMsgBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add-person state (admin pre-provisions a member before they sign in).
  const addPerson = useMutation(api.users.adminCreatePerson);
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState<AddPersonState>(EMPTY_ADD);

  const toggleAddRole = (r: string) =>
    setAdd((s) => ({
      ...s,
      clubRoles: s.clubRoles.includes(r)
        ? s.clubRoles.filter((x) => x !== r)
        : [...s.clubRoles, r],
    }));

  const submitAdd = async () => {
    setBusy(true);
    try {
      await addPerson({
        name: add.name,
        email: add.email,
        role: add.role,
        studentId: add.studentId.trim() || undefined,
        phone: add.phone.trim() || undefined,
        clubRoles: add.clubRoles,
        academicState: add.academicState || undefined,
        major: add.major.trim() || undefined,
        dateOfBirth: add.dateOfBirth || undefined,
        githubUrl: add.githubUrl.trim() || undefined,
        telegramChatId: add.telegramChatId.trim() || undefined,
      });
      toast.success(
        `${add.name.trim()} added — when they sign in with ${add.email.trim()} their profile links up automatically`,
      );
      setAddOpen(false);
      setAdd(EMPTY_ADD);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // edit form state
  const [editRole, setEditRole] = useState<"admin" | "member" | "student">("member");
  const [editPrinter, setEditPrinter] = useState(false);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editAcademic, setEditAcademic] = useState("");
  const [editMajor, setEditMajor] = useState("");
  const [editTelegram, setEditTelegram] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editGithub, setEditGithub] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const openEdit = (p: Person) => {
    setEditing(p);
    setEditRole(
      p.user.role === "admin" ? "admin" : p.user.role === "student" ? "student" : "member",
    );
    setEditPrinter(p.user.printerRole === true);
    setEditRoles(p.user.clubRoles ?? []);
    setEditAcademic(p.user.academicState ?? "");
    setEditMajor(p.user.major ?? "");
    setEditTelegram(p.user.telegramChatId ?? "");
    setEditDob(p.user.dateOfBirth ?? "");
    setEditGithub(p.user.githubUrl ?? "");
    setEditEmail(p.user.email ?? "");
  };

  const toggleRole = (r: string) => {
    setEditRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  };

  // Printer privilege grant/revoke is a dedicated mutation (it validates busy
  // jobs and auto-resolves pending requests) — fired on toggle, not on save.
  const togglePrinter = async (p: Person) => {
    const next = !p.user.printerRole;
    try {
      await setPrinterRole({ userId: p.user._id as any, granted: next });
      toast.success(next ? "Printer access granted" : "Printer access revoked");
    } catch (e) {
      toast.error(asMessage(e));
    }
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
        dateOfBirth: editDob || undefined,
        githubUrl: editGithub.trim() || undefined,
        email: editEmail !== (editing.user.email ?? "") ? editEmail.trim() : undefined,
      });
      toast.success("Profile updated");
      setEditing(null);
    } catch (e) {
      toast.error(asMessage(e));
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
      toast.error(asMessage(e));
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
      toast.error(asMessage(e));
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
      toast.error(asMessage(e));
    } finally {
      setMsgBusy(false);
    }
  };

  const all = people ?? [];
  const admins = all.filter((p) => p.user.role === "admin");
  const students = all.filter((p) => p.user.role === "student");
  const activeMembers = all.filter(
    (p) => p.user.role !== "admin" && p.user.role !== "student" && p.user.membershipStatus !== "ex",
  );
  const exMembers = all.filter(
    (p) => p.user.role !== "admin" && p.user.role !== "student" && p.user.membershipStatus === "ex",
  );

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
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <ArrowDownWideNarrow className="size-4 text-muted-foreground" />
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(SORTERS) as [SortKey, { label: string }][]).map(([k, s]) => (
                    <SelectItem key={k} value={k}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <UserPlus className="size-3.5" /> Add person
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ✏️ edit roles · ➖ ex-member · 🗑 remove (blocked while they hold parts)
            </p>
          </div>
        </header>

        {people === undefined ? (
          <LoadingGif size={48} label={null} />
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-2 glass-3d rounded-lg border border-dashed px-6 py-16 text-center">
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
                <ul className="divide-y glass-3d rounded-lg border">
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
                <ul className="divide-y glass-3d rounded-lg border">
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

            {students.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <GraduationCap className="size-4 text-amber-400" /> Students ({students.length})
                </h2>
                <ul className="divide-y glass-3d rounded-lg border">
                  {students.map((p) => (
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

            {exMembers.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <UserMinus className="size-4" /> Ex-members ({exMembers.length})
                </h2>
                <ul className="divide-y glass-3d rounded-lg border border-dashed">
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
                  <Button
                    type="button"
                    variant={editRole === "student" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setEditRole("student")}
                  >
                    Student
                  </Button>
                </div>
                {editRole === "student" && (
                  <p className="text-xs text-muted-foreground">
                    Students are blocked from inventory, projects and admin settings —
                    they keep their Profile access.
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label>Printer privilege</Label>
                <div className="flex items-center justify-between glass-3d rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">Slicer Studio + print scheduling</p>
                    <p className="text-[11px] text-muted-foreground">
                      {printerPrivilegeLabel(editing.user)} · admins hold it implicitly
                    </p>
                  </div>
                  {editing.user.role === "admin" ? (
                    <Badge variant="secondary" className="text-[11px]">implicit</Badge>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant={editPrinter ? "default" : "outline"}
                      onClick={() => {
                        setEditPrinter((v) => !v);
                        void togglePrinter(editing);
                      }}
                    >
                      <Printer className="size-3.5" /> {editPrinter ? "Revoke" : "Grant"}
                    </Button>
                  )}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Date of birth</Label>
                  <Input type="date" value={editDob} onChange={(e) => setEditDob(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>GitHub profile</Label>
                  <Input
                    value={editGithub}
                    onChange={(e) => setEditGithub(e.target.value)}
                    placeholder="https://github.com/…"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Email (sign-in address)</Label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="member@club.org"
                />
                <p className="text-[11px] text-muted-foreground">
                  Changing this moves the member's sign-in email — they'll use the new address for
                  the next email-code sign-in. Must not belong to another account.
                </p>
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

      {/* Add person — admin pre-provisions a member before they ever sign in */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>
              Creates the profile now — rentals, teams and roles work immediately. When they sign
              in with this same email, everything links to their account automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Name *</Label>
              <Input
                value={add.name}
                onChange={(e) => setAdd((s) => ({ ...s, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div className="grid gap-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={add.email}
                onChange={(e) => setAdd((s) => ({ ...s, email: e.target.value }))}
                placeholder="they@university.edu — the email they'll sign in with"
              />
              <p className="text-[11px] text-muted-foreground">
                Use the email they will actually sign in with — the profiles merge on first login.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Access level</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={add.role === "admin" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setAdd((s) => ({ ...s, role: "admin" }))}
                >
                  <ShieldCheck className="size-4" /> Admin
                </Button>
                <Button
                  type="button"
                  variant={add.role === "member" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setAdd((s) => ({ ...s, role: "member" }))}
                >
                  Member
                </Button>
                <Button
                  type="button"
                  variant={add.role === "student" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setAdd((s) => ({ ...s, role: "student" }))}
                >
                  Student
                </Button>
              </div>
              {add.role === "student" && (
                <p className="text-xs text-muted-foreground">
                  Students are blocked from inventory, projects and admin settings — they keep
                  their Profile access.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Club position (select all that apply)</Label>
              <div className="grid grid-cols-2 gap-2">
                {CLUB_ROLES.map((r) => {
                  const on = add.clubRoles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleAddRole(r)}
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
                <Label>Student ID</Label>
                <Input
                  value={add.studentId}
                  onChange={(e) => setAdd((s) => ({ ...s, studentId: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input
                  value={add.phone}
                  onChange={(e) => setAdd((s) => ({ ...s, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Academic state</Label>
                <Select
                  value={add.academicState}
                  onValueChange={(v) => setAdd((s) => ({ ...s, academicState: v }))}
                >
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
                  value={add.major}
                  onChange={(e) => setAdd((s) => ({ ...s, major: e.target.value }))}
                  placeholder="ميكاترونيكس"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Date of birth</Label>
                <Input
                  type="date"
                  value={add.dateOfBirth}
                  onChange={(e) => setAdd((s) => ({ ...s, dateOfBirth: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>GitHub profile</Label>
                <Input
                  value={add.githubUrl}
                  onChange={(e) => setAdd((s) => ({ ...s, githubUrl: e.target.value }))}
                  placeholder="https://github.com/…"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Telegram chat ID</Label>
              <Input
                value={add.telegramChatId}
                onChange={(e) => setAdd((s) => ({ ...s, telegramChatId: e.target.value }))}
                placeholder="optional — links automatically when they message the bot"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitAdd}
              disabled={busy || add.name.trim().length < 2 || add.email.trim().length < 5}
            >
              {busy ? "Adding…" : "Add person"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
