/**
 * Global app theme — runtime engine.
 *
 * A theme is a complete set of design-token colors (+ corner radius) that
 * the admin publishes to EVERY member. Applying a theme writes the tokens
 * as inline CSS custom properties on <html>, which overrides both the
 * `:root` (light) and `.dark` (dark) blocks in src/index.css — the whole
 * token system, glass utilities, charts and sidebar react automatically.
 *
 * Caching: the last server state (themes + which one is active) is kept in
 * localStorage and re-applied synchronously at boot (initThemeFromCache),
 * so the published theme appears instantly — no wait, no flash — and keeps
 * working offline. The Convex subscription then refreshes it in place.
 *
 * Preview: the editor wraps itself in beginThemePreview()/endThemePreview()
 * so draft edits are applied live to the whole app, then rolled back to the
 * published state on cancel.
 */

import { clamp, parseHex, rgbaToHex } from "./color";
import { setThemeIconOverrides } from "./custom-icons";
import {
  defaultColors,
  TOKEN_KEYS,
  type ThemeMode,
  type ThemeTokenKey,
} from "./themeTokens";

export type { ThemeMode, ThemeTokenKey };
export { TOKEN_KEYS, defaultColors };

export type AppTheme = {
  id: string;
  name: string;
  mode: ThemeMode;
  /** Token key (no `--`) → hex color (#rrggbb or #rrggbbaa). */
  colors: Record<string, string>;
  /** Corner radius in rem (maps to --radius). */
  radius: number;
  /** Icon-slot overrides: "nav:/inventory" → "Boxes" (see lib/theme-icons). */
  icons?: Record<string, string>;
  /** Built-in presets ship with the app and cannot be deleted. */
  builtin?: boolean;
  createdAt?: number;
  updatedAt?: number;
};

/** Auto-applied window: `themeId` is live from `from` until `to` (ms epoch). */
export type ThemeSchedule = { themeId: string; from: number; to: number };

export type ThemeState = {
  themes: AppTheme[];
  /** Explicitly published theme (null → fall back to defaultId / shipped default). */
  activeId: string | null;
  /** The club's default theme, applied whenever nothing is explicitly published. */
  defaultId?: string | null;
  /** Scheduled holiday theme: wins while now ∈ [from, to). */
  schedule?: ThemeSchedule | null;
};

export const DEFAULT_RADIUS = 0.625; // rem — matches src/index.css

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

type Overrides = Partial<Record<ThemeTokenKey, string>>;

function preset(
  id: string,
  name: string,
  mode: ThemeMode,
  overrides: Overrides,
): AppTheme {
  return {
    id,
    name,
    mode,
    radius: DEFAULT_RADIUS,
    builtin: true,
    colors: { ...defaultColors(mode), ...overrides },
  };
}

/**
 * Presets offered to every admin. Each one starts from the shipped
 * defaults of its mode and repaints the brand / accent / chart tokens.
 */
