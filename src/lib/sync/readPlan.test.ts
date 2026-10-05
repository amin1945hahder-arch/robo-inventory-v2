import { describe, expect, it, vi } from "vitest";
import type { ChangeHead } from "@/lib/turso-data";
import {
  DEFAULT_SAFETY_MAX_AGE_MS,
  createFetchGate,
  planRead,
} from "./readPlan";
import { getHeads, setHeads, subscribeHeads } from "./heads";

const head = (table: string, seq: number, at = 1000): ChangeHead => ({ table, at, seq });
const NOW = 5_000_000;

describe("planRead", () => {
  it("misses when there is no entry", () => {
    const d = planRead({ entry: undefined, headsAtFetch: undefined, headsNow: {}, now: NOW, online: true });
    expect(d).toMatchObject({ showCached: false, fetch: true, reason: "miss" });
  });

  it("misses offline with no entry (nothing to show, nothing to fetch)", () => {
    const d = planRead({ entry: undefined, headsAtFetch: undefined, headsNow: {}, now: NOW, online: false });
    expect(d).toMatchObject({ showCached: false, fetch: false, reason: "miss" });
  });

  it("serves an offline cache without fetching", () => {
    const d = planRead({
      entry: { value: [1], storedAt: NOW - 1 },
      headsAtFetch: { parts: head("parts", 1) },
      headsNow: { parts: head("parts", 9) }, // moved, but offline
      now: NOW,
      online: false,
    });
    expect(d).toMatchObject({ showCached: true, fetch: false, reason: "offline" });
  });

  it("ZERO reads when the heads have not moved (stale-while-idle)", () => {
    const heads = { parts: head("parts", 3), groups: head("groups", 1) };
    const d = planRead({
      entry: { value: [1], storedAt: NOW - 1000 },
      headsAtFetch: heads,
      headsNow: { ...heads },
      now: NOW,
      online: true,
    });
    expect(d).toMatchObject({ showCached: true, fetch: false, reason: "heads-unchanged", tablesMoved: [] });
  });

  it("refetches AND shows cache when a head moved (stale-while-revalidate)", () => {
    const d = planRead({
      entry: { value: [1], storedAt: NOW - 10 },
      headsAtFetch: { parts: head("parts", 3) },
      headsNow: { parts: head("parts", 4) },
      now: NOW,
      online: true,
    });
    expect(d).toMatchObject({ showCached: true, fetch: true, reason: "head-moved", tablesMoved: ["parts"] });
  });

  it("refetches on the first run (no recorded heads yet)", () => {
    const d = planRead({
      entry: { value: [1], storedAt: NOW - 10 },
      headsAtFetch: undefined,
      headsNow: { parts: head("parts", 1) },
      now: NOW,
      online: true,
    });
    expect(d).toMatchObject({ fetch: true, reason: "head-moved" });
  });

  it("refetches an entry older than the safety net even with unchanged heads", () => {
    const heads = { parts: head("parts", 1) };
    const d = planRead({
      entry: { value: [1], storedAt: NOW - (DEFAULT_SAFETY_MAX_AGE_MS + 1) },
      headsAtFetch: heads,
      headsNow: { ...heads },
      now: NOW,
      online: true,
    });
    expect(d).toMatchObject({ showCached: true, fetch: true, reason: "aged-out" });
  });

  it("honours a custom safety net", () => {
    const heads = { parts: head("parts", 1) };
    const d = planRead({
      entry: { value: [1], storedAt: NOW - 5000 },
      headsAtFetch: heads,
      headsNow: { ...heads },
      now: NOW,
      online: true,
      maxAgeMs: 1000,
    });
    expect(d.reason).toBe("aged-out");
  });

  it("treats a brand-new table appearing as a move", () => {
    const d = planRead({
      entry: { value: [1], storedAt: NOW - 1 },
      headsAtFetch: { parts: head("parts", 1) },
      headsNow: { parts: head("parts", 1), rentals: head("rentals", 0) },
      now: NOW,
      online: true,
    });
    expect(d).toMatchObject({ fetch: true, tablesMoved: ["rentals"] });
  });
});

describe("heads store", () => {
  it("publishes snapshots to readers and subscribers", () => {
    const seen: unknown[] = [];
    const unsub = subscribeHeads((h) => seen.push(h));
    setHeads({ parts: head("parts", 2) });
    expect(getHeads().parts.seq).toBe(2);
    expect(seen).toHaveLength(1);
    unsub();
    setHeads({ parts: head("parts", 3) });
    expect(seen).toHaveLength(1); // unsubscribed
    setHeads({});
  });

  it("a throwing subscriber never breaks the publisher", () => {
    const unsub = subscribeHeads(() => {
      throw new Error("boom");
    });
    expect(() => setHeads({ parts: head("parts", 0) })).not.toThrow();
    unsub();
    setHeads({});
  });
});

describe("createFetchGate", () => {
  it("collapses concurrent runs of one key into a single call", async () => {
    const gate = createFetchGate();
    const fn = vi.fn(async () => {
      await Promise.resolve();
      return "ok";
    });
    const [a, b, c] = await Promise.all([
      gate.run("k", fn),
      gate.run("k", fn),
      gate.run("k", fn),
    ]);
    expect([a, b, c]).toEqual(["ok", "ok", "ok"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not share work across different keys", async () => {
    const gate = createFetchGate();
    const fn = vi.fn(async () => "x");
    await Promise.all([gate.run("a", fn), gate.run("b", fn)]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("allows a fresh run after the previous one settles", async () => {
    const gate = createFetchGate();
    const fn = vi.fn(async () => "y");
    await gate.run("k", fn);
    expect(gate.inFlight("k")).toBe(false);
    await gate.run("k", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight slot even when the fetch rejects", async () => {
    const gate = createFetchGate();
    await expect(gate.run("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(gate.inFlight("k")).toBe(false);
  });
});
