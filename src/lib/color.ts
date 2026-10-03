/**
 * Color utilities for the app-theme editor.
 *
 * The theme system stores every token as a HEX string (`#rrggbb`, or
 * `#rrggbbaa` when the color has transparency) because that is what the
 * native color picker, the HEX input and the RGB inputs all speak. The
 * original design tokens in src/index.css are oklch(), so we convert those
 * to hex once at runtime with the math below — no DOM/canvas tricks, works
 * the same in the browser, in tests and (for validation) on the server.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Parse a hex color into RGBA. Accepts `#rgb`, `#rgba`, `#rrggbb` and
 * `#rrggbbaa` (with or without the leading `#`). Returns null when invalid.
 */
export function parseHex(input: string): Rgba | null {
  let s = input.trim().replace(/^#/, "");
  if (!HEX_RE.test(s)) return null;
  if (s.length === 3 || s.length === 4) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (s.length !== 6 && s.length !== 8) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

/** True when the string is a usable hex color. */
export function isHex(input: string): boolean {
  return parseHex(input) !== null;
}

/** RGBA → canonical hex (`#rrggbb`, or `#rrggbbaa` when alpha < 1). */
export function rgbaToHex({ r, g, b, a }: Rgba): string {
  const h = (n: number) =>
    clamp(Math.round(n), 0, 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${h(r)}${h(g)}${h(b)}`;
  if (a >= 1) return base;
  if (a <= 0) return `${base}00`;
  return base + h(a * 255);
}

/** RGB(A) numbers → hex, clamping each channel into range. */
export function rgbToHex(r: number, g: number, b: number, a = 1): string {
  return rgbaToHex({ r, g, b, a });
}

// ---------------------------------------------------------------------------
// oklch → sRGB
// ---------------------------------------------------------------------------

/** Linear-light RGB channels for an oklch color (Björn Ottosson's matrices). */
function oklchToLinearRgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const gamma = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** oklch(L C H) → hex (`#rrggbb` / `#rrggbbaa`). */
export function oklchToHex(L: number, C: number, Hdeg: number, alpha = 1): string {
  const [rl, gl, bl] = oklchToLinearRgb(L, C, Hdeg);
  return rgbaToHex({
    r: gamma(rl) * 255,
    g: gamma(gl) * 255,
    b: gamma(bl) * 255,
    a: alpha,
  });
}

// ---------------------------------------------------------------------------
// Any CSS color we ship → hex
// ---------------------------------------------------------------------------

/**
 * Convert a CSS color used by the design tokens to canonical hex.
 * Supports hex (`#abc`, `#aabbcc`, `#aabbccdd`) and
 * `oklch(L C H)` / `oklch(L C H / A)` / `oklch(L C H / A%)`.
 * Returns null for anything we don't understand.
 */
export function cssToHex(css: string): string | null {
  const s = css.trim();
  if (s.startsWith("#")) {
    const rgba = parseHex(s);
    return rgba ? rgbaToHex(rgba) : null;
  }
  const m = s.match(
    /^oklch\(\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?(?:\s+(-?[\d.]+))?(?:\s*\/\s*([\d.]+)(%?)\s*)?\)$/i,
  );
  if (m) {
    const L = Number(m[1]);
    const C = m[2] === undefined ? 0 : Number(m[2]);
    const H = m[3] === undefined ? 0 : Number(m[3]);
    let alpha = 1;
    if (m[4] !== undefined) {
      alpha = Number(m[4]) / (m[5] === "%" ? 100 : 1);
    }
    if (![L, C, H, alpha].every(Number.isFinite)) return null;
    return oklchToHex(L, C, H, clamp(alpha, 0, 1));
  }
  // rgb()/rgba() — handy if someone pastes one in.
  const rgb = s.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (rgb) {
    return rgbaToHex({
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    });
  }
  return null;
}

/**
 * Read the RGB channels of a hex color (alpha ignored) — used by the RGB
 * inputs of the editor.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const rgba = parseHex(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}

/** Alpha 0–1 of a hex color (1 when opaque). */
export function hexAlpha(hex: string): number {
  return parseHex(hex)?.a ?? 1;
}
