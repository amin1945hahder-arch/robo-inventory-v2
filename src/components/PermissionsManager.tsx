/**
 * PermissionsManager — the professional device-permissions panel.
 *
 * Used in Settings (and mountable anywhere). Shows the four capabilities the
 * app uses — notifications, camera, persistent storage, sound — with a live
 * status chip and Allow / Re-ask action for each. Copy adapts to the runtime
 * platform (browser, installed PWA, APK/desktop wrapper) and explains exactly
 * how to recover when something was denied.
 */
import { AlertTriangle, Bell, BellRing, Camera, Check, Database, RotateCw, ShieldCheck, Volume2, X } from "lucide-react";
import { usePermissions, type PermissionKind, type PermissionStatus } from "@/hooks/use-permissions";
import { usePushSubscription } from "@/hooks/use-push";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/AppIcon";

type Row = {
  kind: PermissionKind;
  icon: typeof Bell;
  title: string;
  why: string;
  /** Where to recover on each platform when denied. */
  recover: Record<Platform, string>;
};

type Platform = "web" | "apk" | "ios" | "desktop";

const ROWS: Row[] = [
  {
    kind: "notifications",
    icon: Bell,
    title: "Notifications",
    why: "Get notified when a request is approved, a return is due, or the printers need attention — even with the app in the background.",
    recover: {
      web: "Click the lock/site icon in your browser's address bar → Notifications → Allow.",
      apk: "Android Settings → Apps → RoboShelf → Notifications → Allow.",
      ios: "iOS Settings → RoboShelf → Notifications → Allow.",
      desktop: "Click the bell/padlock icon in the title bar → Allow notifications.",
    },
  },
  {
    kind: "camera",
    icon: Camera,
    title: "Camera",
    why: "Scan the QR labels on parts, storages and projects for instant renting, returning and browsing.",
    recover: {
      web: "Click the lock/site icon in your address bar → Camera → Allow, then reload.",
      apk: "Android Settings → Apps → RoboShelf → Permissions → Camera → Allow.",
      ios: "iOS Settings → RoboShelf → Camera → Allow.",
      desktop: "Click the camera icon in the address bar → Allow, then reload.",
    },
  },
  {
    kind: "storage",
    icon: Database,
    title: "Persistent storage",
    why: "Keeps your offline cache, downloads and app data safe from automatic cleanup when device space runs low.",
    recover: {
      web: "If the grant doesn't stick, install the app (Add to Home Screen) and allow it there — browsers persist data for installed apps.",
      apk: "Handled by the webview automatically once granted.",
      ios: "Managed by iOS — the app requests it on first launch.",
      desktop: "Granted automatically by the desktop runtime.",
    },
  },
  {
    kind: "sound",
    icon: Volume2,
    title: "Sounds",
    why: "Scan beeps and notification tones. Your device just needs one interaction with the app to unlock audio.",
    recover: {
      web: "Press “Allow” — one tap unlocks audio for the whole app.",
      apk: "Check the device's media volume, then press “Allow”.",
      ios: "Flip the silent switch off / raise the volume, then press “Allow”.",
      desktop: "Check the system mixer isn't muting the app, then press “Allow”.",
    },
  },
];

function statusChip(status: PermissionStatus) {
  switch (status) {
    case "granted":
      return {
        cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        label: "Allowed",
        Icon: Check,
      };
    case "denied":
      return {
        cls: "border-amber-500/40 bg-amber-500/10 text-amber-500",
        label: "Blocked",
        Icon: AlertTriangle,
      };
    case "prompt":
      return {
        cls: "border-sky-500/40 bg-sky-500/10 text-sky-400",
        label: "Not set",
        Icon: X,
      };
    default:
      return {
        cls: "border-border bg-muted/60 text-muted-foreground",
        label: "N/A on this device",
        Icon: X,
      };
  }
}

/** Detect the wrapper we're running in (best effort, for the guidance text). */
export function detectPlatform(): Platform {
  if (typeof window === "undefined") return "web";
  const ua = navigator.userAgent || "";
  if ((window as unknown as { Capacitor?: unknown }).Capacitor) return "apk";
  if (/electron/i.test(ua)) return "desktop";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/\bwv\b|; wv\)/i.test(ua)) return "apk";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone && /android/i.test(ua)) return "apk";
  if (standalone) return "desktop";
  return "web";
}

export function PermissionsManager() {
  const perms = usePermissions();
  const platform = detectPlatform();

  return (
    <div className="flex flex-col gap-3">
      {ROWS.map(({ kind, icon, title, why, recover }) => {
        const perm = perms[kind];
        const chip = statusChip(perm.status);
        return (
          <div
            key={kind}
            className="glass-3d flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center"
          >
            <AppIcon fallback={icon} className="size-9" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{title}</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}
                >
                  <chip.Icon className="size-3" />
                  {chip.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{why}</p>
              {perm.status === "denied" && (
                <p className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-4 text-amber-500">
                  {recover[platform]}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:self-center">
              {perm.busy ? (
                <LoadingGifInline size={18} className="size-4" />
              ) : perm.status === "granted" ? (
                <Button variant="outline" size="sm" onClick={() => void perm.refresh()}>
                  <RotateCw className="size-3.5" />
                  Re-check
                </Button>
              ) : perm.status === "denied" || perm.status === "prompt" ? (
                <Button size="sm" onClick={() => void perm.request()}>
                  <ShieldCheck className="size-3.5" />
                  Allow
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>
        );
      })}
      <PushCard platform={platform} />
    </div>
  );
}

/**
 * Real server pushes (VAPID web-push). OS-level notifications delivered even
 * when the app is closed — one subscription per device, standard Push API, so
 * it works on browsers/PWA, Android webviews and iOS 16.4+ home-screen apps.
 */
function PushCard({ platform }: { platform: Platform }) {
  const push = usePushSubscription();
  if (!push.supported) return null; // platform has no Push API — in-app only
  if (push.state === "unconfigured") {
    return (
      <div className="glass-3d flex flex-col gap-1 rounded-lg border border-dashed p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <BellRing className="size-4 text-primary" /> Real push notifications
        </p>
        <p className="text-xs text-muted-foreground">
          Supported on this device — waiting for the server's push keys
          (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Settings → API keys).
        </p>
      </div>
    );
  }
  return (
    <div className="glass-3d flex flex-col gap-3 rounded-lg border border-primary/30 p-4 sm:flex-row sm:items-center">
      <AppIcon fallback={BellRing} className="size-9" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Real push notifications</p>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              push.state === "on"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-sky-500/40 bg-sky-500/10 text-sky-400"
            }`}
          >
            {push.state === "on" ? <Check className="size-3" /> : <BellRing className="size-3" />}
            {push.state === "on" ? "Active on this device" : "Off"}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {push.state === "on"
            ? "This device receives OS-level pushes even when the app is closed."
            : platform === "ios"
              ? "On iPhone/iPad the app must be installed to the Home Screen first, then enable push here."
              : "Enable once — this device then receives pushes even with the app fully closed."}
        </p>
        {push.error && (
          <p className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-4 text-amber-500">
            {push.error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:self-center">
        {push.state === "working" ? (
          <LoadingGifInline size={18} className="size-4" />
        ) : push.state === "on" ? (
          <Button variant="outline" size="sm" onClick={() => void push.disable()}>
            Turn off
          </Button>
        ) : (
          <Button size="sm" onClick={() => void push.enable()}>
            <BellRing className="size-3.5" /> Enable push
          </Button>
        )}
      </div>
    </div>
  );
}
