import { useRef, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { PermissionsManager } from "@/components/PermissionsManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ageFromIso, compressImageFile } from "@/lib/utils";
import { useAppearance } from "@/hooks/use-appearance";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Boxes, Camera, Check, Github, IdCard, Loader2, LogOut, MonitorSmartphone, Moon, Printer, Send, ShieldCheck, Sun } from "lucide-react";
import { PersonBadgeDialog } from "@/components/PersonBadgeDialog";
import { FontPicker } from "@/components/FontPicker";

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
  const appearance = useAppearance(user?._id);
  const dbRoles = useQuery(api.clubLists.getList, { key: "clubRoles" });
  const CLUB_ROLES = dbRoles ?? FALLBACK_ROLES;
  const requestChange = useMutation(api.notifications.requestProfileChange);
  const requestRank = useMutation(api.users.requestRankUpgrade);
  const setTgUser = useMutation(api.users.setMyTelegramUsername);
  const setTgChatMut = useMutation(api.users.setMyTelegramChatId);
  const submitProfile = useMutation(api.users.submitMyProfile);
  const updateMyImage = useMutation(api.users.updateMyImage);
  const hasPendingRequest = useQuery(api.notifications.myPendingProfileRequest, {});
  const hasPendingRank = useQuery(api.users.myPendingRankRequest, {});
  const hasPendingPrinter = useQuery(api.users.myPendingPrinterRequest, {});
  const requestPrinter = useMutation(api.users.requestPrinterRole);
  // Main access-level request (member / admin) — stored as a rankRequest with
  // kind "role", decided in the Requests console like every other request.
  const requestRole = useMutation(api.users.requestRoleUpgrade);
  // Inventory-manager privilege (stacks on any role, like printer access).
  const hasPendingInventory = useQuery(api.users.myPendingInventoryRequest, {});
  const requestInventory = useMutation(api.users.requestInventoryRole);

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
  const [printerMsg, setPrinterMsg] = useState("");
  // main access-level + inventory request state
  const [wantedRole, setWantedRole] = useState<"member" | "admin">("member");
  const [roleMsg, setRoleMsg] = useState("");
  const [inventoryMsg, setInventoryMsg] = useState("");

  // telegram username + chat id self-service
  const [tgName, setTgName] = useState(user?.telegramUsername ?? "");
  const [tgChat, setTgChat] = useState(user?.telegramChatId ?? "");
  const [tgBusy, setTgBusy] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);

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
    setTgChat(user.telegramChatId ?? "");
  }

  const isGuest = Boolean(user?.isAnonymous);
  const hasData = Boolean(user?.name && (user?.studentId || user?.phone));
  const approved = user?.role === "admin" || user?.profileApproved === true;
  const grandfathered = user?.profileApproved === undefined && hasData;
  const locked = !approved && !grandfathered;

  const pendingMine = hasPendingRequest === true;
  const rankMine = hasPendingRank === true;
  const printerMine = hasPendingPrinter === true;
  const isPrinter = user?.role === "admin" || user?.printerRole === true;
  const inventoryMine = hasPendingInventory === true;
  const isInventoryManager = user?.role === "admin" || user?.inventoryRole === true;
  // The picker must never point at the role the member already holds — when
  // the stored choice equals the current role, show the OTHER one selected.
  const wanted =
    user?.role === wantedRole ? (wantedRole === "member" ? "admin" : "member") : wantedRole;

  const toggleWanted = (r: string) => {
    setWantedRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  };

  // ===== GUESTS: view-only account → show a sign-in gate instead of a profile =====
  if (isGuest) {
    return (
      <AppShell>
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 glass-3d rounded-lg border border-dashed px-8 py-16 text-center">
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
      toast.error(asMessage(e));
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
      toast.error(asMessage(e));
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
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitPrinterRequest = async () => {
    setBusy(true);
    try {
      await requestPrinter({ message: printerMsg.trim() || undefined });
      toast.success("Printer access requested — an admin will review it");
      setPrinterMsg("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitRoleRequest = async () => {
    setBusy(true);
    try {
      await requestRole({ role: wanted, message: roleMsg.trim() || undefined });
      toast.success("Access request sent to the admin");
      setRoleMsg("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitInventoryRequest = async () => {
    setBusy(true);
    try {
      await requestInventory({ message: inventoryMsg.trim() || undefined });
      toast.success("Inventory request sent to the admin");
      setInventoryMsg("");
    } catch (e) {
      toast.error(asMessage(e));
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
          <div className="glass-3d rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
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
        <section className="flex items-center gap-4 glass-3d rounded-lg border p-5">
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
              {imgBusy ? <LoadingGifInline size={18} className="size-3.5" /> : <Camera className="size-3.5" />}
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
              <button
                type="button"
                title="Show my badge card"
                onClick={() => setBadgeOpen(true)}
                className="flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <IdCard className="size-3" /> Badge
              </button>
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
        <section className="flex flex-col gap-3 glass-3d rounded-lg border p-5">
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
        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
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
                  toast.error(asMessage(e));
                } finally {
                  setTgBusy(false);
                }
              }}
            >
              Save
            </Button>
          </div>
          <div className="grid gap-2">
            <Label>Chat ID (for personal bot DMs)</Label>
            <div className="flex gap-2">
              <Input
                value={tgChat}
                onChange={(e) => setTgChat(e.target.value)}
                placeholder="e.g. 123456789"
                inputMode="numeric"
              />
              <Button
                variant="outline"
                disabled={tgBusy || tgChat.trim() === (user?.telegramChatId ?? "")}
                onClick={async () => {
                  setTgBusy(true);
                  try {
                    await setTgChatMut({ chatId: tgChat.trim() });
                    toast.success("Telegram chat ID saved");
                  } catch (e) {
                    toast.error(asMessage(e));
                  } finally {
                    setTgBusy(false);
                  }
                }}
              >
                Save
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Easiest: just message the club bot once on Telegram — it links your chat ID
              automatically. Or paste your numeric ID here (get it from @userinfobot).
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
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
              {busy ? <LoadingGifInline size={18} className="size-4" /> : <Send className="size-4" />}
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

        {/* Device permissions — notifications, camera, storage, sounds. */}
        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" /> Device permissions
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              What the app may do on this device. Works the same in the browser,
              installed app, or phone wrapper (APK/iOS).
            </p>
          </div>
          <PermissionsManager />
        </section>

        {/* App mode — per-member appearance, mirrors Settings → App mode */}
        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MonitorSmartphone className="size-4" /> App mode
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              How the app looks for you — dark, light, or following your device. Only affects your
              own view.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              { id: "dark", label: "Dark", icon: Moon },
              { id: "light", label: "Light", icon: Sun },
              { id: "system", label: "System", icon: MonitorSmartphone },
            ] as const).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => void appearance.save({ value: o.id })}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                  appearance.mode === o.id
                    ? "border-primary bg-primary/10"
                    : "hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <o.icon className="size-4 text-primary" />
                <span className="text-sm font-medium">{o.label}</span>
                {appearance.mode === o.id && (
                  <Check className="ml-auto size-4 text-primary" />
                )}
              </button>
            ))}
          </div>
          <div className="grid gap-2 border-t border-border/40 pt-4">
            <div>
              <h2 className="text-sm font-semibold">Font</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick the typeface used across the app — saved to your account and applied
                on every device. Arabic-ready families included.
              </p>
            </div>
            <FontPicker />
          </div>
        </section>

        {/* Main account access level (member / admin) — requestable by any non-admin */}
        {user?.role !== "admin" && (
          <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" /> Account access level
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Request a step up to a main app role — <span className="font-medium">member</span>{" "}
                unlocks rentals and requests, <span className="font-medium">admin</span> manages the
                whole console. The admin reviews every request.
              </p>
            </div>
            {rankMine ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <StatusBadge status="pending" /> your access request is awaiting admin approval
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(["member", "admin"] as const).map((r) => {
                    const have = user?.role === r;
                    const on = wanted === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        disabled={have}
                        onClick={() => setWantedRole(r)}
                        className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                          have
                            ? "cursor-default border-border/50 bg-muted/40 text-muted-foreground/60 line-through"
                            : on
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {r === "member" ? "Member" : "Admin"}
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  value={roleMsg}
                  onChange={(e) => setRoleMsg(e.target.value)}
                  placeholder="Why do you need this access level? (what you'll manage, experience…)"
                  rows={2}
                />
                <Button
                  onClick={submitRoleRequest}
                  disabled={busy || user?.role === wanted}
                  className="self-start"
                >
                  <Send className="size-4" /> Request {wanted === "admin" ? "admin" : "member"}{" "}
                  access
                </Button>
              </>
            )}
          </section>
        )}

        {/* Printer privilege (stacks on any role; admins hold it implicitly) */}
        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Printer className="size-4 text-cyan-400" /> Printer access
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The printer privilege unlocks Slicer Studio submissions and print
              scheduling. It stacks on any role — admins hold it implicitly.
            </p>
          </div>
          {isPrinter ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Printer className="size-4" /> you have printer access
            </div>
          ) : printerMine ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status="pending" /> your printer request is awaiting admin approval
            </div>
          ) : (
            <>
              <Textarea
                value={printerMsg}
                onChange={(e) => setPrinterMsg(e.target.value)}
                placeholder="Why do you need printer access? (slicing experience, current project…)"
                rows={2}
              />
              <Button
                onClick={submitPrinterRequest}
                disabled={busy}
                className="self-start"
              >
                <Send className="size-4" /> Request printer access
              </Button>
            </>
          )}
        </section>

        {/* Inventory manager privilege (stacks on any role, like printer access) */}
        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Boxes className="size-4 text-amber-400" /> Inventory manager
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage the shelf: add, edit and delete items, groups and stock. It stacks on any
              role like printer access — the admin grants it with per-action permissions
              (edit / add / delete).
            </p>
          </div>
          {isInventoryManager ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-400">
              <Boxes className="size-4" /> you have inventory manager access
              {user?.inventoryPerms && (
                <span className="flex flex-wrap gap-1">
                  {(["edit", "add", "delete"] as const).map((p) => (
                    <span
                      key={p}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        user?.inventoryPerms?.[p]
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : "border-border bg-muted/60 text-muted-foreground line-through",
                      )}
                    >
                      {p}
                    </span>
                  ))}
                </span>
              )}
            </div>
          ) : inventoryMine ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status="pending" /> your inventory request is awaiting admin approval
            </div>
          ) : (
            <>
              <Textarea
                value={inventoryMsg}
                onChange={(e) => setInventoryMsg(e.target.value)}
                placeholder="Why do you need inventory manager access? (restocking, lab duties…)"
                rows={2}
              />
              <Button
                onClick={submitInventoryRequest}
                disabled={busy}
                className="self-start"
              >
                <Send className="size-4" /> Request inventory access
              </Button>
            </>
          )}
        </section>

        {/* Rank / position upgrade request */}
        <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
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

        {badgeOpen && (
          <PersonBadgeDialog
            p={{
              userId: user!._id,
              name: user?.name ?? user?.email ?? "Member",
              email: user?.email,
              image: user?.image,
              role: user?.role,
              studentId: user?.studentId,
              clubRoles: user?.clubRoles,
              academicState: user?.academicState,
              major: user?.major,
              phone: user?.phone,
              telegramUsername: user?.telegramUsername,
            }}
            onClose={() => setBadgeOpen(false)}
          />
        )}
      </div>
    </AppShell>
  );
}
