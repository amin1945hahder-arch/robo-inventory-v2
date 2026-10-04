/**
 * AppIcon — one component for every icon slot that supports overrides.
 *
 * Resolution order (first hit wins):
 *   1. PUBLISHED THEME override — theme.icons["nav:/inventory"] → catalog
 *      icon (lib/theme-icons). Set per theme in the theme editor; a slot
 *      with no override keeps its current icon ("default = current").
 *   2. Custom .svg file (src/assets/icons/…) — drop-in artwork, multicolor
 *      supported, rendered via <img>.
 *   3. The built-in Lucide fallback passed by the caller.
 *
 * Either way the glyph sits inside a 3D GLASS TILE (frosted square, top
 * specular edge, floating shadow) — the app's icon treatment.
 *
 * Locations (replace files, same names, .svg):
 *   • Categories: src/assets/icons/categories/<category-name>.svg
 *       "3D Printers" → 3d-printers.svg, "Jumper wires" → jumper-wires.svg
 *   • Nav tabs:   src/assets/icons/nav/<route>.svg
 *       dashboard.svg, inventory.svg, closets.svg, projects.svg,
 *       rentals.svg, 3d-printing.svg, requests.svg, people.svg, import.svg,
 *       labels.svg, export.svg, reports.svg, settings.svg
 *
 * Custom artwork renders via <img>, so multicolor SVGs display exactly as
 * authored. Built-in fallbacks inherit the current text color.
 */
import { useSyncExternalStore, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import {
  categoryIconSlot,
  categoryIconUrl,
  getThemeIconOverrides,
  navIconSlot,
  navIconUrl,
  subscribeThemeIcons,
} from "@/lib/custom-icons";
import { resolveThemeIcon } from "@/lib/theme-icons";

export function AppIcon({
  className,
  route,
  category,
  fallback: Fallback,
  glass = true,
}: {
  className?: string;
  /** Route for nav tab icons ("/dashboard", "/inventory"…). */
  route?: string;
  /** Category name for category icons ("Arduino", "3D Printers"…). */
  category?: string;
  /** Built-in icon used when no theme override or .svg exists for the slot. */
  fallback: ComponentType<{ className?: string }>;
  /** Wrap in the 3D glass tile (default true). Plain glyphs in tiny spots. */
  glass?: boolean;
}) {
  // Re-render when a theme (or editor preview) changes the icon map.
  const overrides = useSyncExternalStore(
    subscribeThemeIcons,
    getThemeIconOverrides,
    () => null,
  );
  const slot = route ? navIconSlot(route) : category ? categoryIconSlot(category) : undefined;
  const Override = resolveThemeIcon(slot ? overrides?.[slot] : undefined);
  const custom = route ? navIconUrl(route) : category ? categoryIconUrl(category) : undefined;
  const size = className ?? "size-4";

  if (custom && !Override) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md",
          glass && "icon-glass",
          size,
        )}
      >
        <img src={custom} alt="" className="size-[72%] object-contain" draggable={false} />
      </span>
    );
  }
  const Glyph = Override ?? Fallback;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        glass && "icon-glass",
        size,
      )}
    >
      <Glyph className="icon-3d size-[68%]" />
    </span>
  );
}
