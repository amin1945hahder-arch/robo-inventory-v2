import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BadgeCheck, Bot, ExternalLink, Loader2, Send, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Telegram onboarding popup. Shown when a backup (or notification) needs the
 * member's Telegram and it isn't linked yet:
 *  1. save the @username on the profile
 *  2. send ANY message to the club bot → the bot auto-links the chat id
 *     (alternatively paste the number @chatid_echo_bot reports)
 */
export function TelegramLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const me = useQuery(api.users.currentUser, {});
  const fetchBotUsername = useAction(api.telegram.getBotUsername);
  const saveUsername = useMutation(api.users.setMyTelegramUsername);
  const saveChatId = useMutation(api.users.setMyTelegramChatId);

  const [username, setUsername] = useState("");
  const [usernameSaved, setUsernameSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername(me?.telegramUsername ?? "");
      setUsernameSaved(me?.telegramUsername ?? null);
      setManual("");
      setManualOpen(false);
    }
  }, [open, me?.telegramUsername]);

  // The club bot's public @username (from getMe) so step 2 can deep-link it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchBotUsername({})
      .then((u) => {
        if (!cancelled) setBotUsername(u ?? null);
      })
      .catch(() => {
        /* token not configured — step 2 shows the generic wording */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const linked = Boolean(me?.telegramChatId);
  const clubBot = botUsername ?? null;

  const save = async () => {
    setBusy(true);
    try {
      await saveUsername({ username });
      const clean = username.trim().replace(/^@/, "");
      setUsernameSaved(clean || null);
      toast.success("Telegram username saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    setBusy(true);
    try {
      await saveChatId({ chatId: manual });
      toast.success("Chat id linked — Telegram DMs are now active");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5 text-primary" /> Link your Telegram
          </DialogTitle>
          <DialogDescription>
            Backups and rental updates are delivered to Telegram. Connect your account once — it
            takes a minute.
          </DialogDescription>
        </DialogHeader>

        {linked ? (
          <div className="flex flex-col items-center gap-3 glass-3d rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <BadgeCheck className="size-8 text-emerald-400" />
            <p className="text-sm font-semibold">Telegram is linked</p>
            <p className="text-xs text-muted-foreground">
              Chat id <span className="font-mono">{me?.telegramChatId}</span> — your backups and
              notifications will arrive in your Telegram DMs.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Step 1 — @username */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    usernameSaved ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"
                  }`}
                >
                  {usernameSaved ? "✓" : "1"}
                </span>
                <Label className="text-sm font-medium">Set your Telegram @username</Label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. amin20haydar"
                />
                <Button
                  variant="outline"
                  disabled={busy || username.trim().replace(/^@/, "") === (usernameSaved ?? "")}
                  onClick={save}
                >
                  {busy ? <LoadingGifInline size={18} className="size-4" /> : "Save"}
                </Button>
              </div>
            </div>

            {/* Step 2 — message the club bot (auto-link) */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  2
                </span>
                <Label className="text-sm font-medium">
                  Message the club bot once to activate DMs
                </Label>
              </div>
              <ol className="ml-7 list-decimal space-y-1 text-xs text-muted-foreground">
                <li>
                  Open{" "}
                  <a
                    className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
                    href="https://t.me/chatid_echo_bot"
                    target="_blank"
                    rel="noreferrer"
                  >
                    @chatid_echo_bot <ExternalLink className="size-3" />
                  </a>{" "}
                  in Telegram and send it any message (e.g. <span className="font-mono">hi</span>).
                  It replies with your chat id number.
                </li>
                <li>
                  Then send that same message (anything works) to the club bot{" "}
                  {clubBot ? (
                    <a
                      className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
                      href={`https://t.me/${clubBot}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{clubBot} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="font-medium">(the club bot — ask an admin if unsure)</span>
                  )}
                  . The bot matches your @username and links your chat automatically.
                </li>
              </ol>
              {usernameSaved && (
                <p className="ml-7 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <UserRoundCheck className="size-3 text-emerald-400" />
                  Watching for a message from <span className="font-mono">@{usernameSaved}</span>{" "}
                  … it links within a minute.
                </p>
              )}
              {!usernameSaved && (
                <p className="ml-7 text-[11px] text-amber-400/80">
                  Save your @username above first — the bot uses it to find you.
                </p>
              )}
            </div>

            {/* Manual fallback */}
            <div className="border-t pt-3">
              {manualOpen ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Or paste the chat id number directly
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      placeholder="e.g. 123456789"
                      inputMode="numeric"
                    />
                    <Button disabled={busy || manual.trim().length < 4} onClick={submitManual}>
                      {busy ? <LoadingGifInline size={18} className="size-4" /> : <Send className="size-4" />}
                      Link
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setManualOpen(true)}>
                  I already know my chat id — paste it instead
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {linked ? "Done" : "Later"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
