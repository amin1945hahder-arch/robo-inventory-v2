import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CSSProperties } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Age in whole years from an ISO date string ("2001-05-14"); null if absent/invalid. */
export function ageFromIso(iso?: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/** "21 yrs" chip text, or "—" when no date of birth is known. */
export function ageLabel(iso?: string | null): string {
  const age = ageFromIso(iso);
  return age === null ? "—" : `${age} yrs`;
}

/**
 * Downscale an image file to a small JPEG data URL (max 256px, ~85% quality).
 * Profile pictures are stored directly on user documents; a raw 1.5 MB file
 * would make every query that joins that user document heavy (queries that
 * join the same user across many rental rows can exceed Convex's per-
 * execution read limit). Compressing client-side keeps avatars to ~10-30 KB.
 */
export async function compressImageFile(file: File, maxSize = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load the image"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const makeCanvas = (s: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    return c;
  };
  const canvas = makeCanvas(scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl; // canvas unavailable — fall back to original
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Transparency check — PNGs (logos, icons) keep their alpha; encoding them
  // as JPEG would fill every transparent pixel with BLACK, which looked like
  // a broken background on the cards.
  let hasAlpha = false;
  try {
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
  } catch {
    hasAlpha = false;
  }

  if (hasAlpha) {
    // Keep the PNG and shrink until it fits the 60 KB document cap.
    let s = scale;
    let out = canvas.toDataURL("image/png");
    while (out.length > 60_000 && s > 0.2) {
      s = Math.max(0.2, s * 0.8);
      const c = makeCanvas(s);
      const cc = c.getContext("2d");
      if (!cc) break;
      cc.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL("image/png");
    }
    if (out.length <= 60_000) return out;
    // Still too heavy — fall through and flatten onto white below.
  }

  // JPEG path (photos): composite onto WHITE first so a transparent source
  // can never render as a black box, then step quality down until the data
  // URL fits the server-side cap (60 KB).
  const jcanvas = makeCanvas(scale);
  const jctx = jcanvas.getContext("2d");
  if (!jctx) return dataUrl;
  jctx.fillStyle = "#ffffff";
  jctx.fillRect(0, 0, jcanvas.width, jcanvas.height);
  jctx.drawImage(img, 0, 0, jcanvas.width, jcanvas.height);
  let quality = 0.85;
  let out = jcanvas.toDataURL("image/jpeg", quality);
  while (out.length > 60_000 && quality > 0.3) {
    quality -= 0.15;
    out = jcanvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

/**
 * Colored subtab bars (the Settings-bar treatment).
 *
 * `tabColor` parks the tab's own color in the `--tab` custom property — the
 * `.colored-tabs` rule in index.css fills the ACTIVE `role=tab` trigger with
 * it (dark text on the tint). Use on TabsTrigger children inside a TabsList
 * marked `colored-tabs`.
 *
 * `activeTabStyle` is the direct equivalent for button-based tab bars (the
 * active state is known at render time there), producing the exact same fill.
 */
export function tabColor(color: string): CSSProperties {
  return { "--tab": color } as CSSProperties;
}

export function activeTabStyle(color: string): CSSProperties {
  return { background: color, borderColor: color, color: "#0b1220" };
}
