/**
 * Club-timezone date formatting.
 *
 * Convex runs in UTC, so `new Date(ts).toLocaleString()` on the server renders
 * UTC wall-clock time. A member in the club's timezone therefore saw times
 * shifted by their UTC offset (the reported bug: an admin set a 12:30 AM
 * pick-up and the Telegram message said 09:30 AM). Every human-facing time in
 * a notification must be formatted in the CLUB's timezone, not the server's.
 *
 * The zone resolves in this order:
 *   1. the `club_timezone` setting (IANA name, e.g. "Europe/Berlin");
 *   2. the CLUB_TIMEZONE environment variable (quick override, no UI);
 *   3. DEFAULT_CLUB_TIMEZONE.
 *
 * Pure and dependency-free (no `_generated` import) so it is unit-testable and
 * safe to import from any Convex function.
 */

/** Fallback used when neither the setting nor the env var is set. */
export const DEFAULT_CLUB_TIMEZONE = "Asia/Baghdad";

/** Settings-table key holding the club's IANA timezone. */
export const CLUB_TIMEZONE_SETTING_KEY = "club_timezone";

/** True when `tz` is a valid IANA timezone the runtime can format with. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Pick the effective timezone from (in order) setting → env → default. */
export function resolveClubTimeZone(configured?: string | null): string {
  if (configured && isValidTimeZone(configured)) return configured;
  const env =
    typeof process !== "undefined" && process.env
      ? process.env.CLUB_TIMEZONE
      : undefined;
  if (env && isValidTimeZone(env)) return env;
  return DEFAULT_CLUB_TIMEZONE;
}

/**
 * Format a UTC epoch-millis timestamp as a short local date+time in `timeZone`.
 * Example (Asia/Baghdad): 2026-10-07T21:30:00Z → "7 Oct 2026, 00:30".
 */
export function formatInZone(ts: number, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_CLUB_TIMEZONE;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ts));
}

/**
 * Read the admin-configured club timezone from the settings table. Never
 * throws — a missing/corrupt setting simply falls back to the default, so a
 * notification is never lost over formatting.
 */
export async function readClubTimeZone(ctx: any): Promise<string> {
  try {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q: any) => q.eq("key", CLUB_TIMEZONE_SETTING_KEY))
      .unique();
    const value = row?.value ? JSON.parse(row.value) : undefined;
    return resolveClubTimeZone(typeof value === "string" ? value : undefined);
  } catch {
    return resolveClubTimeZone();
  }
}
