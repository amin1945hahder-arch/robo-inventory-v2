/**
 * Cross-platform device-permission manager (browser / PWA / APK webview /
 * Capacitor-style native shells / desktop wrappers).
 *
 * Goals:
 *  - One live, reactive status for each capability: notifications, camera,
 *    persistent storage, sound.
 *  - Requests use the RIGHT API per platform (web APIs today; native bridges
 *    later) so the same code keeps working when wrapped as .apk/desktop/iOS.
 *  - Every result is persisted per-user in localStorage so the app never
 *    nags twice, and the Settings UI can always re-ask or re-open settings.
 *
 * Platform notes:
 *  - Notifications: Notification.requestPermission (web) — in an APK the
 *    webview exposes the same API; AndroidManifest POST_NOTIFICATIONS is a
 *    shell-side concern that maps to the same runtime state.
 *  - Camera: getUserMedia (same in webviews). Not persisted as "denied" —
 *    the browser owns that state, so we re-read it each session.
 *  - Storage: navigator.storage.persist() — marks the app's data (offline
 *    cache, backups) as persistent instead of best-effort eviction.
 *  - Sound: no OS prompt on the web; an AudioContext resume gesture is the
 *    "unlock" (required by iOS/Safari and Android webviews). We surface it
 *    as a normal permission toggle for a consistent UI.
 */
import { useCallback, useEffect, useState } from "react";

export type PermissionKind = "notifications" | "camera" | "storage" | "sound";
export type PermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

const KEY_PREFIX = "roboShelf.permissions.";

function readLocal(kind: PermissionKind): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + kind);
  } catch {
    return null;
  }
}

function writeLocal(kind: PermissionKind, value: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + kind, value);
  } catch {
    /* private mode */
  }
}

function normalize(raw: string): PermissionStatus {
  switch (raw) {
    case "granted":
    case "denied":
    case "prompt":
      return raw;
    case "unsupported":
    default:
      return "unsupported";
  }
}

/** Is the app installed (PWA home-screen / wrapped webview shell)? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    // Common Android WebView / Capacitor-style shells expose these markers.
    (window as unknown as { RoboShelfNative?: unknown }).RoboShelfNative !== undefined ||
    /\b(roboshelf|capacitor)\b/i.test(navigator.userAgent)
  );
}

/** True inside an Android WebView wrapper (webview-to-APK apps set \"; wv\" in the UA). */
function isAndroidWebview(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent) && /\bwv\b|; wv\)/i.test(navigator.userAgent);
}

/**
 * Can the page actually STORE data here? Feature-detect the real engines
 * (localStorage + IndexedDB) instead of inferring from navigator.storage.
 * Webview wrappers frequently hide navigator.storage while DOM storage is
 * fully enabled — and that is what the app's offline data actually uses.
 */
