/**
 * Custom icon system — drop-in .svg overrides for categories and nav tabs.
 *
 * ── HOW TO USE YOUR OWN ICONS ─────────────────────────────────────────────
 *
 * 1. CATEGORIES (inventory categories, e.g. "Arduino", "Sensors", "Filament")
 *      Folder:  src/assets/icons/categories/
 *      Name:    the category name in lowercase kebab-case + .svg
 *               "3D Printers" → 3d-printers.svg
 *               "MicroControllers" → microcontrollers.svg
 *               "Jumper wires" → jumper-wires.svg
 *
 * 2. NAV TABS (sidebar & mobile menu entries)
 *      Folder:  src/assets/icons/nav/
 *      Name:    the route's first segment + .svg — see NAV_ROUTES below:
 *               dashboard, inventory, storages, projects, rentals
 *               (my-rentals.svg), 3d-printing, courses, requests, people,
 *               import, labels, export, reports, settings
 *
 * Rules for both: put your .svg in the folder with that exact file name and
 * the app picks it up automatically — no code changes. Your artwork renders
 * exactly as authored (multicolor is fine, rendered via <img>).
 * If a slot has no matching file, the built-in Lucide icon keeps working.
 *
 * ⚠️ After adding brand-new files (not replacing existing ones), the dev
 * server must be restarted once so Vite's import glob sees them.
 * ──────────────────────────────────────────────────────────────────────────
 */

const CATEGORY_GLOB = import.meta.glob<string>("/src/assets/icons/categories/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

const NAV_GLOB = import.meta.glob<string>("/src/assets/icons/nav/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

/** File base name (kebab-case) → SVG url. */
const categoryIcons = new Map<string, string>();
for (const [path, url] of Object.entries(CATEGORY_GLOB)) {
  categoryIcons.set(path.split("/").pop()!.replace(/\.svg$/, ""), url);
}

/** Route → SVG url. */
const navIcons = new Map<string, string>();
for (const [path, url] of Object.entries(NAV_GLOB)) {
  navIcons.set(path.split("/").pop()!.replace(/\.svg$/, ""), url);
}

/** Lowercase kebab-case file base for a display name ("3D Printers" → "3d-printers"). */
export function iconFileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Per-theme icon overrides ─────────────────────────────────────────────
// A published theme may map icon slots to catalog icons (lib/theme-icons):
//   "nav:/inventory" → "Boxes"    "category:arduino" → "Cpu"
// The map lives in this tiny external store so AppIcon re-renders the moment
// a theme (or preview) is applied. No override → the slot keeps its current
// icon (svg file, else the built-in fallback).

let themeIconOverrides: Record<string, string> | null = null;
const themeIconListeners = new Set<() => void>();

/** Push a new override map (theme applied / cleared / previewed). */
export function setThemeIconOverrides(next: Record<string, string> | null): void {
  themeIconOverrides = next && Object.keys(next).length > 0 ? next : null;
  for (const listener of themeIconListeners) listener();
}

export function getThemeIconOverrides(): Record<string, string> | null {
  return themeIconOverrides;
}

/** useSyncExternalStore subscription. */
export function subscribeThemeIcons(listener: () => void): () => void {
  themeIconListeners.add(listener);
  return () => {
    themeIconListeners.delete(listener);
  };
}

/** Slot key for a nav/route icon. */
export function navIconSlot(route: string): string {
  return `nav:${route}`;
}

/** Slot key for a category icon. */
export function categoryIconSlot(name: string): string {
  return `category:${iconFileName(name)}`;
}

/** Resolver for a category icon url (undefined → caller uses the Lucide fallback). */
export function categoryIconUrl(name: string): string | undefined {
  return categoryIcons.get(iconFileName(name));
}

/** Resolver for a nav/route icon url by route path (e.g. "/3d-printing"). */
export function navIconUrl(route: string): string | undefined {
  const base =
    iconFileName(route.replace(/^\//, "").replace(/\/.*$/, "")) || "dashboard";
  return navIcons.get(base);
}
