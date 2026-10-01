import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachOfflineGuard,
  guardWrite,
  isOffline,
  OFFLINE_WRITE_MESSAGE,
  setBackendConnected,
} from "./offline";

describe("offline guard", () => {
  beforeEach(() => {
    setBackendConnected(true);
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is online by default", () => {
    expect(isOffline()).toBe(false);
  });

  it("reports offline when the browser has no network", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOffline()).toBe(true);
  });

  it("reports offline when the Convex backend is disconnected", () => {
    setBackendConnected(false);
    expect(isOffline()).toBe(true);
    setBackendConnected(true);
    expect(isOffline()).toBe(false);
  });

  it("guardWrite passes calls and results through while online", async () => {
    const fn = vi.fn(async (a: number, b: number) => a + b);
    const guarded = guardWrite(fn);
    await expect(guarded(2, 3)).resolves.toBe(5);
    expect(fn).toHaveBeenCalledWith(2, 3);
  });

  it("guardWrite rejects without calling the write while offline", async () => {
    const fn = vi.fn(async () => "should not run");
    const guarded = guardWrite(fn);
    vi.stubGlobal("navigator", { onLine: false });
    await expect(guarded()).rejects.toThrow(OFFLINE_WRITE_MESSAGE);
    expect(fn).not.toHaveBeenCalled();
  });

  it("attachOfflineGuard wraps mutation and action on the client", async () => {
    const mutation = vi.fn(async (...args: unknown[]) => ({ ok: true, args }));
    const action = vi.fn(async (...args: unknown[]) => ({ ok: true, args }));
    const client = { mutation, action };
    attachOfflineGuard(client);

    // Online: writes flow through with the original arguments.
    await expect(client.mutation("api", { a: 1 })).resolves.toEqual({
      ok: true,
      args: ["api", { a: 1 }],
    });

    // Offline: both writes are refused without touching the backend.
    vi.stubGlobal("navigator", { onLine: false });
    await expect(client.mutation("api", { a: 1 })).rejects.toThrow(OFFLINE_WRITE_MESSAGE);
    await expect(client.action("api", {})).rejects.toThrow(OFFLINE_WRITE_MESSAGE);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });
});