export const BUILTIN_THEMES: AppTheme[] = [
  preset("preset-neon-cyan", "Neon Cyan", "dark", {}),
  preset("preset-violet-storm", "Violet Storm", "dark", {
    primary: "#a78bfa",
    "primary-foreground": "#1e1b4b",
    ring: "#c4b5fd",
    secondary: "#312e81",
    "secondary-foreground": "#e0e7ff",
    accent: "#2e1065",
    "accent-foreground": "#ddd6fe",
    "sidebar-primary": "#a78bfa",
    "sidebar-accent": "#312e81",
    "sidebar-accent-foreground": "#e0e7ff",
    "chart-1": "#a78bfa",
    "chart-2": "#f0abfc",
    "chart-3": "#6ee7b7",
    "chart-4": "#fcd34d",
    "chart-5": "#fda4af",
  }),
  preset("preset-emerald-circuit", "Emerald Circuit", "dark", {
    primary: "#34d399",
    "primary-foreground": "#042f2e",
    ring: "#6ee7b7",
    secondary: "#064e3b",
    "secondary-foreground": "#d1fae5",
    accent: "#064e3b",
    "accent-foreground": "#a7f3d0",
    sidebar: "#052e2b",
    "sidebar-primary": "#34d399",
    "sidebar-accent": "#064e3b",
    "sidebar-accent-foreground": "#a7f3d0",
    "chart-1": "#34d399",
    "chart-2": "#2dd4bf",
    "chart-3": "#a3e635",
    "chart-4": "#facc15",
    "chart-5": "#fb7185",
  }),
  preset("preset-solar-forge", "Solar Forge", "dark", {
    background: "#17130c",
    card: "#211a10",
    popover: "#241d12",
    primary: "#fbbf24",
    "primary-foreground": "#451a03",
    ring: "#fcd34d",
    secondary: "#422006",
    "secondary-foreground": "#fef3c7",
    accent: "#78350f",
    "accent-foreground": "#fde68a",
    border: "#ffffff1f",
    sidebar: "#1c1710",
    "sidebar-primary": "#fbbf24",
    "sidebar-accent": "#422006",
    "sidebar-accent-foreground": "#fef3c7",
    "chart-1": "#fbbf24",
    "chart-2": "#fb923c",
    "chart-3": "#f87171",
    "chart-4": "#facc15",
    "chart-5": "#f472b6",
  }),
  preset("preset-crimson-core", "Crimson Core", "dark", {
    primary: "#fb7185",
    "primary-foreground": "#4c0519",
    ring: "#fda4af",
    secondary: "#881337",
    "secondary-foreground": "#ffe4e6",
    accent: "#881337",
    "accent-foreground": "#fecdd3",
    "sidebar-primary": "#fb7185",
    "sidebar-accent": "#881337",
    "sidebar-accent-foreground": "#fecdd3",
    "chart-1": "#fb7185",
    "chart-2": "#f472b6",
    "chart-3": "#fda4af",
    "chart-4": "#c084fc",
    "chart-5": "#f97316",
  }),
  preset("preset-arctic-dawn", "Arctic Dawn", "light", {
    primary: "#0284c7",
    "primary-foreground": "#f0f9ff",
    ring: "#38bdf8",
    accent: "#e0f2fe",
    "accent-foreground": "#075985",
    "sidebar-primary": "#0284c7",
    "chart-1": "#0ea5e9",
    "chart-2": "#6366f1",
    "chart-3": "#14b8a6",
    "chart-4": "#f59e0b",
    "chart-5": "#ef4444",
  }),
  preset("preset-paper-lab", "Paper Lab", "light", {
    primary: "#4f46e5",
    "primary-foreground": "#eef2ff",
    ring: "#818cf8",
    accent: "#eef2ff",
    "accent-foreground": "#3730a3",
    sidebar: "#f5f6fb",
    "sidebar-primary": "#4f46e5",
    "sidebar-accent": "#eef2ff",
    "sidebar-accent-foreground": "#3730a3",
    "chart-1": "#6366f1",
    "chart-2": "#8b5cf6",
    "chart-3": "#06b6d4",
    "chart-4": "#10b981",
    "chart-5": "#f43f5e",
  }),

  // ---- Holiday presets: schedule them for the season (see the Schedule
  // panel in the theme editor) or publish them straight away. ---------------
  preset("preset-christmas-eve", "Christmas Eve", "dark", {
    primary: "#ef4444",
    "primary-foreground": "#450a0a",
    ring: "#fca5a5",
    secondary: "#14532d",
    "secondary-foreground": "#dcfce7",
    accent: "#166534",
    "accent-foreground": "#bbf7d0",
    sidebar: "#0f1c13",
    "sidebar-primary": "#ef4444",
    "sidebar-accent": "#14532d",
    "sidebar-accent-foreground": "#dcfce7",
    "chart-1": "#ef4444",
    "chart-2": "#22c55e",
    "chart-3": "#facc15",
    "chart-4": "#f87171",
    "chart-5": "#38bdf8",
  }),
  preset("preset-ramadan-crescent", "Ramadan Crescent", "dark", {
    primary: "#fcd34d",
    "primary-foreground": "#1e1b4b",
    ring: "#fde68a",
    secondary: "#164e63",
    "secondary-foreground": "#cffafe",
    accent: "#0c4a6e",
    "accent-foreground": "#bae6fd",
    sidebar: "#0b1a33",
    "sidebar-primary": "#fcd34d",
    "sidebar-accent": "#164e63",
    "sidebar-accent-foreground": "#cffafe",
    "chart-1": "#fcd34d",
    "chart-2": "#38bdf8",
    "chart-3": "#34d399",
    "chart-4": "#a78bfa",
    "chart-5": "#f472b6",
  }),
  preset("preset-halloween-night", "Halloween Night", "dark", {
    primary: "#fb923c",
    "primary-foreground": "#431407",
    ring: "#fdba74",
    secondary: "#4c1d95",
    "secondary-foreground": "#ede9fe",
    accent: "#581c87",
    "accent-foreground": "#e9d5ff",
    sidebar: "#2e1065",
    "sidebar-primary": "#fb923c",
    "sidebar-accent": "#4c1d95",
    "sidebar-accent-foreground": "#ede9fe",
    "chart-1": "#fb923c",
    "chart-2": "#a855f7",
    "chart-3": "#facc15",
    "chart-4": "#f472b6",
    "chart-5": "#34d399",
  }),
  preset("preset-diwali-glow", "Diwali Glow", "dark", {
    primary: "#f59e0b",
    "primary-foreground": "#451a03",
    ring: "#fbbf24",
    secondary: "#7c2d12",
    "secondary-foreground": "#ffedd5",
    accent: "#713f12",
    "accent-foreground": "#fde68a",
    sidebar: "#2e1065",
    "sidebar-primary": "#f59e0b",
    "sidebar-accent": "#7c2d12",
    "sidebar-accent-foreground": "#ffedd5",
    "chart-1": "#f59e0b",
    "chart-2": "#f43f5e",
    "chart-3": "#a855f7",
    "chart-4": "#22d3ee",
    "chart-5": "#a3e635",
  }),
  preset("preset-valentines-blush", "Valentines Blush", "light", {
    primary: "#e11d48",
    "primary-foreground": "#fff1f2",
    ring: "#fb7185",
    secondary: "#ffe4e6",
    "secondary-foreground": "#9f1239",
    accent: "#ffe4e6",
    "accent-foreground": "#9f1239",
    sidebar: "#fff1f2",
    "sidebar-primary": "#e11d48",
    "sidebar-accent": "#ffe4e6",
    "sidebar-accent-foreground": "#9f1239",
    "chart-1": "#e11d48",
    "chart-2": "#fb7185",
    "chart-3": "#f472b6",
    "chart-4": "#a78bfa",
    "chart-5": "#fbbf24",
  }),
  preset("preset-easter-bloom", "Easter Bloom", "light", {
    primary: "#8b5cf6",
    "primary-foreground": "#f5f3ff",
    ring: "#a78bfa",
    accent: "#d1fae5",
    "accent-foreground": "#065f46",
    sidebar: "#f5f3ff",
    "sidebar-primary": "#8b5cf6",
    "sidebar-accent": "#d1fae5",
    "sidebar-accent-foreground": "#065f46",
    "chart-1": "#8b5cf6",
    "chart-2": "#34d399",
    "chart-3": "#f472b6",
    "chart-4": "#fbbf24",
    "chart-5": "#38bdf8",
  }),

  // ---- Cool presets ---------------------------------------------------------
  preset("preset-northern-lights", "Northern Lights", "dark", {
    background: "#04111a",
    card: "#071a26",
    popover: "#082230",
    primary: "#2dd4bf",
    "primary-foreground": "#042f2e",
    ring: "#5eead4",
    secondary: "#134e4a",
    "secondary-foreground": "#ccfbf1",
    accent: "#115e59",
    "accent-foreground": "#99f6e4",
    sidebar: "#04111a",
    "sidebar-primary": "#2dd4bf",
    "sidebar-accent": "#134e4a",
    "sidebar-accent-foreground": "#ccfbf1",
    "chart-1": "#2dd4bf",
    "chart-2": "#a3e635",
    "chart-3": "#818cf8",
    "chart-4": "#f472b6",
    "chart-5": "#facc15",
  }),
  preset("preset-cyber-neon", "Cyber Neon", "dark", {
    primary: "#22d3ee",
    "primary-foreground": "#083344",
    ring: "#67e8f9",
    secondary: "#3b0764",
    "secondary-foreground": "#f0abfc",
    accent: "#86198f",
    "accent-foreground": "#f5d0fe",
    sidebar: "#120226",
    "sidebar-primary": "#22d3ee",
    "sidebar-accent": "#3b0764",
    "sidebar-accent-foreground": "#f0abfc",
    "chart-1": "#22d3ee",
    "chart-2": "#f0abfc",
    "chart-3": "#a3e635",
    "chart-4": "#facc15",
    "chart-5": "#fb7185",
  }),
];

