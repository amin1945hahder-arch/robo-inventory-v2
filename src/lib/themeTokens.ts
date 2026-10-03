/**
 * The app theme token catalog — a single, pure source of truth shared by:
 *   - the theme editor UI (src/components/AppThemeSection.tsx)
 *   - the runtime applier (src/lib/appTheme.ts)
 *   - the Convex backend validator (src/convex/appThemes.ts)
 *
 * Every key here is a CSS custom property the app already uses; the raw
 * default values are the oklch() tokens from src/index.css (light = :root,
 * dark = .dark) so a "reset to default" always matches the shipped theme.
 * This module is intentionally DOM-free so the Convex backend can import it.
 */

import { cssToHex } from "./color";

export type ThemeMode = "dark" | "light";

export type ThemeTokenKey =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "accent"
  | "accent-foreground"
  | "muted"
  | "muted-foreground"
  | "destructive"
  | "border"
  | "input"
  | "ring"
  | "sidebar"
  | "sidebar-foreground"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-border"
  | "sidebar-ring"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5";

/** Every editable token, in editor order. */
export const TOKEN_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "accent",
  "accent-foreground",
  "muted",
  "muted-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const satisfies readonly ThemeTokenKey[];

export type TokenMeta = { key: ThemeTokenKey; label: string; hint: string };

export type TokenGroup = {
  id: string;
  label: string;
  hint: string;
  tokens: TokenMeta[];
};

const t = (key: ThemeTokenKey, label: string, hint: string): TokenMeta => ({
  key,
  label,
  hint,
});

/** Grouped token catalog rendered by the theme editor. */
export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: "canvas",
    label: "Canvas & surfaces",
    hint: "The page itself, cards and floating popovers",
    tokens: [
      t("background", "Background", "Whole-app page background"),
      t("foreground", "Text", "Default text color"),
      t("card", "Card surface", "Panels, dialogs and glass cards"),
      t("card-foreground", "Card text", "Text on cards"),
      t("popover", "Popover surface", "Dropdowns, menus and tooltips"),
      t("popover-foreground", "Popover text", "Text inside popovers"),
    ],
  },
  {
    id: "brand",
    label: "Brand & interaction",
    hint: "Buttons, links, highlights, focus and danger states",
    tokens: [
      t("primary", "Primary", "Main brand color — buttons, links, active states"),
      t("primary-foreground", "On primary", "Text sitting on the primary color"),
      t("secondary", "Secondary fill", "Soft fills for secondary buttons"),
      t("secondary-foreground", "On secondary", "Text on secondary fills"),
      t("accent", "Accent fill", "Hover and selected-row highlights"),
      t("accent-foreground", "On accent", "Text on accent fills"),
      t("muted", "Muted fill", "Subtle fills, chips and table stripes"),
      t("muted-foreground", "Muted text", "Secondary and hint text"),
      t("ring", "Focus ring", "Keyboard focus outline"),
      t("destructive", "Destructive", "Delete and danger-zone actions"),
    ],
  },
  {
    id: "borders",
    label: "Borders & inputs",
    hint: "Lines that separate and frame the interface",
    tokens: [
      t("border", "Borders", "Default border color everywhere"),
      t("input", "Input borders", "Outlines of text fields and selects"),
    ],
  },
  {
    id: "sidebar",
    label: "Sidebar",
    hint: "The floating navigation panel",
    tokens: [
      t("sidebar", "Sidebar surface", "Sidebar background"),
      t("sidebar-foreground", "Sidebar text", "Navigation labels"),
      t("sidebar-primary", "Sidebar active", "Active navigation highlight"),
      t("sidebar-primary-foreground", "On sidebar active", "Text on the active item"),
      t("sidebar-accent", "Sidebar hover", "Hover fill for nav items"),
      t("sidebar-accent-foreground", "On sidebar hover", "Text on hover fill"),
      t("sidebar-border", "Sidebar divider", "Sidebar separators"),
      t("sidebar-ring", "Sidebar focus", "Sidebar focus outline"),
    ],
  },
  {
    id: "charts",
    label: "Charts",
    hint: "Reports, dashboards and statistics palette",
    tokens: [
      t("chart-1", "Chart 1", "Primary series"),
      t("chart-2", "Chart 2", "Secondary series"),
      t("chart-3", "Chart 3", "Third series"),
      t("chart-4", "Chart 4", "Fourth series"),
      t("chart-5", "Chart 5", "Fifth series"),
    ],
  },
];

