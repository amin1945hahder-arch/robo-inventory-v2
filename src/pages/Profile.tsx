import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { LogOut, Send } from "lucide-react";

// The club's real positions a member can request (matches the People page).
const CLUB_ROLES = [
  "رئيس نادي الروبوت",
  "منسق النادي",
  "عضو علمي",
  "عضو إداري",
  "مدرب",
  "عضو إعلامي",
] as const;

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const requestChange = useMutation(api.notifications.requestProfileChange);
  const requestRank = useMutation(api.users.requestRankUpgrade);
  const hasPendingRequest = useQuery(api.notifications.myPendingProfileRequest, {});
  const hasPendingRank = useQuery(api.users.myPendingRankRequest, {});
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  // rank request state
  const [wantedRoles, setWantedRoles] = useState<string[]>([]);
  const [rankMsg, setRankMsg] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setStudentId(user.studentId ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  const pendingMine = hasPendingRequest === true;
  const rankMine = hasPendingRank === true;

  const toggleWanted = (r: string) => {
    setWantedRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  };

  const submit = async () => {
    setBusy(true);
    try {
      await requestChange({
        name: name.trim() || undefined,
        studentId: studentId.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      toast.success("Change request sent to the admin for approval");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const submitRank = async () => {
    setBusy(true);
    try {
      await requestRank({ requestedRoles: wantedRoles, message: rankMsg.trim() || undefined });
      toast.success("Rank request sent to the admin");
      setWantedRoles([]);
      setRankMsg("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.email} · signed in as {user?.role === "admin" ? "admin" : "member"}
          </p>
        </header>

        {/* Current positions summary */}
        <section className="flex flex-col gap-3 rounded-lg border p-5">
          <h2 className="text-sm font-semibold">Your club profile</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {(user?.clubRoles ?? []).length > 0 ? (
              (user?.clubRoles ?? []).map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                  {r}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No positions yet — request one below.</span>
            )}
            {user?.academicState && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                {user.academicState}
              </span>
            )}
            {user?.major && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                {user.major}
              </span>
            )}
          </div>
          {user?.studentCode && (
            <p className="font-mono text-xs text-muted-foreground">Club code: {user.studentCode}</p>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <h2 className="text-sm font-semibold">Contact details</h2>
          <div className="grid gap-2">
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Student ID</Label>
              <Input value={studentId} onChange={(e) => setStudentId(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          {pendingMine ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status="pending" /> change awaiting admin approval
            </div>
          ) : (
            <Button onClick={submit} disabled={busy} className="self-start">
              <Send className="size-4" /> Request changes
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Profile edits are reviewed by the lab admin before they are applied.
          </p>
        </section>

        {/* Rank / position upgrade request */}
        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div>
            <h2 className="text-sm font-semibold">Request a rank / position upgrade</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask the admin to grant you club positions (e.g. عضو علمي → مدرب). Explain why — it
              helps them decide.
            </p>
          </div>
          {rankMine ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status="pending" /> your rank request is awaiting admin approval
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {CLUB_ROLES.map((r) => {
                  const on = wantedRoles.includes(r);
                  const have = (user?.clubRoles ?? []).includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={have}
                      onClick={() => toggleWanted(r)}
                      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                        have
                          ? "cursor-default border-border/50 bg-muted/40 text-muted-foreground/60 line-through"
                          : on
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
              <Textarea
                value={rankMsg}
                onChange={(e) => setRankMsg(e.target.value)}
                placeholder="Why do you deserve this position? (training done, projects built…)"
                rows={2}
              />
              <Button
                onClick={submitRank}
                disabled={busy || wantedRoles.length === 0}
                className="self-start"
              >
                <Send className="size-4" /> Send rank request
              </Button>
            </>
          )}
        </section>

        <Button
          variant="outline"
          className="self-start text-destructive"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </AppShell>
  );
}