/**
 * Which theme id is live right now for the CLUB (ignores personal choice):
 *   scheduled window → schedule.themeId, else activeId, else defaultId.
 */
export function effectiveThemeId(
  state: ThemeState | null | undefined,
  now = Date.now(),
): string | null {
  if (!state) return null;
  const s = state.schedule;
  if (s && now >= s.from && now < s.to && s.themeId) return s.themeId;
  if (state.activeId) return state.activeId;
  return state.defaultId ?? null;
}

/** True when a scheduled club theme is live right now (forced for ALL users,
 *  even those with their own custom theme). */
export function isScheduledThemeLive(
  state: ThemeState | null | undefined,
  now = Date.now(),
): boolean {
  const s = state?.schedule;
  return Boolean(s && now >= s.from && now < s.to && s.themeId);
}

/** True when `id` names a resolvable theme (built-in preset or stored theme). */
export function themeExistsInState(
  state: ThemeState | null | undefined,
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  return Boolean(
    BUILTIN_THEMES.some((t) => t.id === id) || state?.themes.some((t) => t.id === id),
  );
}

/**
 * Which theme id is live for ONE member:
 *   scheduled club theme (forced) → the member's own custom theme → activeId
 *   → defaultId.
 */
export function effectiveThemeIdForUser(
  state: ThemeState | null | undefined,
  userThemeId: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!state) return null;
  const s = state.schedule;
  if (s && now >= s.from && now < s.to && s.themeId) return s.themeId;
  if (userThemeId && themeExistsInState(state, userThemeId)) return userThemeId;
  if (state.activeId) return state.activeId;
  return state.defaultId ?? null;
}

