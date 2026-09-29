import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { CardLayoutSection } from "@/components/CardLayoutSection";
import { PermissionsManager } from "@/components/PermissionsManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Bell,
  Boxes,
  Check,
  ClipboardList,
  DatabaseBackup,
  FolderTree,
  Hash,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Moon,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ScanLine,
  SendHorizonal,
  ShieldCheck,
  Sun,
  Trash2,
  TriangleAlert,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ========================================================================= */
/* Shared small components                                                    */
/* ========================================================================= */

/** One admin-editable list (positions or academic states). */
function ListEditor({
  title,
  hint,
  listKey,
  values,
}: {
  title: string;
  hint: string;
  listKey: "clubRoles" | "academicStates";
  values: string[] | undefined;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const saveList = useMutation(api.clubLists.setList);

  useEffect(() => {
    if (values !== undefined && !synced) {
      setSynced(true);
      setItems(values);
    }
  }, [values, synced]);

  const save = async (next: string[]) => {
    setBusy(true);
    try {
      await saveList({ key: listKey, values: next });
      setItems(next);
      toast.success(`${title} updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Label className="text-sm font-semibold">{title}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {(values ?? items).map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-full border bg-muted/60 px-2.5 py-1 text-xs"
          >
            {v}
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-destructive"
              disabled={busy}
              onClick={() => save(items.filter((x) => x !== v))}
              title="Remove"
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        ))}
        {values === undefined && <LoadingGifInline size={18} className="size-4" />}
      </div>
      <div className="flex max-w-sm gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={`Add to ${title.toLowerCase()}…`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newItem.trim()) {
              save([...items, newItem.trim()]);
              setNewItem("");
            }
          }}
        />
        <Button
          variant="outline"
          disabled={busy || !newItem.trim()}
          onClick={() => {
            save([...items, newItem.trim()]);
            setNewItem("");
          }}
        >
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}

/** Data backup: schedule + manual "Backup now" (full .zip to the APP group). */
function DataBackupSection() {
  const backupSettings = useQuery(api.appBackup.getBackupSettings, {});
  const appTopics = useQuery(api.telegramTopics.listTopics, { bot: "app" });
  const saveSettings = useMutation(api.appBackup.setBackupSettings);
  const backupNow = useAction(api.appBackup.backupNow);

  const [enabled, setEnabled] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [threadId, setThreadId] = useState("");
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    if (backupSettings !== undefined) {
      setEnabled(backupSettings.enabled);
      setDayOfMonth(String(backupSettings.dayOfMonth || 1));
      setThreadId(backupSettings.threadId ? String(backupSettings.threadId) : "");
    }
  }, [backupSettings]);

  const save = async () => {
    setBusy(true);
    try {
      const d = Number(dayOfMonth);
      await saveSettings({
        enabled,
        dayOfMonth: Number.isFinite(d) ? d : 1,
        threadId: threadId.trim() ? Number(threadId) : undefined,
      });
      toast.success("Backup schedule saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const runBackup = async () => {
    setBackingUp(true);
    try {
      const res = await backupNow({});
      if (res.sent) {
        toast.success(
          `Backup sent to the APP group ✅ ${res.fileName} (${Math.round(res.bytes / 1024)} KB)`,
        );
      } else {
        toast.error(`Backup not sent: ${res.reason ?? "unknown"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <DatabaseBackup className="size-4" /> Full data backup
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Zips the entire app database — one CSV per table (like the Export studio) plus a
          structured <code>data.json</code> and a <code>schema.sql</code> any SQL engine can import
          — and posts the archive into the APP group. Bot tokens are redacted; device login tokens
          and chat relay rows are never included.
        </p>
      </div>

      {backupSettings === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingGifInline size={18} className="size-4" /> Loading backup settings…
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Schedule */}
            <div className="grid gap-3 glass-3d rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Auto-backup schedule
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable schedule</p>
                  <p className="text-xs text-muted-foreground">Run automatically every month</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="backup-day" className="text-xs">
                  Day of the month (1–28, UTC)
                </Label>
                <Input
                  id="backup-day"
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className="max-w-32"
                  disabled={!enabled}
                />
              </div>
            </div>

            {/* Destination */}
            <div className="grid gap-3 glass-3d rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Destination — APP group topic
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="backup-topic" className="text-xs">
                  Topic id (from APP topics)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {(appTopics ?? []).map((t) => (
                    <button
                      key={t._id}
                      type="button"
                      onClick={() => setThreadId(String(t.threadId))}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                        threadId === String(t.threadId)
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.name} ({t.threadId})
                    </button>
                  ))}
                  {appTopics !== undefined && appTopics.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No APP topics configured yet — the backup will land in the group's General
                      chat. Add topics in the “APP topics” tab.
                    </p>
                  )}
                </div>
                <Input
                  id="backup-topic"
                  value={threadId}
                  onChange={(e) => setThreadId(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 42 — empty = General chat"
                />
              </div>
            </div>
          </div>

          <Button className="self-start" disabled={busy} onClick={save}>
            {busy ? <LoadingGifInline size={18} className="size-4" /> : <Save className="size-4" />}
            Save backup settings
          </Button>

          <div className="flex flex-col gap-2 glass-3d rounded-md border border-dashed p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Backup now</p>
                <p className="text-xs text-muted-foreground">
                  Build the archive and send it immediately — same pipeline as the schedule.
                </p>
              </div>
              <Button disabled={backingUp} onClick={runBackup}>
                {backingUp ? (
                  <LoadingGifInline size={18} className="size-4" />
                ) : (
                  <DatabaseBackup className="size-4" />
                )}
                Backup now
              </Button>
            </div>
            {backupSettings.lastRunAt && (
              <p className="text-xs text-muted-foreground">
                Last scheduled run: {new Date(backupSettings.lastRunAt).toLocaleString()} —{" "}
                {backupSettings.lastResult ?? "unknown result"}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Dangerous zone: full database reset with email verification + DELETE ALL.
 * Two-step: request a code (emailed), then confirm with code + phrase.
 */
function ResetDatabaseCard() {
  const requestReset = useAction(api.resetDb.requestReset);
  const confirmReset = useAction(api.resetDb.confirmReset);
  const [stage, setStage] = useState<"idle" | "awaiting">("idle");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [phrase, setPhrase] = useState("");

  const requestCode = async () => {
    setBusy(true);
    try {
      const res = await requestReset({});
      setStage("awaiting");
      toast.success(
        res.via === "telegram"
          ? "Email pipeline was down — the code was sent to your Telegram DM instead"
          : "Verification code emailed — check your inbox",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await confirmReset({ code, confirmPhrase: phrase });
      const total = Object.entries(res.counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      toast.success(`Database reset complete — deleted: ${total}`);
      setStage("idle");
      setCode("");
      setPhrase("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border border-red-500/40 bg-red-500/5 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-400">
          <TriangleAlert className="size-4" /> Danger zone — reset the database
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently deletes every inventory item, rental, request, project, chat relay row and
          person — except you (the admin confirming) and the app settings. A verification code is
          emailed to you, and you must type DELETE ALL to confirm. This cannot be undone.
        </p>
      </div>
      {stage === "idle" ? (
        <Button variant="destructive" className="self-start" disabled={busy} onClick={requestCode}>
          {busy ? <LoadingGifInline size={18} className="size-4" /> : <TriangleAlert className="size-4" />}
          Email me a reset code
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="reset-code">Email verification code</Label>
            <Input
              id="reset-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="reset-phrase">Type DELETE ALL to confirm</Label>
            <Input
              id="reset-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="DELETE ALL"
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy || phrase.trim() !== "DELETE ALL" || code.trim().length === 0}
              onClick={confirm}
            >
              {busy ? <LoadingGifInline size={18} className="size-4" /> : <Trash2 className="size-4" />}
              Delete everything
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setStage("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ========================================================================= */
/* Telegram: bots, groups, topics                                             */
/* ========================================================================= */

type BotId = "app" | "printer";

type Topic = { _id: string; bot: BotId; threadId: number; name: string; categories: string[] };

const CATEGORIES = [
  { key: "rentals", label: "Rentals & returns" },
  { key: "requests", label: "Requests & approvals" },
  { key: "printers", label: "Printing" },
  { key: "projects", label: "Projects" },
  { key: "members", label: "Members" },
  { key: "inventory", label: "Inventory" },
  { key: "courses", label: "Courses" },
  { key: "system", label: "System / other" },
] as const;

/** One topic card: editable name/id + category routing chips. */
function TopicCard({ topic }: { topic: Topic }) {
  const removeTopic = useMutation(api.telegramTopics.deleteTopic);
  const updateTopic = useMutation(api.telegramTopics.updateTopic);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.name);
  const [threadId, setThreadId] = useState(String(topic.threadId));
  const [busy, setBusy] = useState(false);

  const routed = new Set(topic.categories);

  const toggleCategory = async (key: string) => {
    const wasOn = routed.has(key);
    const next = wasOn ? topic.categories.filter((c) => c !== key) : [...topic.categories, key];
    setBusy(true);
    try {
      await updateTopic({ id: topic._id as Id<"telegramTopics">, categories: next });
      toast.success(
        wasOn ? `“${key}” unassigned from ${topic.name}` : `“${key}” → topic “${topic.name}”`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    setBusy(true);
    try {
      await updateTopic({
        id: topic._id as Id<"telegramTopics">,
        name: name.trim(),
        threadId: Number(threadId),
      });
      setEditing(false);
      toast.success("Topic updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-3d rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px]">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Topic name" />
            <Input
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              inputMode="numeric"
              placeholder="Topic id"
            />
          </div>
        ) : (
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Hash className="size-3.5 text-primary" /> {topic.name}
            </p>
            <p className="text-xs text-muted-foreground">
              topic id {topic.threadId} · {topic.categories.length} categor
              {topic.categories.length === 1 ? "y" : "ies"} routed
            </p>
          </div>
        )}
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdits} disabled={busy || !name.trim()}>
                {busy ? <LoadingGifInline size={18} className="size-3.5" /> : <Save className="size-3.5" />}
              </Button>
            </>
          ) : (
            <>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={async () => {
                  try {
                    await removeTopic({ id: topic._id as Id<"telegramTopics"> });
                    toast.success(`Topic “${topic.name}” deleted`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {CATEGORIES.map(({ key, label }) => {
          const on = routed.has(key);
          return (
            <button
              key={key}
              type="button"
              disabled={busy}
              onClick={() => toggleCategory(key)}
              title={on ? `Click to unassign “${label}”` : `Send “${label}” notifications here`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                on
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Topics panel for one bot group (APP or PRINTER): list + add form. */
function TopicsPanel({ bot }: { bot: BotId }) {
  const topics = useQuery(api.telegramTopics.listTopics, { bot });
  const addTopic = useMutation(api.telegramTopics.addTopic);
  const [name, setName] = useState("");
  const [threadId, setThreadId] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await addTopic({ bot, name: name.trim(), threadId: Number(threadId) });
      toast.success(`Topic “${name.trim()}” added`);
      setName("");
      setThreadId("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const isApp = bot === "app";
  const groupLabel = isApp ? "APP group" : "PRINTER group";

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {isApp
          ? "The APP group has topics (forum) enabled. Add each Telegram topic's id here, then assign the notification categories that should be posted into it."
          : "If the PRINTER group also has topics enabled, add them here and route printing categories into them — otherwise leave it empty and posts land in the group's General chat."}
      </p>

      {topics === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingGifInline size={18} className="size-4" /> Loading topics…
        </p>
      ) : topics.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No topics configured for the {groupLabel} yet — every notification posts to the group's
          General chat.
        </p>
      ) : (
        <div className="grid gap-2">
          {topics.map((t) => (
            <TopicCard key={t._id} topic={t} />
          ))}
        </div>
      )}

      <div className="grid gap-2 glass-3d rounded-md border border-dashed p-3 sm:grid-cols-[1fr_160px_auto]">
        <div className="grid gap-1">
          <Label className="text-xs">New topic name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. now" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Topic id</Label>
          <Input
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 42"
          />
        </div>
        <div className="flex items-end">
          <Button disabled={busy || !name.trim() || !threadId.trim()} onClick={add} className="w-full">
            {busy ? <LoadingGifInline size={18} className="size-4" /> : <Plus className="size-4" />} Add
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        The topic id is the <code>message_thread_id</code> — forward a topic message to
        @userinfobot, or open the topic in Telegram Web and read the id from the URL
        (#-100…_42). A category can only be routed to one topic per group.
      </p>
    </div>
  );
}

/* ========================================================================= */
/* Per-user notification sounds                                               */
/* ========================================================================= */

function MySoundsSection() {
  const cfg = useQuery(api.settings.getMySounds, {});
  const saveSounds = useMutation(api.settings.setMySounds);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (cfg !== undefined) setEnabled(cfg.enabled);
  }, [cfg]);

  const previewTone = (freq: number, dur: number, vol?: number) => {
    try {
      const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const peak = Math.min(1, Math.max(0, (vol ?? 18) / 100));
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
      osc.onended = () => void ctx.close();
    } catch {
      /* autoplay policy before first interaction */
    }
  };

  const LABELS: Record<string, { label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = {
    scan: { label: "Scan", hint: "Successful QR/barcode scan", icon: ScanLine },
    rental_request: { label: "Rental request", hint: "You submit a new request", icon: ClipboardList },
    approved: { label: "Approved", hint: "Request approved / picked up", icon: Check },
    denied: { label: "Denied", hint: "Request denied", icon: X },
    returned: { label: "Returned", hint: "Unit back on the shelf", icon: RotateCcw },
    assigned: { label: "Assigned", hint: "Unit assigned to a project", icon: Boxes },
    notification: { label: "Notification", hint: "Any other update", icon: Bell },
  };

  // One save per slider drag batch — local state keeps the drag smooth.
  const patch = async (key: string, nextSpec: { freq: number; dur: number; vol?: number }) => {
    if (!cfg) return;
    const next = { ...cfg.sounds, [key]: nextSpec };
    try {
      await saveSounds({ enabled: cfg.enabled, sounds: next });
    } catch {
      /* keep the UI responsive even if the save fails */
    }
  };

  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Volume2 className="size-4" /> Notification sounds — my settings
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These are YOUR tones — every member tunes their own sounds without affecting anyone
            else. They play for scans, requests, decisions and updates.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={async (v) => {
            if (!cfg) return;
            setEnabled(v);
            try {
              await saveSounds({ enabled: v, sounds: cfg.sounds });
              toast.success(v ? "Sounds on for you" : "You muted all sounds");
              if (v) previewTone(cfg.sounds.notification?.freq ?? 740, 0.1, cfg.sounds.notification?.vol);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed");
              setEnabled(!v);
            }
          }}
        />
      </div>

      {cfg === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingGifInline size={18} className="size-4" /> Loading your sound settings…
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(cfg.sounds).map(([key, spec]) => {
            const meta = LABELS[key] ?? { label: key.replace(/_/g, " "), hint: "", icon: Volume2 };
            const Icon = meta.icon;
            return (
              <div key={key} className="flex flex-col gap-3 glass-3d rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <Icon className="size-4 text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{meta.label}</p>
                      {meta.hint && (
                        <p className="truncate text-[11px] text-muted-foreground">{meta.hint}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    title="Preview tone"
                    onClick={() => previewTone(spec.freq, spec.dur, spec.vol)}
                  >
                    <Volume2 className="size-4" />
                  </Button>
                </div>
                {/* Three full-width sliders — pitch, length, volume. */}
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pitch</span>
                    <Slider
                      min={150}
                      max={1400}
                      step={10}
                      value={[spec.freq]}
                      onValueChange={([freq]) => void patch(key, { ...spec, freq })}
                      onValueCommit={() => previewTone(spec.freq, spec.dur, spec.vol)}
                      className="flex-1"
                    />
                    <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{spec.freq} Hz</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Length</span>
                    <Slider
                      min={0.03}
                      max={0.8}
                      step={0.01}
                      value={[spec.dur]}
                      onValueChange={([dur]) => void patch(key, { ...spec, dur })}
                      onValueCommit={() => previewTone(spec.freq, spec.dur, spec.vol)}
                      className="flex-1"
                    />
                    <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{spec.dur.toFixed(2)} s</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Volume</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[spec.vol ?? 18]}
                      onValueChange={([vol]) => void patch(key, { ...spec, vol })}
                      onValueCommit={() => previewTone(spec.freq, spec.dur, spec.vol)}
                      className="flex-1"
                    />
                    <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{spec.vol ?? 18}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ========================================================================= */
/* Per-user appearance (app mode)                                              */
/* ========================================================================= */

function AppearanceSection() {
  const cfg = useQuery(api.settings.getMyAppearance, {});
  const save = useMutation(api.settings.setMyAppearance);
  const [value, setValue] = useState<"dark" | "light" | "system">("dark");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (cfg !== undefined) setValue(cfg);
  }, [cfg]);

  const choose = async (next: "dark" | "light" | "system") => {
    if (pending) return;
    setPending(true);
    const prev = value;
    setValue(next);
    // Apply immediately for instant feedback (the AppShell hook also applies
    // it once the DB value round-trips).
    document.documentElement.classList.toggle(
      "dark",
      next === "dark" ||
        (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
    document.documentElement.style.colorScheme =
      next === "light" || (next === "system" && !window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "light"
        : "dark";
    try {
      await save({ value: next });
      toast.success(
        next === "system"
          ? "App follows your system mode"
          : next === "dark"
            ? "Dark mode on for you"
            : "Light mode on for you",
      );
    } catch (e) {
      setValue(prev);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  const options = [
    { id: "dark", label: "Dark", icon: Moon, hint: "Neon dark theme" },
    { id: "light", label: "Light", icon: Sun, hint: "Bright daylight theme" },
    { id: "system", label: "System", icon: MonitorSmartphone, hint: "Follow my device" },
  ] as const;

  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MonitorSmartphone className="size-4" /> App mode — my appearance
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose how the app looks for YOU — dark, light, or following your device. Every member has
          their own setting; it applies on all your devices after sign-in.
        </p>
      </div>
      {cfg === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingGifInline size={18} /> Loading your appearance…
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => void choose(o.id)}
              disabled={pending}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                value === o.id
                  ? "border-primary bg-primary/10"
                  : "hover:border-primary/40 hover:bg-muted/40",
                pending && "opacity-60",
              )}
            >
              <o.icon className="size-4 text-primary" />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
              {value === o.id && <Check className="ml-auto size-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ========================================================================= */
/* Inventory structure: categories & storages                                  */
/* ========================================================================= */

/** Inline edit/delete list for one entity type (categories or storages). */
function StructureList({
  kind,
}: {
  kind: "categories" | "closets";
}) {
  const isCategory = kind === "categories";
  const rows = useQuery(
    isCategory ? api.catalog.listCategories : api.catalog.listClosets,
    {},
  );
  const upsert = useMutation(
    isCategory ? api.catalog.upsertCategory : api.catalog.upsertCloset,
  );
  const setConsumable = useMutation(api.catalog.setCategoryConsumable);
  const remove = useMutation(
    isCategory ? api.catalog.deleteCategory : api.catalog.deleteCloset,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const detailLabel = isCategory ? "Description" : "Location";

  const startEdit = (r: { _id: string; name: string }) => {
    setEditingId(r._id);
    setName(r.name);
    setDetail("");
  };

  const save = async (row: { _id: string }) => {
    setBusy(true);
    try {
      if (isCategory) {
        await upsert({ id: row._id as Id<"categories">, name });
      } else {
        await upsert({ id: row._id as Id<"closets">, name });
      }
      toast.success(isCategory ? "Category updated" : "Storage updated");
      setEditingId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const del = async (row: { _id: string; name: string }) => {
    if (
      !confirm(
        isCategory
          ? `Delete category “${row.name}”? Categories with groups cannot be deleted.`
          : `Delete storage “${row.name}”? Storages with groups cannot be deleted.`,
      )
    )
      return;
    try {
      await remove({ id: row._id as never });
      toast.success(`${isCategory ? "Category" : "Storage"} “${row.name}” deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="grid gap-2">
      {rows === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingGifInline size={18} className="size-4" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r._id}
            className="flex flex-wrap items-center gap-2 glass-3d rounded-md border px-3 py-2"
          >
            {editingId === r._id ? (
              <>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 max-w-56 flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) void save(r);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <Button
                  size="sm"
                  disabled={busy || !name.trim() || name.trim() === r.name}
                  onClick={() => save(r)}
                >
                  {busy ? <LoadingGifInline size={18} className="size-3.5" /> : <Save className="size-3.5" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                {isCategory && "consumable" in r && (
                  <Switch
                    checked={(r as any).consumable === true}
                    onCheckedChange={(v) =>
                      setConsumable({ id: r._id as never, consumable: v })
                        .then(() =>
                          toast.success(
                            v
                              ? `“${r.name}” marked consumable — returns ask how much came back`
                              : `“${r.name}” marked non-consumable`,
                          ),
                        )
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                    }
                    aria-label="Consumable"
                  />
                )}
                {isCategory && "consumable" in r && (
                  <span className="w-24 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {(r as any).consumable ? "consumable" : "returnable"}
                  </span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  title="Rename"
                  onClick={() => startEdit(r)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  title="Delete"
                  onClick={() => del(r)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        ))
      )}
      <p className="text-[11px] text-muted-foreground">
        Names must be unique. Deleting is blocked while {isCategory ? "categories" : "storages"} still
        contain component groups — move or delete those first.
      </p>
    </div>
  );
}

/** Settings section: edit all categories and storages (rename / delete). */
function InventoryStructureSection() {
  const [tab, setTab] = useState<"categories" | "storages">("categories");
  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FolderTree className="size-4" /> Inventory structure
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rename or delete categories and storages. Changes apply everywhere instantly — QR labels
          keep working because they point at ids, not names.
        </p>
      </div>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={tab === "categories" ? "default" : "outline"}
          onClick={() => setTab("categories")}
        >
          Categories
        </Button>
        <Button
          size="sm"
          variant={tab === "storages" ? "default" : "outline"}
          onClick={() => setTab("storages")}
        >
          Storages
        </Button>
      </div>
      {tab === "categories" ? <StructureList kind="categories" /> : <StructureList kind="closets" />}
    </section>
  );
}

/* ========================================================================= */
/* The Settings page                                                          */
/* ========================================================================= */

type SectionId =
  | "telegram"
  | "topics-app"
  | "topics-printer"
  | "backup"
  | "sounds"
  | "appearance"
  | "returns"
  | "structure"
  | "lists"
  | "chat-backup"
  | "card-layout"
  | "permissions"
  | "danger";

const SECTIONS: { id: SectionId; label: string; icon: typeof Hash; hint: string }[] = [
  { id: "telegram", label: "Bots & groups", icon: MessageSquare, hint: "Two bots, two groups" },
  { id: "topics-app", label: "APP topics", icon: Hash, hint: "Route notifications to topics" },
  { id: "topics-printer", label: "Printer topics", icon: Printer, hint: "Print-farm topic routing" },
  { id: "backup", label: "Data backup", icon: DatabaseBackup, hint: "Full .zip to the APP group" },
  { id: "sounds", label: "My sounds", icon: Volume2, hint: "Your personal tones" },
  { id: "appearance", label: "App mode", icon: MonitorSmartphone, hint: "Dark / light / system" },
  { id: "returns", label: "Return rules", icon: Bell, hint: "Return-request cooldown" },
  { id: "structure", label: "Inventory structure", icon: FolderTree, hint: "Categories & storages" },
  { id: "card-layout", label: "Card print layout", icon: Printer, hint: "Page, card size & position" },
  { id: "permissions", label: "Device permissions", icon: ShieldCheck, hint: "Notifications, camera, storage, sounds" },
  { id: "lists", label: "Club lists", icon: Boxes, hint: "Positions & academic states" },
  { id: "chat-backup", label: "Chat backups", icon: MessageSquare, hint: "Archive destinations" },
  { id: "danger", label: "Danger zone", icon: TriangleAlert, hint: "Reset the database" },
];

export default function AdminSettings() {
  const tg = useQuery(api.settings.getTelegram, {});
  const cooldown = useQuery(api.settings.getReturnCooldown, {});
  const roles = useQuery(api.clubLists.getList, { key: "clubRoles" });
  const states = useQuery(api.clubLists.getList, { key: "academicStates" });
  const backupDest = useQuery(api.settings.getChatBackupDestination, {});

  const saveTg = useMutation(api.settings.setTelegram);
  const saveCooldown = useMutation(api.settings.setReturnCooldown);
  const saveBackupDest = useMutation(api.settings.setChatBackupDestination);
  const testSend = useAction(api.settings.sendTestMessage);

  const [section, setSection] = useState<SectionId>("telegram");

  const [appToken, setAppToken] = useState("");
  const [printerToken, setPrinterToken] = useState("");
  const [groupId, setGroupId] = useState("");
  const [printerGroupId, setPrinterGroupId] = useState("");
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [tgBusy, setTgBusy] = useState(false);
  const [testText, setTestText] = useState("");
  const [testBot, setTestBot] = useState<BotId>("app");
  const [testBusy, setTestBusy] = useState(false);
  const [cooldownHours, setCooldownHours] = useState("24");
  const [cdBusy, setCdBusy] = useState(false);
  const [backupMode, setBackupMode] = useState<
    "download" | "telegram" | "telegram-dm" | "webhook"
  >("download");
  const [backupChatId, setBackupChatId] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);

  // Sync once when the settings query resolves.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (tg !== undefined && !synced) {
      setSynced(true);
      setGroupId(tg.clubGroupChatId);
      setPrinterGroupId(tg.printerGroupChatId ?? "");
      setNotificationsOn(tg.notificationsOn);
    }
  }, [tg, synced]);
  useEffect(() => {
    if (cooldown !== undefined) setCooldownHours(String(cooldown));
  }, [cooldown]);
  useEffect(() => {
    if (backupDest !== undefined) {
      setBackupMode(backupDest.mode);
      setBackupChatId(backupDest.chatId ?? "");
    }
  }, [backupDest]);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bots, groups, notification routing and club rules.
          </p>
        </header>

        {/* ===== button-bar navigation ===== */}
        <nav className="glass flex flex-wrap gap-1.5 rounded-lg border p-2">
          {SECTIONS.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              title={hint}
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                section === id
                  ? "press-3d bg-primary text-primary-foreground"
                  : "icon-glass text-muted-foreground hover:text-foreground",
                id === "danger" && section !== id && "hover:text-destructive",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </nav>

        {/* ===== Bots & groups ===== */}
        {section === "telegram" && (
          <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="text-sm font-semibold">Telegram bots & groups</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Two separate bots, each posting into its own group. The <b>APP BOT</b> handles club
                notifications (rentals, requests, projects, members…); the <b>PRINTER BOT</b> owns
                the print-farm group where parts and print events are posted. Members add their
                @username on their profile to be taggable and DM-able.
              </p>
            </div>

            {tg === undefined ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingGifInline size={18} className="size-4" /> Loading…
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* APP BOT */}
                  <div className="grid gap-3 glass-3d rounded-lg border p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
                      <MessageSquare className="size-3.5" /> APP BOT
                    </p>
                    <div className="grid gap-1.5">
                      <Label htmlFor="tg-token" className="text-xs">
                        Bot token{" "}
                        {tg.hasToken && (
                          <span className="text-muted-foreground">(saved: {tg.botToken})</span>
                        )}
                      </Label>
                      <Input
                        id="tg-token"
                        type="password"
                        value={appToken}
                        onChange={(e) => setAppToken(e.target.value)}
                        placeholder={
                          tg.hasToken
                            ? "Leave empty to keep the saved token"
                            : "123456:ABC-DEF… from @BotFather"
                        }
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="tg-group" className="text-xs">
                        APP group chat id
                      </Label>
                      <Input
                        id="tg-group"
                        value={groupId}
                        onChange={(e) => setGroupId(e.target.value)}
                        placeholder="e.g. -1001234567890 (topics enabled)"
                      />
                    </div>
                  </div>

                  {/* PRINTER BOT */}
                  <div className="grid gap-3 glass-3d rounded-lg border p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
                      <Printer className="size-3.5" /> PRINTER BOT
                    </p>
                    <div className="grid gap-1.5">
                      <Label htmlFor="tg-printer-token" className="text-xs">
                        Bot token{" "}
                        {tg.hasPrinterToken && (
                          <span className="text-muted-foreground">
                            (saved: {tg.printerBotToken})
                          </span>
                        )}
                      </Label>
                      <Input
                        id="tg-printer-token"
                        type="password"
                        value={printerToken}
                        onChange={(e) => setPrinterToken(e.target.value)}
                        placeholder={
                          tg.hasPrinterToken
                            ? "Leave empty to keep the saved token"
                            : "Second bot token from @BotFather"
                        }
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="tg-printer-group" className="text-xs">
                        PRINTER group chat id
                      </Label>
                      <Input
                        id="tg-printer-group"
                        value={printerGroupId}
                        onChange={(e) => setPrinterGroupId(e.target.value)}
                        placeholder="e.g. -1009876543210 — print-farm group"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        G-code parts are relayed here as the archive copy — they are never stored in
                        the app's database.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between glass-3d rounded-md border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">Notifications</p>
                    <p className="text-xs text-muted-foreground">
                      Send Telegram messages for every event
                    </p>
                  </div>
                  <Switch checked={notificationsOn} onCheckedChange={setNotificationsOn} />
                </div>

                <Button
                  className="self-start"
                  disabled={tgBusy}
                  onClick={async () => {
                    setTgBusy(true);
                    try {
                      await saveTg({
                        botToken: appToken.trim() || undefined,
                        printerBotToken: printerToken.trim() || undefined,
                        clubGroupChatId: groupId,
                        printerGroupChatId: printerGroupId,
                        notificationsOn,
                      });
                      setAppToken("");
                      setPrinterToken("");
                      toast.success("Bots & groups saved");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    } finally {
                      setTgBusy(false);
                    }
                  }}
                >
                  <Save className="size-4" /> Save bots & groups
                </Button>

                <div className="flex flex-col gap-2 glass-3d rounded-md border border-dashed p-3">
                  <Label className="text-xs text-muted-foreground">Test the integration</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(["app", "printer"] as BotId[]).map((b) => (
                      <Button
                        key={b}
                        size="sm"
                        variant={testBot === b ? "default" : "outline"}
                        onClick={() => setTestBot(b)}
                      >
                        {b === "app" ? "APP BOT" : "PRINTER BOT"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      placeholder="Optional custom test text"
                    />
                    <Button
                      variant="outline"
                      disabled={testBusy}
                      onClick={async () => {
                        setTestBusy(true);
                        try {
                          const res = await testSend({ text: testText, bot: testBot });
                          if (res?.sent)
                            toast.success(
                              `Sent from ${testBot === "app" ? "APP" : "PRINTER"} BOT ✅`,
                            );
                          else toast.error(`Not sent: ${res?.reason ?? "unknown"}`);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setTestBusy(false);
                        }
                      }}
                    >
                      <SendHorizonal className="size-4" /> Send test
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* ===== APP topics ===== */}
        {section === "topics-app" && (
          <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Hash className="size-4" /> APP group topics
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Manage the topics of the APP group and decide which notification category is pushed
                into which topic. Example: create a topic named “now”, then assign “Requests &
                approvals” to it — every new request lands in that topic.
              </p>
            </div>
            <TopicsPanel bot="app" />
          </section>
        )}

        {/* ===== PRINTER topics ===== */}
        {section === "topics-printer" && (
          <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Printer className="size-4" /> PRINTER group topics
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Same topic routing for the print-farm group — printing events, job status and part
                archives.
              </p>
            </div>
            <TopicsPanel bot="printer" />
          </section>
        )}

        {/* ===== Data backup ===== */}
        {section === "backup" && <DataBackupSection />}

        {/* ===== Per-user sounds ===== */}
        {section === "sounds" && <MySoundsSection />}
        {section === "appearance" && <AppearanceSection />}

        {/* ===== Return-request cooldown ===== */}
        {section === "returns" && (
          <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="text-sm font-semibold">Return requests</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Members can ask to return a rented part — one request per rental per period. The
                admin still confirms every return.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cooldown">Cooldown period (hours)</Label>
              <div className="flex gap-2">
                <Input
                  id="cooldown"
                  type="number"
                  min={0}
                  max={720}
                  value={cooldownHours}
                  onChange={(e) => setCooldownHours(e.target.value)}
                  className="max-w-32"
                />
                <Button
                  variant="outline"
                  disabled={cdBusy}
                  onClick={async () => {
                    setCdBusy(true);
                    try {
                      const h = Number(cooldownHours);
                      await saveCooldown({ hours: h });
                      toast.success(`Cooldown set to ${h} hours`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    } finally {
                      setCdBusy(false);
                    }
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                After a member sends a return request, they must wait this long before asking again
                for the same rental. 0 = unlimited requests.
              </p>
            </div>
          </section>
        )}

        {/* ===== Inventory structure ===== */}
        {section === "structure" && <InventoryStructureSection />}

        {/* ===== Club lists ===== */}
        {section === "lists" && (
          <section className="flex flex-col gap-5 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="text-sm font-semibold">Club lists</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The positions and academic states offered across the app — add or remove any entry;
                changes apply everywhere instantly.
              </p>
            </div>
            <ListEditor
              title="Positions (ranks)"
              hint="Shown when editing people and when members request an upgrade."
              listKey="clubRoles"
              values={roles}
            />
            <ListEditor
              title="Academic states"
              hint="Shown on member profiles and in the People editor."
              listKey="academicStates"
              values={states}
            />
          </section>
        )}

        {/* ===== chat backup destinations ===== */}
        {section === "card-layout" && <CardLayoutSection />}

        {section === "permissions" && (
          <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
            <div>
              <h2 className="text-sm font-semibold">Device permissions (this device)</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Permissions are per-device and per-member: each person grants them on their own
                device from their Profile page. This panel manages the device you're using now.
                The same requests map to Android/iOS prompts when the app is wrapped as a mobile
                app.
              </p>
            </div>
            <PermissionsManager />
          </section>
        )}

        {section === "chat-backup" && (
          <section className="glass-3d rounded-lg border">
            <div className="border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Chat backup destinations</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Conversation archives are built in the browser as .zip files and are never stored in
                the app database. Choose where archives should also be delivered when an admin
                exports them from the Chat page.
              </p>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["download", "Browser download only"],
                    ["telegram", "Telegram group"],
                    ["telegram-dm", "Telegram DM (self)"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={backupMode === value ? "default" : "outline"}
                    onClick={() => setBackupMode(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {backupMode === "telegram" && (
                <div>
                  <Label htmlFor="backup-chat-id">Destination chat id</Label>
                  <Input
                    id="backup-chat-id"
                    value={backupChatId}
                    onChange={(e) => setBackupChatId(e.target.value)}
                    placeholder="e.g. -1001234567890 (empty = club group)"
                    className="mt-1 max-w-sm"
                  />
                </div>
              )}
              <Button
                size="sm"
                disabled={backupBusy}
                onClick={async () => {
                  setBackupBusy(true);
                  try {
                    await saveBackupDest({
                      mode: backupMode,
                      chatId: backupChatId || undefined,
                    });
                    toast.success("Chat backup destination saved");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not save");
                  } finally {
                    setBackupBusy(false);
                  }
                }}
              >
                Save destination
              </Button>
            </div>
          </section>
        )}

        {/* ===== danger zone ===== */}
        {section === "danger" && <ResetDatabaseCard />}
      </div>
    </AppShell>
  );
}
