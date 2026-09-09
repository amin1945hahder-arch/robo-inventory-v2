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
import { toast } from "sonner";
import { Pencil, ShieldCheck, Users } from "lucide-react";

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
  };
  activeRentals: number;
  pending: number;
};

// The club's real positions — matches the reference sheet.
const CLUB_ROLES = [
  "رئيس نادي الروبوت",
  "منسق النادي",
  "عضو علمي",
  "عضو إداري",
  "مدرب",
  "عضو إعلامي",
] as const;

const ACADEMIC_STATES = ["دكتوراه", "جامعي", "مُتخرج", "ماجستير"] as const;

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
}: {
  person: Person;
  isMe: boolean;
  isAdminGroup: boolean;
  onEdit: () => void;
}) {
  const { user, activeRentals, pending } = person;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
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
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[user.email, user.studentId, user.phone].filter(Boolean).join(" · ") || "—"}
          </p>
          {(user.clubRoles?.length || user.academicState || user.major) && (
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
      <Button variant="ghost" size="icon" className="size-7" title="Edit profile" onClick={onEdit}>
        <Pencil className="size-3.5" />
      </Button>
    </li>
  );
}

export default function AdminPeople() {
  const { user: me } = useAuth();
  const people = useQuery(api.notifications.listPeople, {});
  const updateProfile = useMutation(api.users.updatePersonProfile);

  const [editing, setEditing] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);

  // edit form state
  const [editRole, setEditRole] = useState<"admin" | "member">("member");
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editAcademic, setEditAcademic] = useState("");
  const [editMajor, setEditMajor] = useState("");

  const openEdit = (p: Person) => {
    setEditing(p);
    setEditRole(p.user.role === "admin" ? "admin" : "member");
    setEditRoles(p.user.clubRoles ?? []);
    setEditAcademic(p.user.academicState ?? "");
    setEditMajor(p.user.major ?? "");
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
      });
      toast.success("Profile updated");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const admins = (people ?? []).filter((p) => p.user.role === "admin");
  const members = (people ?? []).filter((p) => p.user.role !== "admin");

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">People</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Club members, their real positions (رئيس / منسق / علمي / إداري / مدرب / إعلامي),
              and rental activity.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Use the <Pencil className="inline size-3" /> icon next to a name to edit roles.
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
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Users className="size-4 text-muted-foreground" /> Members ({members.length})
              </h2>
              {members.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No members yet — share the sign-in link with the club.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {members.map((p) => (
                    <PersonRow
                      key={p.user._id}
                      person={p}
                      isMe={p.user._id === me?._id}
                      isAdminGroup={false}
                      onEdit={() => openEdit(p)}
                    />
                  ))}
                </ul>
              )}
            </section>
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
    </AppShell>
  );
}