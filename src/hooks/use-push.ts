import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "./use-auth";

/**
 * App-level push notifications:
 *  1. Registers /sw.js (once) so the page can show OS notifications even when
 *     the app is wrapped in an APK/EXE webview shell.
 *  2. Asks for the Notification permission once (remembered in localStorage).
 *  3. Watches the user's live rental counts — when a pending request gets
 *     approved/denied (pending drops) or a new decision arrives, an OS
 *     notification is fired through the service worker. Sounds keep playing
 *     separately via useSound.
 */

const SW_REGISTERED_KEY = "roboShelf.sw.registered";
const NOTIF_ASKED_KEY = "roboShelf.permissions.notifications";

export function usePush() {
  const { user } = useAuth();
  const counts = useQuery(api.parts.myRequestCounts, user && !user.isAnonymous ? {} : "skip");
  const prev = useRef<{ pending: number; active: number; onProject: number } | null>(null);
  const swReady = useRef<Promise<ServiceWorkerRegistration | null> | null>(null);

  // Register the service worker once per browser.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    try {
      if (window.localStorage.getItem(SW_REGISTERED_KEY)) return;
    } catch {
      /* private mode — still try to register */
    }
    swReady.current =
      swReady.current ??
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          try {
            window.localStorage.setItem(SW_REGISTERED_KEY, "1");
          } catch {
            /* ignore */
          }
          return reg;
        })
        .catch(() => null);
  }, []);

  // Ask for the OS notification permission once (user gesture not strictly
  // required for Notification.requestPermission, but we only ask on load).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    try {
      if (window.localStorage.getItem(NOTIF_ASKED_KEY)) return;
      window.localStorage.setItem(NOTIF_ASKED_KEY, "asked");
    } catch {
      /* private mode */
    }
    void Notification.requestPermission();
  }, []);

  // Fire OS notifications on live changes to my rental requests.
  useEffect(() => {
    if (!counts) return;
    const before = prev.current;
    prev.current = { pending: counts.pending, active: counts.active, onProject: counts.onProject };
    if (!before) return;

    const events: { title: string; body: string }[] = [];
    if (counts.pending < before.pending && counts.active > before.active) {
      events.push({
        title: "Rental approved ✅",
        body: "Your rental request was approved — pick it up from the lab.",
      });
    } else if (counts.pending < before.pending) {
      events.push({
        title: "Request decided",
        body: "A rental request of yours was processed — open My rentals for details.",
      });
    }
    if (counts.onProject > before.onProject) {
      events.push({
        title: "Part on project 🤖",
        body: "One of your parts was assigned to a club project.",
      });
    }
    if (!events.length) return;

    (async () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const reg =
        (await swReady.current?.catch(() => null)) ??
        (await navigator.serviceWorker?.getRegistration().catch(() => null)) ??
        null;
      for (const ev of events) {
        if (reg?.showNotification) {
          reg.showNotification(ev.title, { body: ev.body, tag: "roboshelf", icon: "/logo.svg" });
        } else if (typeof Notification !== "undefined") {
          new Notification(ev.title, { body: ev.body, icon: "/logo.svg" });
        }
      }
    })();
  }, [counts]);
}