async function storageWorks(): Promise<boolean> {
  try {
    const t = "__rs_probe__";
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    // IndexedDB open fails fast when the webview has storage disabled.
    if (typeof indexedDB !== "undefined") {
      await new Promise<void>((resolve, reject) => {
        try {
          const req = indexedDB.open(t, 1);
          req.onsuccess = () => {
            try {
              req.result?.close();
            } catch {
              /* ignore */
            }
            indexedDB.deleteDatabase(t);
            resolve();
          };
          req.onerror = () => reject(req.error ?? new Error("idb blocked"));
          req.onblocked = () => resolve();
          setTimeout(() => resolve(), 1500); // never hang the status
        } catch (e) {
          reject(e);
        }
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Current OS/browser-level state for one capability (no side effects). */
async function detect(kind: PermissionKind): Promise<PermissionStatus> {
  if (typeof window === "undefined") return "unsupported";
  try {
    switch (kind) {
      case "notifications": {
        if (typeof Notification === "undefined") return "unsupported";
        return normalize(Notification.permission);
      }
      case "camera": {
        const q = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (!q?.query || !navigator.mediaDevices?.getUserMedia) return "prompt";
        const st = await q.query({ name: "camera" });
        return normalize(st.state);
      }
      case "storage": {
        // First truth: can we actually store anything right now? A working
        // localStorage/IndexedDB means storage EXISTS and is usable — even
        // when navigator.storage is missing (typical webview wrappers).
        const works = await storageWorks();
        if (!works) return "unsupported";
        const s = (navigator as Navigator & { storage?: { persisted?: () => Promise<boolean> } }).storage;
        if (s?.persisted) {
          if (await s.persisted()) return "granted";
          // Chromium exposes the real site permission ("persistent-storage"):
          // a hard "denied" there means the user must lift the block in site
          // settings — persist() alone would just keep returning false.
          try {
            const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
            const st = await perms?.query({ name: "persistent-storage" as PermissionName });
            if (st?.state === "granted") return "granted";
            if (st?.state === "denied") return "denied";
          } catch {
            /* Safari/Firefox/webviews: no such permission name — stay "prompt" */
          }
          // Wrappers that omit the permission API (freewebtoapk and similar
          // webview-to-APK builders): storage works and nothing can report a
          // denial — treat it as already granted instead of nagging forever.
          if (isAndroidWebview()) return "granted";
          return "prompt";
        }
        // No navigator.storage at all: storage WORKS (proven above), it just
        // can't be pinned as persistent. In webview shells DOM storage is
        // app-managed — report the working truth, never "unsupported".
        return isAndroidWebview() ? "granted" : "prompt";
      }
      case "sound": {
        // The Web Audio context is created lazily by use-sound; here we only
        // report whether it has been unlocked this session (autoplay policy).
        const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return "unsupported";
        // A suspended context means the user still needs one tap to unlock.
        const probe = new AC();
        const ok = probe.state === "running";
        void probe.close?.();
        return ok ? "granted" : "prompt";
      }
      default:
        return "unsupported";
    }
  } catch {
    // NotAllowedError → denied; anything else → treat as prompt.
    return "prompt";
  }
}

export function usePermission(kind: PermissionKind) {
  const [status, setStatus] = useState<PermissionStatus>("prompt");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const saved = readLocal(kind);
    const live = await detect(kind);
    // Camera: the BROWSER's decision always wins (it can be revoked).
    if (kind === "camera") {
      setStatus(live);
      return live;
    }
    // For the rest, a saved dismissal only matters when live is still "prompt".
    setStatus(live === "prompt" && saved === "denied" ? "denied" : live);
    return live;
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = useCallback(async (): Promise<PermissionStatus> => {
    setBusy(true);
    try {
      let next: PermissionStatus;
      switch (kind) {
        case "notifications": {
          // Safari/iOS only expose Notification.requestPermission() after a
          // user gesture — this callback runs from a click, so the prompt
          // must be called synchronously. Awaiting anything before it makes
          // Safari silently resolve "denied" and Android WebViews never
          // show the dialog. So: fire the native prompt FIRST (sync), then
          // normalize whatever came back.
          if (typeof Notification === "undefined") {
            next = "unsupported";
            break;
          }
          try {
            const p = Notification.requestPermission();
            next = normalize(
              typeof p === "string" ? p : await p,
            );
          } catch {
            next = "denied";
          }
          break;
        }
        case "camera": {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
              audio: false,
            });
            stream.getTracks().forEach((t) => t.stop());
            next = "granted";
          } catch {
            next = "denied";
          }
          break;
        }
        case "storage": {
          // Truthful probing first: if data can actually be stored (webview
          // wrappers with DOM storage enabled, hidden navigator.storage),
          // storage is already working — never claim "unsupported" there.
          if (!(await storageWorks())) {
            next = "unsupported";
            break;
          }
          const s = (
            navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } }
          ).storage;
          if (!s?.persist) {
            // No StorageManager: nothing further to ask for — storage is
            // usable as-is (typical freewebtoapk / webview shells).
            next = isAndroidWebview() ? "granted" : "prompt";
            break;
          }
          // persist() is silent in every browser (no OS dialog exists for it);
          // the app's own one-tap strip is the visible "ask". True = granted;
          // false = the browser declined (or no engagement yet) — re-check the
          // site permission before reporting a hard denial.
          let persisted = false;
          try {
            persisted = await s.persist();
          } catch {
            persisted = false;
          }
          if (persisted) {
            next = "granted";
            break;
          }
          try {
            const st = await navigator.permissions?.query({
              name: "persistent-storage" as PermissionName,
            });
            if (st?.state === "granted") {
              next = "granted";
            } else if (isAndroidWebview() && st?.state !== "denied") {
              // Webview wrappers: the engine declines the pin but nothing is
              // actually blocked — data keeps working, so report granted.
              next = "granted";
            } else {
              next = "denied";
            }
          } catch {
            // No permissions API (Safari/Firefox/webviews): storage still
            // works — the pin just isn't grantable here.
            next = isAndroidWebview() ? "granted" : "denied";
          }
          break;
        }
        case "sound": {
          // Any user gesture that plays/resumes audio unlocks the context.
          const AC =
            (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AC) {
            next = "unsupported";
            break;
          }
          const ctx = new AC();
          await ctx.resume().catch(() => undefined);
          // Silent tick to satisfy gesture requirements everywhere.
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0.0001;
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.05);
          next = ctx.state === "running" ? "granted" : "denied";
          setTimeout(() => void ctx.close?.(), 200);
          break;
        }
        default:
          next = "unsupported";
      }
      writeLocal(kind, next === "denied" ? "denied" : next);
      await refresh();
      return next;
    } finally {
      setBusy(false);
    }
  }, [kind, refresh]);

  return { status, request, refresh, busy };
}

/** All four at once (Settings page). */
export function usePermissions() {
  const notifications = usePermission("notifications");
  const camera = usePermission("camera");
  const storage = usePermission("storage");
  const sound = usePermission("sound");
  return { notifications, camera, storage, sound };
}
