import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  SETTLE_MS,
  evaluate,
  fingerprintOf,
  initialState,
  onNavigate,
} from "@/lib/nav-watchdog";

/**
 * Watches every navigation and repairs one that failed to render.
 *
 * Returns a counter to use as the `key` of the route tree: it stays 0 while
 * everything is healthy, so normal navigation is untouched, and only bumps
 * when the watchdog proves the page on screen did not change.
 *
 * Escalation (bounded by MAX_STALL_REMOUNTS) ends in window.location.reload(),
 * which is the one thing that always recovers — the behaviour we are replacing
 * with an automatic one.
 */
export function useNavigationWatchdog(settleMs = SETTLE_MS): number {
  const location = useLocation();
  const [remounts, setRemounts] = useState(0);
  const stateRef = useRef(initialState());

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const state = onNavigate(stateRef.current, path, fingerprintOf(document));
    stateRef.current = state;

    const timer = window.setTimeout(() => {
      const result = evaluate(stateRef.current, fingerprintOf(document));
      stateRef.current = result.state;
      if (result.action === "remount") {
        setRemounts((n) => n + 1);
      } else if (result.action === "reload") {
        window.location.reload();
      }
    }, settleMs);

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search, remounts, settleMs]);

  return remounts;
}