// QR payload helpers — every entity in the club gets its own scannable code.
// Payloads:  g:<group id>   unit:<PART TAG>   cat:<category name>   closet:<closet id>
//            proj:<project id>   person:<userId>
// Legacy printed labels may still carry  inv:<group name>  — the backend lookup
// still resolves those (storages win name collisions, e.g. a group literally
// named "Closet 1" opens the storage).

export type QrTarget =
  | { kind: "group"; id: string }
  | { kind: "unit"; tag: string }
  | { kind: "category"; name: string }
  | { kind: "closet"; id: string }
  | { kind: "project"; id: string }
  | { kind: "person"; id: string };

/** Person QR: `person:<userId>` — scanning opens the member's profile card. */
export function personQr(id: string) {
  return `person:${id}`;
}

/**
 * Group QR: `g:<group id>` — unique per group even when two groups share the
 * same name ("Arduino Uno" in two storages must scan to different cards).
 * The old name-based `inv:<name>` payloads stay resolvable via the backend.
 */
export function groupQr(id: string) {
  return `g:${id}`;
}
export function unitQr(tag: string) {
  return `unit:${tag}`;
}
export function categoryQr(name: string) {
  return `cat:${name}`;
}
export function closetQr(id: string) {
  return `closet:${id}`;
}
export function projectQr(id: string) {
  return `proj:${id}`;
}

/** Absolute URL for printed QR labels so any phone camera can open the app. */
export function qrUrl(payload: string) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/qr?p=${encodeURIComponent(payload)}`;
}

/** A scanned label may contain the absolute app URL (printed labels) or the
 *  raw payload (old labels / manual entry). Normalize both to the payload. */
export function normalizeScan(text: string): string {
  const t = text.trim();
  try {
    const u = new URL(t);
    const p = u.searchParams.get("p");
    if (p) return p;
  } catch {
    // not a URL — treat as raw payload
  }
  return t;
}
