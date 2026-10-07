import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Bell, Camera, Database, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Fired after notifications/storage are answered so AppShell's fallback
 *  strips re-read their flags and disappear immediately. */
export const PERMISSIONS_ANSWERED_EVENT = "rc:permissions-answered";

const CAMERA_KEY = "rc.permissions.camera";
const NOTIF_KEY = "rc.notifAsked";
const STORAGE_KEY = "rc.storageAsked";

type Kind = "camera" | "notifications" | "storage";
type Phase = "asking" | "granted" | "denied" | "skipped";

const ROWS: { kind: Kind; icon: typeof Camera; title: string; blurb: string }[] = [
  {
    kind: "camera",
    icon: Camera,
    title: "Camera",
    blurb: "Scan part, unit, storage and project QR labels.",
  },
  {
    kind: "notifications",
    icon: Bell,
    title: "Notifications",
    blurb: "Approvals, requests and activity — even with the app closed.",
  },
  {
    kind: "storage",
    icon: Database,
    title: "Offline storage",
    blurb: "Keeps the club database on this device, safe from automatic cleanup.",
  },
];

/** Has the user already answered this capability (on this device)? */
function answered(kind: Kind): boolean {
  try {
    if (kind === "camera") return window.localStorage.getItem(CAMERA_KEY) !== null;
    if (kind === "notifications") return window.localStorage.getItem(NOTIF_KEY) === "1";
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // private mode — still ask once (same as the old prompt)
  }
}

/** Can the runtime even show a prompt for this capability? Android WebViews
 *  commonly lack the Notification API (the APK shell prompts natively), and
 *  some frames hide getUserMedia — those rows are simply skipped. */
function available(kind: Kind): boolean {
  if (kind === "camera") return Boolean(navigator.mediaDevices?.getUserMedia);
  if (kind === "notifications") {
    return typeof Notification !== "undefined" && typeof Notification.requestPermission === "function";
  }
  return true;
}

function rememberCamera(status: "granted" | "dismissed") {
  try {
    window.localStorage.setItem(CAMERA_KEY, status);
  } catch {
    /* private mode */
  }
}