/**
 * The member's own theme choice, cached + honored everywhere a theme is
 * resolved (boot, subscription pushes, schedule timer, preview rollback).
 * `null` = follow the club's published theme.
 */
const PREF_KEY = "rc.appTheme.myTheme";
let preferredUserThemeId: string | null = null;
try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREF_KEY) : null;
  if (raw) preferredUserThemeId = raw;
} catch {
  /* storage unavailable */
}

/** Set (or clear) the member's custom theme, repainting immediately. */
export function setUserThemePreference(id: string | null): void {
  preferredUserThemeId = id;
  try {
    if (id) localStorage.setItem(PREF_KEY, id);
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage unavailable */
  }
  if (lastState && previewDepth === 0) applyThemeToDom(resolveTheme(lastState));
}

export function getUserThemePreference(): string | null {
  return preferredUserThemeId;
}

/**
 * Resolve the live theme (built-in preset or stored custom theme) → theme,
 * honoring this member's own preference when they set one.
 */
export function resolveTheme(state: ThemeState | null | undefined): AppTheme | null {
  const id = effectiveThemeIdForUser(state, preferredUserThemeId);
  if (!id || !state) return null;
  return (
    BUILTIN_THEMES.find((t) => t.id === id) ??
    state.themes.find((t) => t.id === id) ??
    null
  );
}

// ---------------------------------------------------------------------------
// DOM application
// ---------------------------------------------------------------------------

/** Full CSS var names currently set inline on <html> (incl. `--radius`). */
const appliedVars = new Set<string>();
let appliedThemeId: string | null = null;
/** The member's own dark/light/system choice — restored when the published
 *  theme is switched off. Kept in sync by use-appearance. */
let lastUserMode: "dark" | "light" | "system" = "dark";

function resolveDark(mode: "dark" | "light" | "system"): boolean {
  if (mode === "system") {
    return typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true;
  }
  return mode === "dark";
}

