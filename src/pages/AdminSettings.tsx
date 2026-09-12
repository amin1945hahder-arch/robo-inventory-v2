import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, Save, SendHorizonal, Trash2, Volume2 } from "lucide-react";

/** A single admin-editable list (positions or academic states). */
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
        {values === undefined && <Loader2 className="size-4 animate-spin" />}
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

/**
 * Admin settings: the Telegram integration (bot token, club group chat id,
 * notifications on/off + test send), the return-request cooldown period,
 * the admin-editable club lists, and notification sounds.
 */
export default function AdminSettings() {
  const tg = useQuery(api.settings.getTelegram, {});
  const cooldown = useQuery(api.settings.getReturnCooldown, {});
  const roles = useQuery(api.clubLists.getList, { key: "clubRoles" });
  const states = useQuery(api.clubLists.getList, { key: "academicStates" });
  const soundCfg = useQuery(api.settings.getSounds, {});
  const backupDest = useQuery(api.settings.getChatBackupDestination, {});

  const saveTg = useMutation(api.settings.setTelegram);
  const saveCooldown = useMutation(api.settings.setReturnCooldown);
  const saveSounds = useMutation(api.settings.setSounds);
  const saveBackupDest = useMutation(api.settings.setChatBackupDestination);
  const testSend = useAction(api.settings.sendTestMessage);

  const [token, setToken] = useState("");
  const [groupId, setGroupId] = useState("");
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [tgBusy, setTgBusy] = useState(false);
  const [testText, setTestText] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [cooldownHours, setCooldownHours] = useState("24");
  const [cdBusy, setCdBusy] = useState(false);
  const [soundsOn, setSoundsOn] = useState(true);
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
      setNotificationsOn(tg.notificationsOn);
    }
  }, [tg, synced]);
  useEffect(() => {
    if (cooldown !== undefined) setCooldownHours(String(cooldown));
  }, [cooldown]);
  useEffect(() => {
    if (soundCfg !== undefined) setSoundsOn(soundCfg.enabled);
  }, [soundCfg]);
  useEffect(() => {
    if (backupDest !== undefined) {
      setBackupMode(backupDest.mode);
      setBackupChatId(backupDest.chatId ?? "");
    }
  }, [backupDest]);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Telegram notifications and rental-process rules for the whole club.
          </p>
        </header>

        {/* ===== Telegram integration ===== */}
        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div>
            <h2 className="text-sm font-semibold">Telegram integration</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The bot posts every rental event (request, approval, denial, return, project
              assignment, rank decisions) into your club group and tags the people concerned. Members
              add their @username on their profile to be taggable and DM-able.
            </p>
          </div>

          {tg === undefined ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="tg-token">
                  Bot token{" "}
                  {tg.hasToken && (
                    <span className="text-xs text-muted-foreground">(saved: {tg.botToken})</span>
                  )}
                </Label>
                <Input
                  id="tg-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    tg.hasToken
                      ? "Leave empty to keep the saved token"
                      : "123456:ABC-DEF…  from @BotFather"
                  }
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tg-group">Club group chat id</Label>
                <Input
                  id="tg-group"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  placeholder="e.g. -1001234567890 (add the bot to the group, then read getUpdates)"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    Send Telegram messages for every rental event
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
                      botToken: token.trim() || undefined,
                      clubGroupChatId: groupId,
                      notificationsOn,
                    });
                    setToken("");
                    toast.success("Telegram settings saved");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  } finally {
                    setTgBusy(false);
                  }
                }}
              >
                <Save className="size-4" /> Save Telegram settings
              </Button>

              <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                <Label htmlFor="tg-test" className="text-xs text-muted-foreground">
                  Test the integration
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="tg-test"
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
                        const res = await testSend({ text: testText });
                        if (res?.sent) toast.success("Sent to the club group ✅");
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

        {/* ===== Return-request cooldown ===== */}
        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div>
            <h2 className="text-sm font-semibold">Return requests</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Members can ask to return a rented part — one request per rental per period. The admin
              still confirms every return.
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
              After a member sends a return request, they must wait this long before asking again for
              the same rental. 0 = unlimited requests.
            </p>
          </div>
        </section>

        {/* ===== Club lists (fully admin-editable) ===== */}
        <section className="flex flex-col gap-5 rounded-lg border p-5">
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

        {/* ===== Notification sounds ===== */}
        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Volume2 className="size-4" /> Notification sounds
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                A short tone plays for scans, requests, decisions, and updates. This toggles it
                app-wide.
              </p>
            </div>
            <Switch
              checked={soundsOn}
              onCheckedChange={async (v) => {
                setSoundsOn(v);
                if (soundCfg) {
                  try {
                    await saveSounds({ enabled: v, sounds: soundCfg.sounds });
                    toast.success(v ? "Sounds enabled" : "Sounds muted app-wide");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                    setSoundsOn(!v);
                  }
                }
              }}
            />
          </div>
          {soundCfg && (
            <div className="grid gap-2">
              {Object.entries(soundCfg.sounds).map(([key, spec]) => (
                <div key={key} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <span className="w-40 text-xs font-medium">{key.replace(/_/g, " ")}</span>
                  <span className="w-14 text-xs text-muted-foreground">{spec.freq} Hz</span>
                  <input
                    type="range"
                    min={150}
                    max={1400}
                    step={10}
                    value={spec.freq}
                    onChange={async (e) => {
                      const next = {
                        ...soundCfg.sounds,
                        [key]: { ...spec, freq: Number(e.target.value) },
                      };
                      // Preview the NEW tone immediately, before it is saved.
                      try {
                        const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
                        const Ctor = window.AudioContext ?? w.webkitAudioContext;
                        if (Ctor) {
                          const ctx = new Ctor();
                          const osc = ctx.createOscillator();
                          const gain = ctx.createGain();
                          osc.type = "sine";
                          osc.frequency.value = Number(e.target.value);
                          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
                          gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
                          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + spec.dur);
                          osc.connect(gain).connect(ctx.destination);
                          osc.start();
                          osc.stop(ctx.currentTime + spec.dur + 0.02);
                          osc.onended = () => void ctx.close();
                        }
                      } catch {
                        /* autoplay policy before first interaction */
                      }
                      try {
                        await saveSounds({ enabled: soundCfg.enabled, sounds: next });
                      } catch {
                        /* non-admins just can't save; UI still previews locally */
                      }
                    }}
                    className="flex-1 accent-[var(--primary)]"
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ===== chat backup destinations (admin-only controller) ===== */}
        <section className="rounded-lg border">
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-semibold">Chat backup destinations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Conversation archives are built in the browser as .zip files and are never
              stored in the app database. Choose where archives should also be delivered
              when an admin exports them from the Chat page.
            </p>
          </div>
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap gap-2">
              {([
                ["download", "Browser download only"],
                ["telegram", "Telegram group"],
                ["telegram-dm", "Telegram DM (self)"],
              ] as const).map(([value, label]) => (
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
      </div>
    </AppShell>
  );
}
