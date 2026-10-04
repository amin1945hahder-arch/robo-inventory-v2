/**
 * Ids for rows created in Turso.
 *
 * Convex hands out document ids like "k572aprbn86d39rn1v1t9vmsw18ezm3n". Once
 * Turso is the store, WE mint them — so they have to look like Convex ids, or
 * code that treats `_id` as an opaque Convex id (and the `Doc<>` types that
 * pages compile against) would break.
 *
 * Convex ids are lowercase alphanumeric, start with a letter, and are 32
 * characters in the common case. We match that shape. They are NOT
 * Convex-signed: a value minted here is only meaningful to Turso, which is
 * exactly right once the data no longer lives in Convex.
 */

/** Alphabet used by Convex ids: lowercase letters + digits, no ambiguous 0/o. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomChars(length: number): string {
  const out: string[] = [];
  const cryptoObj = globalThis.crypto;
  for (let i = 0; i < length; i++) {
    if (cryptoObj?.getRandomValues) {
      const buf = new Uint8Array(1);
      cryptoObj.getRandomValues(buf);
      out.push(ALPHABET[buf[0] % ALPHABET.length]);
    } else {
      out.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
    }
  }
  return out.join("");
}

/** A new, Convex-shaped document id. */
export function newTursoId(): string {
  // Leading letter: Convex ids never start with a digit, and some code sorts
  // or renders them directly.
  return `k${randomChars(31)}`;
}

export function isConvexShapedId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9]{31}$/.test(value)
  );
}