/**
 * Per-user font catalog.
 *
 * Each member picks the typeface used across the app; only the font ID is
 * stored on the user row (settings.getMyFont / setMyFont). This module owns
 * the catalog, lazy-loads the webfont files and applies the stack on <html>.
 *
 * Application: the stack is written as an inline `font-family` on <html> AND
 * as an inline `--font-sans` (plus `--font-mono` for mono picks), so both
 * inheriting text and explicit `font-sans` / `font-mono` utilities follow the
 * member's choice. Removing the inline styles restores the app default.
 */

export type FontOption = {
  id: string;
  label: string;
  /** Family name as registered on Google Fonts ("" for the app default). */
  family: string;
  /** Full CSS font-family stack (system fallbacks included). */
  stack: string;
  /** Mono picks also replace the `font-mono` utility stack. */
  mono?: boolean;
  /** Script hint for the picker grid. */
  script?: "Arabic";
};

const UI = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF = "ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace";

const g = (family: string, extra = "") =>
  `"${family}", ${extra}${extra ? ", " : ""}${UI}`;

/** Large, curated list — Latin workhorses, display/serif, mono, Arabic-ready. */
export const FONT_CATALOG: FontOption[] = [
  { id: "", label: "App default", family: "", stack: UI },
  // --- Latin sans ---
  { id: "inter", label: "Inter", family: "Inter", stack: g("Inter") },
  { id: "roboto", label: "Roboto", family: "Roboto", stack: g("Roboto") },
  { id: "open-sans", label: "Open Sans", family: "Open Sans", stack: g("Open Sans") },
  { id: "lato", label: "Lato", family: "Lato", stack: g("Lato") },
  { id: "montserrat", label: "Montserrat", family: "Montserrat", stack: g("Montserrat") },
  { id: "poppins", label: "Poppins", family: "Poppins", stack: g("Poppins") },
  { id: "nunito", label: "Nunito", family: "Nunito", stack: g("Nunito") },
  { id: "source-sans-3", label: "Source Sans 3", family: "Source Sans 3", stack: g("Source Sans 3") },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", family: "IBM Plex Sans", stack: g("IBM Plex Sans") },
  { id: "work-sans", label: "Work Sans", family: "Work Sans", stack: g("Work Sans") },
  { id: "dm-sans", label: "DM Sans", family: "DM Sans", stack: g("DM Sans") },
  { id: "manrope", label: "Manrope", family: "Manrope", stack: g("Manrope") },
  { id: "rubik", label: "Rubik", family: "Rubik", stack: g("Rubik") },
  { id: "outfit", label: "Outfit", family: "Outfit", stack: g("Outfit") },
  { id: "space-grotesk", label: "Space Grotesk", family: "Space Grotesk", stack: g("Space Grotesk") },
  // --- Display / serif ---
  { id: "merriweather", label: "Merriweather", family: "Merriweather", stack: g("Merriweather", SERIF) },
  { id: "playfair-display", label: "Playfair Display", family: "Playfair Display", stack: g("Playfair Display", SERIF) },
  { id: "lora", label: "Lora", family: "Lora", stack: g("Lora", SERIF) },
  { id: "georgia", label: "Georgia", family: "", stack: `Georgia, ${SERIF}` },
  // --- Mono ---
  { id: "jetbrains-mono", label: "JetBrains Mono", family: "JetBrains Mono", stack: `"JetBrains Mono", ${MONO}`, mono: true },
  { id: "fira-code", label: "Fira Code", family: "Fira Code", stack: `"Fira Code", ${MONO}`, mono: true },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", family: "IBM Plex Mono", stack: `"IBM Plex Mono", ${MONO}`, mono: true },
  { id: "source-code-pro", label: "Source Code Pro", family: "Source Code Pro", stack: `"Source Code Pro", ${MONO}`, mono: true },
  // --- Arabic-ready (the club's profiles mix Arabic + Latin) ---
  { id: "cairo", label: "Cairo", family: "Cairo", stack: g("Cairo"), script: "Arabic" },
  { id: "tajawal", label: "Tajawal", family: "Tajawal", stack: g("Tajawal"), script: "Arabic" },
  { id: "almarai", label: "Almarai", family: "Almarai", stack: g("Almarai"), script: "Arabic" },
  { id: "readex-pro", label: "Readex Pro", family: "Readex Pro", stack: g("Readex Pro"), script: "Arabic" },
  { id: "noto-kufi-arabic", label: "Noto Kufi Arabic", family: "Noto Kufi Arabic", stack: g("Noto Kufi Arabic"), script: "Arabic" },
];

export function fontById(id?: string | null): FontOption {
  return FONT_CATALOG.find((f) => f.id === (id ?? "")) ?? FONT_CATALOG[0];
}

/** CSS stack for a font id (used by the picker to render each label in its own face). */
export function stackFor(id?: string | null): string {
  return fontById(id).stack;
}

const loaded = new Set<string>();

/** Lazily inject the Google Fonts stylesheet for a webfont (once per session). */
function ensureLoaded(opt: FontOption) {
  if (!opt.family || loaded.has(opt.id)) return;
  loaded.add(opt.id);
  try {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      opt.family,
    ).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
    document.head.appendChild(link);
  } catch {
    /* offline / head unavailable — the system fallback in the stack shows */
  }
}

/**
 * Apply a font id to the document ("" / null restores the app default).
 * Safe to call repeatedly; the picker calls it optimistically for instant
 * feedback and the use-font hook re-applies whenever the DB value changes.
 */
export function applyFont(id?: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const opt = fontById(id);
  if (!opt.id) {
    root.style.removeProperty("font-family");
    root.style.removeProperty("--font-sans");
    root.style.removeProperty("--font-mono");
    return;
  }
  ensureLoaded(opt);
  root.style.setProperty("font-family", opt.stack);
  root.style.setProperty("--font-sans", opt.stack);
  if (opt.mono) root.style.setProperty("--font-mono", opt.stack);
}
