// QR payload helpers — every entity in the club gets its own scannable code.
// Payloads:  inv:<group name>   unit:<PART TAG>   cat:<category name>   closet:<closet id>   proj:<project id>

export type QrTarget =
  | { kind: "group"; name: string }
  | { kind: "unit"; tag: string }
  | { kind: "category"; name: string }
  | { kind: "closet"; id: string }
  | { kind: "project"; id: string };

export function groupQr(name: string) {
  return `inv:${name}`;
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
