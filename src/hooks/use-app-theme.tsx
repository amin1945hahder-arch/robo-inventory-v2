import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  applyThemeState,
  BUILTIN_THEMES,
  setUserThemePreference,
  type ThemeState,
} from "@/lib/appTheme";

/** Remembers the last published theme we told this member about. */
const SEEN_PUBLISHED_KEY = "rc.appTheme.seenPublished";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_PUBLISHED_KEY);
  } catch {
    return null;
  }
}
function writeSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_PUBLISHED_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

/**
 * The published global app theme (for every member) combined with the
 * member's OWN theme preference.
 *
 *  - an admin publishing a theme repaints every connected client immediately;
 *  - a member who picked a custom theme keeps it (the published theme does
 *    not override their choice) UNLESS a scheduled club theme is live, which
 *    is forced for everyone while its window runs;
 *  - when the admin publishes a NEW main theme, a member who has a custom
 *    theme is notified and can apply the new one in a single tap.
 *
 * Each state push refreshes the localStorage cache, which initThemeFromCache()
 * re-applies synchronously at boot — no flash, works offline.
 */
export function useAppTheme(): ThemeState | undefined {
  const state = useQuery(api.appThemes.get, {});
  const myTheme = useQuery(api.settings.getMyTheme, {});

  useEffect(() => {
    // Feed the member's preference into the resolver BEFORE applying so the
    // paint already reflects their custom theme (never a brief flash of the
    // published one).
    setUserThemePreference(myTheme ? myTheme : null);
    if (state) applyThemeState(state);
  }, [state, myTheme]);

  return state;
}

/**
 * Mounted once (in main.tsx) so the theme applies app-wide, landing included,
 * and so the "new theme published" notice fires from one place.
 */
export function AppThemeProvider() {
  const state = useAppTheme();
  const myTheme = useQuery(api.settings.getMyTheme, {});
  const setMyTheme = useMutation(api.settings.setMyTheme);

  useEffect(() => {
    const published = state?.activeId ?? null;
    // Only a member who has deliberately chosen their OWN theme needs the
    // prompt: everyone else already sees the new theme automatically.
    if (!published || !myTheme) return;
    if (readSeen() === published) return;
    writeSeen(published);
    const theme =
      BUILTIN_THEMES.find((t) => t.id === published) ??
      state?.themes.find((t) => t.id === published) ??
      null;
    toast(`New theme published: ${theme?.name ?? "club theme"}`, {
      description: "Apply it across the app, or keep your own custom theme.",
      duration: 12000,
      action: {
        label: "Apply",
        onClick: () => {
          void setMyTheme({ id: null }).catch(() => undefined);
        },
      },
      cancel: { label: "Keep mine", onClick: () => undefined },
    });
  }, [state, myTheme, setMyTheme]);

  return null;
}
