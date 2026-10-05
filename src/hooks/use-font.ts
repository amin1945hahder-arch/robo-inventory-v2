import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { applyFont } from "@/lib/fonts";

/**
 * Per-user font: applies the member's saved typeface (settings.getMyFont)
 * to <html> and keeps it in sync as they change it elsewhere. Mounted ONCE
 * inside the authed app shell, next to useAppearance.
 */
export function useFont() {
  const font = useQuery(api.settings.getMyFont, {});

  useEffect(() => {
    // undefined = still loading — leave whatever is on screen alone so the
    // default font doesn't flash before the member's choice arrives.
    if (font === undefined) return;
    applyFont(font);
  }, [font]);

  return font;
}
