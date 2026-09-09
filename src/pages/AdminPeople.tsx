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
import { toast } from "sonner";
import { ShieldCheck, UserCog, Users } from "lucide-react";

type Person = {
  user: {
    _id: string;
    name?: string;
    email?: string;
    image?: string;
    role?: string;
    studentId?: string;
    phone?: string;
  };
  activeRentals: number;
  pending: number;
};

export default function AdminPeople() {
  const { user: me } = useAuth();
  const people = useQuery(api.notifications.listPeople, {});
  const promote = useMutation(api.parts.promoteByEmail);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await promote({ email: email.trim(), role });
      toast.success(`${email.trim()} is now ${role === "admin" ? "an admin" : "a member"}`);
      setOpen(false);
      setEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">People</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Club members, their roles and rental activity.
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <UserCog className="size-4" /> Set role by email
          </Button>
        </header>

        {people === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
            <Users className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No members have signed in yet.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {people.map(({ user, activeRentals, pending }) => (
              <li key={user._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {user.name ?? "Unnamed member"}
                      {user._id === me?._id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[user.email, user.studentId, user.phone].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    user.role === "admin"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {user.role === "admin" ? "Admin" : "Member"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {activeRentals} active · {pending} pending
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set a member's role</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Email (they must have signed in once)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@university.edu" />
            </div>
            <div className="grid gap-2">
              <Label>Role</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={role === "admin" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setRole("admin")}
                >
                  <ShieldCheck className="size-4" /> Admin
                </Button>
                <Button
                  type="button"
                  variant={role === "member" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setRole("member")}
                >
                  Member
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !email.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
