import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Web-push subscription client.
 *
 * Handles the whole per-device flow: ask the browser for notification +
 * push permission, subscribe to push with the server's VAPID public key,
 * register the subscription on the backend, and re-register whenever the
 * browser rotates the subscription or the service worker updates.
 *
 * Works on every platform that implements the standard Push API:
 *  - Desktop browsers + installed PWAs (Windows/macOS/Linux)
 *  - Android Chrome + the wrapped APK webview
 *  - iOS 16.4+ / iPadOS Safari when the app is added to the Home Screen
 *
 * Where Push API is unavailable, `supported` is false and the permissions
 * panel simply hides the push row (in-app + Telegram notifications remain).
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushState = "unsupported" | "unconfigured" | "off" | "on" | "working";

export function usePushSubscription() {
  const save = useMutation(api.push.savePushSubscription);
  const remove = useMutation(api.push.removePushSubscription);
  const vapid = useQuery(api.push.pushVapidPublicKey, {});

  const [state, setState] = useState<PushState>("working");
  const [error, setError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";

  // Read the current state once the VAPID key is known.
  useEffect(() => {
    if (!supported) {
      setState("unsupported");
      return;
    }
    if (vapid === undefined) return; // still loading
    if (!vapid?.key) {
      setState("unconfigured");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const workerReg = reg ?? (await navigator.serviceWorker.ready);
        regRef.current = workerReg;
        const existing = await workerReg.pushManager.getSubscription();
        if (cancelled) return;
        setEndpoint(existing?.endpoint ?? null);
        setSubscribed(Boolean(existing));
        setState(existing ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, vapid]);

  /** Subscribe this device and register it on the server. */
  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported || !vapid?.key) return false;
    setState("working");
    setError(null);
    try {
      // Permission first — Safari requires it to be granted by a gesture
      // before pushManager.subscribe will resolve.
      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        setState("off");
        setError("Notification permission was not granted");
        return false;
      }
      const reg = regRef.current ?? (await navigator.serviceWorker.ready);
      regRef.current = reg;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid.key) as BufferSource,
        });
      }
      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      if (!json.keys?.p256dh || !json.keys?.auth) throw new Error("Incomplete push subscription");
      await save({
        endpoint: sub.endpoint,
        keysP256dh: json.keys.p256dh,
        keysAuth: json.keys.auth,
        userAgent: navigator.userAgent.slice(0, 250),
        platform: (navigator as any)?.userAgentData?.platform ?? navigator.platform ?? undefined,
      });
      setEndpoint(sub.endpoint);
      setSubscribed(true);
      setState("on");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Subscribe failed");
      setState("off");
      return false;
    }
  }, [supported, vapid, save]);

  /** Unsubscribe this device and drop it from the server. */
  const disable = useCallback(async () => {
    setState("working");
    try {
      if (endpoint) await remove({ endpoint });
      const reg = regRef.current ?? (await navigator.serviceWorker.ready);
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
      setEndpoint(null);
      setSubscribed(false);
      setState("off");
    } catch {
      setState("off");
    }
  }, [endpoint, remove]);

  return { state, error, supported, configured: Boolean(vapid?.key), subscribed, enable, disable };
}

/**
 * Shell-level side effect: make sure the service worker is registered and a
 * granted push subscription stays alive (browsers rotate endpoints / update
 * the SW periodically). Never prompts — explicit enabling happens in
 * Settings → Device permissions.
 */
export function usePush() {
  const save = useMutation(api.push.savePushSubscription);
  const vapid = useQuery(api.push.pushVapidPublicKey, {});

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (!vapid?.key) return;
    (async () => {
      try {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;
        const existing = await reg.pushManager.getSubscription();
        if (!existing) return; // user never opted in on this device
        const json = existing.toJSON() as { keys?: { p256dh?: string; auth?: string } };
        if (!json.keys?.p256dh || !json.keys?.auth) return;
        await save({
          endpoint: existing.endpoint,
          keysP256dh: json.keys.p256dh,
          keysAuth: json.keys.auth,
          userAgent: navigator.userAgent.slice(0, 250),
          platform: (navigator as any)?.userAgentData?.platform ?? navigator.platform ?? undefined,
        }).catch(() => undefined);
      } catch {
        /* push is best-effort in the shell */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vapid, save]);
}