function applyModeClass(mode: "dark" | "light" | "system") {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  // The dark class must live ONLY on <html>: a legacy `.dark` on <body>
  // re-declares the token variables on the body element and shadows the
  // theme's inline vars inherited from <html> — the whole app then ignores
  // the published theme. Scrub it defensively wherever we manage the mode.
  document.body?.classList.remove("dark");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Called by use-appearance so a later theme-off knows what to restore. */
export function setThemeAwareUserMode(mode: "dark" | "light" | "system") {
  lastUserMode = mode;
}

// ---- Member mode override while a theme is live ---------------------------
// The published theme keeps owning the COLORS (inline vars), but the member
// keeps their own dark/light switch: once they explicitly change mode, that
// choice is remembered here (localStorage) and wins over the theme's own
// base mode on every theme re-apply. Members who never touch the mode still
// get exactly the theme's mode, as before.

const MODE_OVERRIDE_KEY = "rc.appTheme.modeOverride";
let modeOverride: "dark" | "light" | "system" | null = null;
try {
  const raw =
    typeof localStorage !== "undefined" ? localStorage.getItem(MODE_OVERRIDE_KEY) : null;
  if (raw === "dark" || raw === "light" || raw === "system") modeOverride = raw;
} catch {
  /* storage unavailable */
}

/** Persist + apply the member's explicit mode choice (called on switch). */
export function setThemeModeOverride(mode: "dark" | "light" | "system"): void {
  modeOverride = mode;
  try {
    localStorage.setItem(MODE_OVERRIDE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

/** The member's explicit choice, if any (else the theme's base mode). */
export function getThemeModeOverride(): "dark" | "light" | "system" | null {
  return modeOverride;
}

/** True while a published (or previewed) theme owns the colors + mode. */
export function isThemeActive(): boolean {
  return appliedThemeId !== null;
}

/** Write (or clear) a theme's tokens on <html>. */
export function applyThemeToDom(theme: AppTheme | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  for (const name of [...appliedVars]) {
    if (theme && name in theme.colors) continue;
    root.style.removeProperty(name);
    appliedVars.delete(name);
  }

  if (!theme) {
    appliedThemeId = null;
    setThemeIconOverrides(null);
    applyModeClass(lastUserMode);
    return;
  }

  // Per-theme icon choices (nav + category slots) repaint alongside colors.
  setThemeIconOverrides(theme.icons ?? null);

  for (const [key, value] of Object.entries(theme.colors)) {
    if (!TOKEN_KEYS.includes(key as ThemeTokenKey)) continue;
    if (!parseHex(value)) continue;
    const name = `--${key}`;
    root.style.setProperty(name, value);
    appliedVars.add(name);
  }
  // Never let a missing/invalid radius paint `0rem` (sharp corners): a
  // legacy cached theme without the field used to silently zero the radius
  // while every color looked fine — "the radius doesn't stick".
  const parsedRadius = Number(theme.radius);
  const radius = Number.isFinite(parsedRadius)
    ? clamp(parsedRadius, 0, 4)
    : DEFAULT_RADIUS;
  root.style.setProperty("--radius", `${radius}rem`);
  appliedVars.add("--radius");

  appliedThemeId = theme.id;
  // The theme repaints the tokens, but the member's own dark/light switch
  // keeps working while it is live (see setThemeModeOverride above).
  applyModeClass(modeOverride ?? theme.mode);
}

// ---------------------------------------------------------------------------
// Server-state application + cache
// ---------------------------------------------------------------------------

const CACHE_KEY = "rc.appTheme.v1";

let lastState: ThemeState | null = null;
let previewDepth = 0;

// ---- Schedule timer ---------------------------------------------------------
// The Convex state tells us the window; each client flips itself at the
// boundary (start AND end) without waiting for a server round-trip.

let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_TIMEOUT = 0x7fffffff; // setTimeout delay is a 32-bit signed int

function clearScheduleTimer(): void {
  if (scheduleTimer !== null) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
}

function armScheduleTimer(state: ThemeState): void {
  clearScheduleTimer();
  const s = state.schedule;
  if (!s) return;
  const now = Date.now();
  const boundary = now < s.from ? s.from : now < s.to ? s.to : null;
  if (boundary === null) return;
  const delay = Math.min(MAX_TIMEOUT, Math.max(50, boundary - now + 250));
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    if (previewDepth > 0) return; // endThemePreview re-resolves anyway
    if (lastState) {
      applyThemeToDom(resolveTheme(lastState));
      armScheduleTimer(lastState);
    }
  }, delay);
}

export function loadThemeCache(): ThemeState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThemeState>;
    if (!Array.isArray(parsed.themes)) return null;
    const schedule =
      parsed.schedule &&
      typeof parsed.schedule.themeId === "string" &&
      Number.isFinite(parsed.schedule.from) &&
      Number.isFinite(parsed.schedule.to)
        ? {
            themeId: parsed.schedule.themeId,
            from: parsed.schedule.from,
            to: parsed.schedule.to,
          }
        : null;
    return {
      themes: parsed.themes
        .filter(
          (t): t is AppTheme =>
            Boolean(t) &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            (t.mode === "dark" || t.mode === "light") &&
            typeof t.colors === "object" &&
            t.colors !== null,
        )
        // Normalize on load: an old cache row without a usable radius would
        // otherwise paint `0rem` until the next server sync.
        .map((t) => ({
          ...t,
          radius: Number.isFinite(Number(t.radius)) ? Number(t.radius) : DEFAULT_RADIUS,
        })),
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      defaultId: typeof parsed.defaultId === "string" ? parsed.defaultId : null,
      schedule,
    };
  } catch {
    return null;
  }
}

