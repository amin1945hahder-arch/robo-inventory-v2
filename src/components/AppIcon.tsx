/**
 * AppIcon — one component for every icon slot that supports user overrides.
 *
 * Renders the user's .svg (src/assets/icons/…) when one exists for the slot;
 * otherwise falls back to the given built-in Lucide icon. Either way the
 * glyph sits inside a 3D GLASS TILE (frosted square, top specular edge,
 * floating shadow) — the app's icon treatment.
 *
 * Locations (replace files, same names, .svg):
 *   • Categories: src/assets/icons/categories/<category-name>.svg
 *       "3D Printers" → 3d-printers.svg, "Jumper wires" → jumper-wires.svg
 *   • Nav tabs:   src/assets/icons/nav/<route>.svg
 *       dashboard.svg, inventory.svg, storages.svg, projects.svg,
 *       my-rentals.svg, 3d-printing.svg, courses.svg, requests.svg,
 *       people.svg, import.svg, labels.svg, export.svg, reports.svg,
 *       settings.svg
 *
 * Custom artwork renders via <img>, so multicolor SVGs display exactly as
 * authored. Built-in fallbacks inherit the current text color.
 */
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { categoryIconUrl, navIconUrl } from "@/lib/custom-icons";

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
  /** Built-in icon used when no custom .svg exists for the slot. */
  fallback: ComponentType<{ className?: string }>;
  /** Wrap in the 3D glass tile (default true). Plain glyphs in tiny spots. */
  glass?: boolean;
}) {
  const custom = route ? navIconUrl(route) : category ? categoryIconUrl(category) : undefined;
  const size = className ?? "size-4";
  if (custom) {
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
  const Glyph = Fallback;
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