/**
 * Raw design tokens copied 1:1 from src/index.css — light from `:root`,
 * dark from `.dark`. Values are oklch()/oklch with alpha.
 */
export const RAW_DEFAULTS: Record<ThemeMode, Record<ThemeTokenKey, string>> = {
  light: {
    background: "oklch(0.975 0.006 240)",
    foreground: "oklch(0.21 0.03 255)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.21 0.03 255)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0.21 0.03 255)",
    primary: "oklch(0.62 0.12 210)",
    "primary-foreground": "oklch(0.985 0.005 240)",
    secondary: "oklch(0.945 0.012 245)",
    "secondary-foreground": "oklch(0.28 0.035 255)",
    accent: "oklch(0.93 0.03 285)",
    "accent-foreground": "oklch(0.32 0.07 290)",
    muted: "oklch(0.945 0.012 245)",
    "muted-foreground": "oklch(0.48 0.025 252)",
    destructive: "oklch(0.55 0.22 25)",
    border: "oklch(0.9 0.012 250)",
    input: "oklch(0.88 0.014 250)",
    ring: "oklch(0.62 0.12 210)",
    sidebar: "oklch(0.965 0.008 245)",
    "sidebar-foreground": "oklch(0.21 0.03 255)",
    "sidebar-primary": "oklch(0.62 0.12 210)",
    "sidebar-primary-foreground": "oklch(0.985 0.005 240)",
    "sidebar-accent": "oklch(0.945 0.012 245)",
    "sidebar-accent-foreground": "oklch(0.28 0.035 255)",
    "sidebar-border": "oklch(0.21 0.03 255 / 10%)",
    "sidebar-ring": "oklch(0.62 0.12 210)",
    "chart-1": "oklch(0.62 0.12 210)",
    "chart-2": "oklch(0.55 0.16 305)",
    "chart-3": "oklch(0.6 0.13 160)",
    "chart-4": "oklch(0.7 0.14 85)",
    "chart-5": "oklch(0.62 0.19 20)",
  },
  dark: {
    background: "oklch(0.16 0.024 250)",
    foreground: "oklch(0.965 0.006 240)",
    card: "oklch(0.205 0.028 252)",
    "card-foreground": "oklch(0.965 0.006 240)",
    popover: "oklch(0.22 0.03 252)",
    "popover-foreground": "oklch(0.965 0.006 240)",
    primary: "oklch(0.83 0.15 195)",
    "primary-foreground": "oklch(0.16 0.03 250)",
    secondary: "oklch(0.27 0.035 255)",
    "secondary-foreground": "oklch(0.96 0.01 240)",
    accent: "oklch(0.29 0.04 285)",
    "accent-foreground": "oklch(0.9 0.06 290)",
    muted: "oklch(0.25 0.028 252)",
    "muted-foreground": "oklch(0.7 0.02 250)",
    destructive: "oklch(0.62 0.2 25)",
    border: "oklch(1 0 0 / 10%)",
    input: "oklch(1 0 0 / 14%)",
    ring: "oklch(0.7 0.1 195)",
    sidebar: "oklch(0.19 0.026 251)",
    "sidebar-foreground": "oklch(0.965 0.006 240)",
    "sidebar-primary": "oklch(0.83 0.15 195)",
    "sidebar-primary-foreground": "oklch(0.16 0.03 250)",
    "sidebar-accent": "oklch(0.27 0.035 255)",
    "sidebar-accent-foreground": "oklch(0.96 0.01 240)",
    "sidebar-border": "oklch(1 0 0 / 10%)",
    "sidebar-ring": "oklch(0.7 0.1 195)",
    "chart-1": "oklch(0.83 0.15 195)",
    "chart-2": "oklch(0.75 0.17 305)",
    "chart-3": "oklch(0.78 0.16 160)",
    "chart-4": "oklch(0.85 0.15 85)",
    "chart-5": "oklch(0.68 0.19 20)",
  },
};

/**
 * Default colors for a mode, as canonical hex — the starting point for new
 * themes and the target of every "reset" button. Computed from
 * RAW_DEFAULTS so it can never drift from index.css.
 */
export function defaultColors(mode: ThemeMode): Record<ThemeTokenKey, string> {
  const raw = RAW_DEFAULTS[mode];
  const out = {} as Record<ThemeTokenKey, string>;
  for (const key of TOKEN_KEYS) {
    out[key] = cssToHex(raw[key]) ?? "#808080";
  }
  return out;
}
