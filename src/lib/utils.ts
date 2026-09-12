import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl; // canvas unavailable — fall back to original
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Step quality down until the data URL fits the server-side cap (60 KB), so
  // noisy photos can never bloat user docs and crash list queries again.
  let quality = 0.85;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > 60_000 && quality > 0.3) {
    quality -= 0.15;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}
