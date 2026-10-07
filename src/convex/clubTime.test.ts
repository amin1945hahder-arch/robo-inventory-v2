import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_CLUB_TIMEZONE,
  formatInZone,
  isValidTimeZone,
  resolveClubTimeZone,
} from "./clubTime";

describe("clubTime", () => {
  const savedEnv = process.env.CLUB_TIMEZONE;
  beforeEach(() => {
    delete process.env.CLUB_TIMEZONE;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CLUB_TIMEZONE;
    else process.env.CLUB_TIMEZONE = savedEnv;
  });

  it("recognizes real IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Asia/Baghdad")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("formats in the club zone, not the server (UTC) zone", () => {
    // 2026-01-15T21:30:00Z is 00:30 on the 16th in Baghdad (UTC+3).
    const ts = Date.UTC(2026, 0, 15, 21, 30);
    const baghdad = formatInZone(ts, "Asia/Baghdad");
    const utc = formatInZone(ts, "UTC");
    expect(baghdad).toContain("00:30");
    expect(utc).toContain("21:30");
    expect(baghdad).not.toBe(utc);
  });

  it("respects the given zone for a real offset (12:30 stays 12:30)", () => {
    // The reported case: an admin intends 12:30 local. Stored as UTC it is
    // 09:30Z; formatted back in the club zone it must read 12:30.
    const ts = Date.UTC(2026, 5, 1, 9, 30);
    expect(formatInZone(ts, "Asia/Baghdad")).toContain("12:30");
  });

  it("falls back to the default zone for an invalid zone name", () => {
    const ts = Date.UTC(2026, 0, 15, 21, 30);
    expect(formatInZone(ts, "Bogus/Zone")).toBe(
      formatInZone(ts, DEFAULT_CLUB_TIMEZONE),
    );
  });

  it("resolves setting → env → default in order", () => {
    process.env.CLUB_TIMEZONE = "Europe/Berlin";
    expect(resolveClubTimeZone()).toBe("Europe/Berlin");
    // An explicit (valid) setting wins over the env var.
    expect(resolveClubTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    // An invalid setting is ignored in favour of the env var.
    expect(resolveClubTimeZone("Bogus/Zone")).toBe("Europe/Berlin");
    delete process.env.CLUB_TIMEZONE;
    expect(resolveClubTimeZone()).toBe(DEFAULT_CLUB_TIMEZONE);
  });
});
