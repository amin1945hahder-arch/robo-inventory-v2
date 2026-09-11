import { useRef, useState } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ageFromIso, compressImageFile } from "@/lib/utils";
import { toast } from "sonner";
import { Camera, Github, Loader2, LogOut, Send, ShieldCheck } from "lucide-react";

// A member can request any of the club positions — the list is admin-editable
// (Settings → Club lists) and falls back to these defaults.
const FALLBACK_ROLES = [
  "رئيس نادي الروبوت",
  "منسق النادي",
  "عضو علمي",
  "عضو إداري",
  "مدرب",
  "عضو إعلامي",
];

export default function Profile() {
  const { user, signOut, signIn } = useAuth();
  const navigate = useNavigate();
  const dbRoles = useQuery(api.clubLists.getList, { key: "clubRoles" });
  const CLUB_ROLES = dbRoles ?? FALLBACK_ROLES;
  const requestChange = useMutation(api.notifications.requestProfileChange);
  const requestRank = useMutation(api.users.requestRankUpgrade);
  const setTgUser = useMutation(api.users.setMyTelegramUsername);
  const submitProfile = useMutation(api.users.submitMyProfile);
  const updateMyImage = useMutation(api.users.updateMyImage);
  const hasPendingRequest = useQuery(api.notifications.myPendingProfileRequest, {});
  const hasPendingRank = useQuery(api.users.myPendingRankRequest, {});

  const [name, setName] = useState(user?.name ?? "");
  const [studentId, setStudentId] = useState(user?.studentId ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [dob, setDob] = useState(user?.dateOfBirth ?? "");
  const [github, setGithub] = useState(user?.githubUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // rank request state
  const [wantedRoles, setWantedRoles] = useState<string[]>([]);
  const [rankMsg, setRankMsg] = useState("");

  // telegram username self-service
  const [tgName, setTgName] = useState(user?.telegramUsername ?? "");
  const [tgBusy, setTgBusy] = useState(false);

  // Keep the form in sync when the user object loads/changes after mount.
  const [syncedFor, setSyncedFor] = useState<string | null>(user?._id ?? null);
  if (user && syncedFor !== user._id) {
    setSyncedFor(user._id);
    setName(user.name ?? "");
    setStudentId(user.studentId ?? "");
    setPhone(user.phone ?? "");
    setDob(user.dateOfBirth ?? "");
    setGithub(user.githubUrl ?? "");
    setTgName(user.telegramUsername ?? "");
  }

  const isGuest = Boolean(user?.isAnonymous);
  const hasData = Boolean(user?.name && (user?.studentId || user?.phone));
  const approved = user?.role === "admin" || user?.profileApproved === true;
  const grandfathered = user?.profileApproved === undefined && hasData;
  const locked = !approved && !grandfathered;

  const pendingMine = hasPendingRequest === true;
  const rankMine = hasPendingRank === true;

  const toggleWanted = (r: string) => {
    setWantedRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  };

  // ===== GUESTS: view-only account → show a sign-in gate instead of a profile =====
  if (isGuest) {
    return (
      <AppShell>
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 rounded-lg border border-dashed px-8 py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary neon-ring">
            <ShieldCheck className="size-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">You're browsing as a guest</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Guests can look around the inventory, but interacting — renting, requesting,
              messaging — needs a real club account. Sign in to unlock your profile.
            </p>
          </div>
          <Button
            className="w-full"
            onClick={() => navigate(`/auth?returnTo=${encodeURIComponent("/profile")}`)}
          >
            Sign in / create account
          </Button>
        </div>
      </AppShell>
    );
  }

  const pickImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file (jpg/png/webp)");
      return;
    }
    setImgBusy(true);
    try {
      // Downscale client-side — avatars live on the user document, and large
      // base64 blobs there make every query that joins users heavy.
      const dataUrl = await compressImageFile(file);
      await updateMyImage({ image: dataUrl });
      toast.success("Profile picture updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setImgBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (locked && !hasData) {
        // First submission: unlock the profile (name + id/phone go live
        // immediately, still pending admin approval).
        await submitProfile({
          name: name.trim(),
          studentId: studentId.trim() || undefined,
          phone: phone.trim() || undefined,
        });
      } else {
        // Change request: everything (name, ids, DOB, GitHub) is applied
        // only after the admin approves it.
        await requestChange({
          name: name.trim(),
          studentId: studentId.trim(),
          phone: phone.trim(),
          dateOfBirth: dob,
          githubUrl: github.trim(),
        });
      }
      toast.success("Profile submitted — an admin will approve it shortly");
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

        {locked && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="font-medium text-amber-500">
              {hasData ? "Your profile is awaiting admin approval" : "Complete your profile to unlock the club"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasData
                ? "You can browse everything, but renting and requests unlock once an admin approves you."
                : "Fill in your name and student ID (or phone) below and submit — until approval you're read-only, like a guest."}
            </p>
          </div>
        )}

        {/* Identity card: picture + approval badge */}
        <section className="flex items-center gap-4 rounded-lg border p-5">
          <div className="relative">
            <Avatar className="size-16 border">
              <AvatarImage src={user?.image} />
              <AvatarFallback className="text-lg">
                {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              title="Change profile picture"
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:text-foreground"
            >
              {imgBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pickImage(f);
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user?.name ?? "Unnamed member"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {user?.role === "admin" ? (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Admin
                </span>
              ) : approved ? (
                <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  <ShieldCheck className="size-3" /> Approved member
                </span>
              ) : (
                <StatusBadge status="pending" />
              )}
              {user?.academicState && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {user.academicState}
                </span>
              )}
            </div>
          </div>
        </section>

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
            {user?.major && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                {user.major}
              </span>
            )}
          </div>
          {user?.dateOfBirth && (
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              {ageFromIso(user.dateOfBirth)} yrs
            </span>
          )}
          {user?.githubUrl && (
            <a
              href={user.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Github className="size-3" /> GitHub
            </a>
          )}
          {user?.studentCode && (
            <p className="font-mono text-xs text-muted-foreground">Club code: {user.studentCode}</p>
          )}
        </section>

        {/* Telegram username self-service */}
        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div>
            <h2 className="text-sm font-semibold">Telegram</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your @username so the club bot can tag you and message you in the club group when
              something concerns your rentals.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={tgName}
              onChange={(e) => setTgName(e.target.value)}
              placeholder="your Telegram @username (e.g. amin20haydar)"
            />
            <Button
              variant="outline"
              disabled={tgBusy || tgName.trim() === (user?.telegramUsername ?? "")}
              onClick={async () => {
                setTgBusy(true);
                try {
                  await setTgUser({ username: tgName });
                  toast.success("Telegram username saved");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setTgBusy(false);
                }
              }}
            >
              Save
            </Button>
          </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Date of birth</Label>
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">
                {ageFromIso(dob) !== null
                  ? `Shown as ${ageFromIso(dob)} years old across the app`
                  : "Your age (not the date) is what others see"}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>GitHub profile</Label>
              <Input
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                placeholder="https://github.com/username"
              />
            </div>
          </div>
          {locked && !hasData ? (
            <Button onClick={submit} disabled={busy} className="self-start">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Submit profile for approval
            </Button>
          ) : pendingMine ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status="pending" /> change awaiting admin approval
            </div>
          ) : (
            <Button onClick={submit} disabled={busy} className="self-start">
              <Send className="size-4" /> Request changes
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {locked
              ? "Approval unlocks rentals, requests and packages."
              : "Profile edits are reviewed by the lab admin before they are applied."}
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
