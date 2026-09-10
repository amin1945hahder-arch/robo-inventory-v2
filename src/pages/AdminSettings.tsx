import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Save, SendHorizonal } from "lucide-react";

/**
 * Admin settings: the Telegram integration (bot token, club group chat id,
 * notifications on/off + test send) and the return-request cooldown period.
 */
export default function AdminSettings() {
  const tg = useQuery(api.settings.getTelegram, {});
  const cooldown = useQuery(api.settings.getReturnCooldown, {});

  const saveTg = useMutation(api.settings.setTelegram);
  const saveCooldown = useMutation(api.settings.setReturnCooldown);
  const testSend = useAction(api.settings.sendTestMessage);

  const [token, setToken] = useState("");
  const [groupId, setGroupId] = useState("");
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [tgBusy, setTgBusy] = useState(false);
  const [testText, setTestText] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [cooldownHours, setCooldownHours] = useState("24");
  const [cdBusy, setCdBusy] = useState(false);

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
      </div>
    </AppShell>
  );
}