function rememberAnswered(kind: "notifications" | "storage") {
  try {
    window.localStorage.setItem(kind === "notifications" ? NOTIF_KEY : STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
}

/**
 * One-time startup permissions dialog: right after the app opens for the
 * first time it asks for everything the app needs — camera (QR scanning),
 * notifications, and persistent offline storage — in a single popup. Each
 * capability is remembered per device in localStorage, so the dialog never
 * nags twice; "Not now" answers everything too (re-ask lives in Settings →
 * Permissions). Rows the runtime can't prompt for are hidden.
 *
 * All requests fire from button clicks, which keeps browsers happy (they
 * require a user gesture) and iOS satisfied (synchronous entry point).
 */
export function PermissionsPrompt() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Kind[]>([]);
  const [phases, setPhases] = useState<Partial<Record<Kind, Phase>>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const kinds = ROWS.map((r) => r.kind).filter((k) => available(k) && !answered(k));
    if (kinds.length === 0) return; // everything answered already — never opens
    setPending(kinds);
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  const allResolved = pending.length > 0 && pending.every((k) => Boolean(phases[k]));
  const anyAsking = pending.some((k) => phases[k] === "asking");

  // Every row answered (individually or via "Allow all") → brief success,
  // then close on its own.
  useEffect(() => {
    if (!open || !allResolved) return;
    const t = window.setTimeout(() => setOpen(false), 900);
    return () => window.clearTimeout(t);
  }, [open, allResolved]);

  const ask = async (kind: Kind): Promise<void> => {
    setPhases((p) => ({ ...p, [kind]: "asking" }));

    if (kind === "camera") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        // Got permission — release the stream immediately; the scan dialog
        // opens its own stream when needed.
        stream.getTracks().forEach((t) => t.stop());
        rememberCamera("granted");
        setPhases((p) => ({ ...p, camera: "granted" }));
      } catch {
        rememberCamera("dismissed");
        setPhases((p) => ({ ...p, camera: "denied" }));
      }
      return;
    }

    if (kind === "notifications") {
      let res: NotificationPermission = "default";
      try {
        res = await Notification.requestPermission();
      } catch {
        res = "default";
      }
      // Any answer is remembered — the browser enforces its own quiet time
      // after a deny, and Settings can re-ask deliberately.
      rememberAnswered("notifications");
      setPhases((p) => ({
        ...p,
        notifications: res === "granted" ? "granted" : res === "denied" ? "denied" : "skipped",
      }));
      window.dispatchEvent(new Event(PERMISSIONS_ANSWERED_EVENT));
      return;
    }

    // Persistent storage: no OS dialog on the web — persist() grants silently
    // (or reports the WebView doesn't expose it, which we just accept).
    let ok = false;
    try {
      ok = typeof navigator.storage?.persist === "function" ? await navigator.storage.persist() : false;
    } catch {
      ok = false;
    }
    rememberAnswered("storage");
    setPhases((p) => ({ ...p, storage: ok ? "granted" : "skipped" }));
    window.dispatchEvent(new Event(PERMISSIONS_ANSWERED_EVENT));
  };

  const allowAll = async () => {
    // The notification prompt MUST start synchronously inside this click tick
    // (browsers and Android WebViews silently deny it after any await — see
    // the rationale in use-permissions.ts), so fire it FIRST, untouched by
    // the sequential camera/storage asks that follow.
    const rest: Kind[] = [];
    for (const k of pending) {
      if (phases[k]) continue;
      if (k === "notifications") void ask(k);
      else rest.push(k);
    }
    for (const k of rest) await ask(k);
    // The allResolved effect closes the dialog after the success beat.
  };

  /** "Not now" / close: answer everything so the app never nags again on
   *  this device — re-asking lives in Settings → Permissions. */
  const dismiss = () => {
    let notifyShell = false;
    for (const k of pending) {
      if (phases[k]) continue;
      if (k === "camera") rememberCamera("dismissed");
      else {
        rememberAnswered(k);
        notifyShell = true;
      }
    }
    if (notifyShell) window.dispatchEvent(new Event(PERMISSIONS_ANSWERED_EVENT));
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary neon-ring">
            <ShieldCheck className="size-6" />
          </div>
          <DialogTitle>Set up RC on this device</DialogTitle>
          <DialogDescription>
            Grant these once — scanning, notifications and your offline data all light up after that.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {pending.map((kind) => {
            const meta = ROWS.find((r) => r.kind === kind);
            if (!meta) return null;
            const Icon = meta.icon;
            const st = phases[kind];
            return (
              <div key={kind} className="glass-3d flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <div className="icon-glass flex size-9 items-center justify-center rounded-lg text-primary">
                  <Icon className="icon-3d size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{meta.title}</p>
                  <p className="text-xs leading-4 text-muted-foreground">{meta.blurb}</p>
                  {st === "granted" && (
                    <p className="mt-1 text-xs text-emerald-400">Allowed — you're all set.</p>
                  )}
                  {st === "denied" && (
                    <p className="mt-1 text-xs text-amber-500">
                      Blocked — you can allow it later from Settings → Permissions.
                    </p>
                  )}
                  {st === "skipped" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Not available in this environment — skipped.
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={st === "granted" || st === "denied" || st === "skipped" ? "outline" : "default"}
                  disabled={st === "asking" || st === "granted" || st === "skipped"}
                  onClick={() => void ask(kind)}
                >
                  {st === "asking" ? (
                    <LoadingGifInline size={16} className="size-4" />
                  ) : st === "granted" ? (
                    "Allowed"
                  ) : st === "denied" ? (
                    "Retry"
                  ) : (
                    "Allow"
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={dismiss} disabled={anyAsking}>
            Not now
          </Button>
          <Button onClick={() => void allowAll()} disabled={anyAsking || allResolved}>
            {allResolved ? "You're all set" : "Allow all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
