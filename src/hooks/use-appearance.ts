import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { setThemeAwareUserMode, setThemeModeOverride } from "@/lib/appTheme";

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
  // Mirror for the index.html no-flash bootstrap (last member's choice).
  try {
    if (userId) {
      localStorage.setItem(`roboShelf.appearance.${userId}`, mode);
    }
  } catch {
    /* storage unavailable */
  }
  // Remember the member's own choice: it is re-applied if the admin ever
  // switches the published app theme off (see src/lib/appTheme.ts).
  setThemeAwareUserMode(mode);
  // The member's mode applies ALWAYS — even while a published app theme is
  // live. The theme keeps owning the colors (its inline vars on <html> are
  // untouched); only the dark/light class follows the member's choice, which
  // setThemeModeOverride remembers so theme re-applies keep honoring it.
  const dark = resolve(mode);
  document.documentElement.classList.toggle("dark", dark);
  // Keep the class off <body>: a .dark block on body shadows the published
  // app theme's inline vars (which live on <html>) for the whole page.
  document.body?.classList.remove("dark");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Apply a mode immediately (used by the inline bootstrap in index.html). */
export function applyAppearance(mode: AppearanceValue) {
  applyMode(mode);
}

export function useAppearance(userId?: string) {
  // Settings load with the authed session; undefined while loading.
  const mode = useQuery(api.settings.getMyAppearance, {});
  const saveMode = useMutation(api.settings.setMyAppearance);

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
  // Every explicit switch is also remembered as the member's mode override:
  // a live app theme keeps its colors, but this dark/light choice wins over
  // the theme's base mode from now on (see src/lib/appTheme.ts).
  const save = async (args: { value: AppearanceValue }) => {
    setThemeModeOverride(args.value);
    return saveMode(args);
  };
  return { mode: mode ?? "dark", save };
}
