/**
 * AppIcon — one component for every icon slot that supports user overrides.
 *
 * Renders the user's .svg (src/assets/icons/…) when one exists for the slot;
 * otherwise falls back to the given built-in Lucide icon.
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
}: {
  className?: string;
  /** Route for nav tab icons ("/dashboard", "/inventory"…). */
  route?: string;
  /** Category name for category icons ("Arduino", "3D Printers"…). */
  category?: string;
  /** Built-in icon used when no custom .svg exists for the slot. */
  fallback: ComponentType<{ className?: string }>;
}) {
  const custom = route ? navIconUrl(route) : category ? categoryIconUrl(category) : undefined;
  if (custom) {
    return <img src={custom} alt="" aria-hidden className={cn("shrink-0 object-contain", className)} draggable={false} />;
  }
  return <Fallback className={className} />;
}
