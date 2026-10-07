import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for the write-driven sync invalidation module. BroadcastChannel /
 * localStorage are stubbed; listeners are pure function sets.
 */

import {
  installWriteSyncReceiver,
  markAnyWrite,
  markWritten,
  resetWriteSyncForTests,
  writeSyncListen,
} from "./write-sync";

describe("write-sync", () => {
  beforeEach(() => {
    resetWriteSyncForTests();
    localStorage.clear();
  });

  it("notifies listeners of the same table on markWritten", () => {
    const fn = vi.fn();
    writeSyncListen("parts", fn);
    markWritten("parts");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not notify listeners of other tables", () => {
    const parts = vi.fn();
    const rentals = vi.fn();
    writeSyncListen("parts", parts);
    writeSyncListen("rentals", rentals);
    markWritten("parts");
    expect(parts).toHaveBeenCalledTimes(1);
    expect(rentals).not.toHaveBeenCalled();
  });

  it("ignores unknown tables (defense against typos / future tables)", () => {
    const fn = vi.fn();
    writeSyncListen("parts", fn);
    markWritten("not_a_table");
    expect(fn).not.toHaveBeenCalled();
  });

  it("unsubscribes cleanly", () => {
    const fn = vi.fn();
    const off = writeSyncListen("parts", fn);
    off();
    markWritten("parts");
    expect(fn).not.toHaveBeenCalled();
  });

  it("a broken listener never breaks the others", () => {
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    const after = vi.fn();
    writeSyncListen("rentals", boom);
    writeSyncListen("rentals", after);
    expect(() => markWritten("rentals")).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("falls back to localStorage for sibling tabs", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    markWritten("rentals");
    expect(setItem).toHaveBeenCalled();
    const raw = localStorage.getItem("roboshelf.syncWrite");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).table).toBe("rentals");
    setItem.mockRestore();
  });

  it("storage events from other tabs notify local listeners", () => {
    const fn = vi.fn();
    writeSyncListen("groups", fn);
    installWriteSyncReceiver();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "roboshelf.syncWrite",
        newValue: JSON.stringify({ table: "groups", at: Date.now() }),
      }),
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("markAnyWrite wakes every table listener (un-attributable write)", () => {
    const parts = vi.fn();
    const rentals = vi.fn();
    writeSyncListen("parts", parts);
    writeSyncListen("rentals", rentals);
    markAnyWrite();
    expect(parts).toHaveBeenCalledTimes(1);
    expect(rentals).toHaveBeenCalledTimes(1);
  });

  it("a wildcard storage event from a sibling tab wakes every listener", () => {
    const parts = vi.fn();
    const rentals = vi.fn();
    writeSyncListen("parts", parts);
    writeSyncListen("rentals", rentals);
    installWriteSyncReceiver();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "roboshelf.syncWrite",
        newValue: JSON.stringify({ table: "*", at: Date.now() }),
      }),
    );
    expect(parts).toHaveBeenCalledTimes(1);
    expect(rentals).toHaveBeenCalledTimes(1);
  });

  it("malformed storage payloads are ignored", () => {
    const fn = vi.fn();
    writeSyncListen("groups", fn);
    installWriteSyncReceiver();
    expect(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: "roboshelf.syncWrite", newValue: "{not json" }),
      ),
    ).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});