export function saveThemeCache(state: ThemeState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the subscription still keeps the theme live */
  }
}

/** Boot-time: apply the last published theme synchronously (no flash). */
export function initThemeFromCache(): void {
  const cached = loadThemeCache();
  if (!cached) return;
  lastState = cached;
  const theme = resolveTheme(cached);
  if (theme) applyThemeToDom(theme);
  armScheduleTimer(cached);
}

/**
 * Apply the state pushed by the Convex subscription: remembers it as the
 * source of truth, refreshes the cache and — unless the editor is
 * previewing a draft — paints it on the document.
 */
export function applyThemeState(state: ThemeState): void {
  lastState = state;
  saveThemeCache(state);
  armScheduleTimer(state);
  if (previewDepth > 0) return;
  applyThemeToDom(resolveTheme(state));
}

export function getThemeState(): ThemeState | null {
  return lastState;
}

// ---------------------------------------------------------------------------
// Editor preview protocol
// ---------------------------------------------------------------------------

export function beginThemePreview(theme: AppTheme): void {
  previewDepth += 1;
  applyThemeToDom(theme);
}

export function updateThemePreview(theme: AppTheme): void {
  if (previewDepth > 0) applyThemeToDom(theme);
}

export function endThemePreview(): void {
  previewDepth = Math.max(0, previewDepth - 1);
  if (previewDepth === 0) applyThemeToDom(resolveTheme(lastState));
}

// ---------------------------------------------------------------------------
// Helpers for the editor UI
// ---------------------------------------------------------------------------

/** Build a fresh custom theme, seeded from an optional base. */
export function createThemeFrom(base?: AppTheme | null, name = "New theme"): AppTheme {
  const mode: ThemeMode = base?.mode ?? "dark";
  return {
    id: `theme_draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    mode,
    radius: base?.radius ?? DEFAULT_RADIUS,
    colors: base ? { ...base.colors } : defaultColors(mode),
    icons: base?.icons ? { ...base.icons } : undefined,
  };
}

/** One-line description of a theme's palette for previews/tooltips. */
export function swatchColors(theme: AppTheme): string[] {
  const c = theme.colors;
  return [
    c.primary,
    c.accent,
    c["chart-1"],
    c["chart-2"],
    c["chart-3"],
    c.destructive,
  ].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i);
}

/** Ensure a hex color carries an alpha channel of exactly `a`. */
export function withAlpha(hex: string, a: number): string {
  const rgba = parseHex(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return rgbaToHex({ ...rgba, a });
}
