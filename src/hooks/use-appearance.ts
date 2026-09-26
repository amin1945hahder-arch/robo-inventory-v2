import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Per-user app mode (dark / light / follow system).
 *
 * The setting lives on the user row (like sounds) so each member gets their
 * own mode on every device. The chosen mode is applied by toggling the `dark`
 * class on <html> — the entire theme token system reacts to it.
 *
 * Mounted ONCE inside the authed app shell; exposes the setters for the
 * Settings/Profile UIs via the appearance event bridge below.
 */

export type AppearanceValue = "dark" | "light" | "system";

/** Resolve "system" against the OS preference. */
function resolve(mode: AppearanceValue): boolean {
  if (mode === "system") {
    return typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true;
  }
  return mode === "dark";
}

function applyMode(mode: AppearanceValue, userId?: string) {
  const dark = resolve(mode);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  // Mirror for the index.html no-flash bootstrap (last member's choice).
  try {
    if (userId) {
      localStorage.setItem(`roboShelf.appearance.${userId}`, mode);
    }
  } catch {
    /* storage unavailable */
  }
}

/** Apply a mode immediately (used by the inline bootstrap in index.html). */
export function applyAppearance(mode: AppearanceValue) {
  applyMode(mode);
}

export function useAppearance(userId?: string) {
  // Settings load with the authed session; undefined while loading.
  const mode = useQuery(api.settings.getMyAppearance, {});
  const save = useMutation(api.settings.setMyAppearance);

  // Apply (and keep applying) the user's mode.
  useEffect(() => {
    if (!mode) return;
    applyMode(mode, userId);
    // Follow OS changes live when set to "system".
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("system", userId);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, userId]);

  // Keep the DB value reachable for the Settings UI without prop drilling:
  // use-appearance (mounted in AppShell) holds the query, the Settings section
  // reads the current value from the same query itself.
  return { mode: mode ?? "dark", save };
}
