import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { applyThemeState, type ThemeState } from "@/lib/appTheme";

/**
 * The published global app theme, for every member.
 *
 * The Convex query is reactive: when an admin publishes a new theme, every
 * connected client repaints immediately ("as if it was published like
 * that"). Each state push also refreshes the localStorage cache, which
 * initThemeFromCache() re-applies synchronously at boot — so the theme
 * shows up on the first frame with no round-trip and keeps working
 * offline.
 *
 * Returns undefined while the first query is in flight.
 */
export function useAppTheme(): ThemeState | undefined {
  const state = useQuery(api.appThemes.get, {});

  useEffect(() => {
    if (state) applyThemeState(state);
  }, [state]);

  return state;
}

/** Mounted once (in main.tsx) so the theme applies app-wide, landing included. */
export function AppThemeProvider() {
  useAppTheme();
  return null;
}
