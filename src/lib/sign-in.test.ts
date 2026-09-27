import { describe, expect, it, vi } from "vitest";
import {
  isAuthRejectionError,
  isTransientConnectionError,
  signInWithRetry,
} from "./sign-in";

const CONVEX_DROP = new Error(
  "[CONVEX A(auth:signIn)] Connection lost while action was in flight Called by client",
);

function formDataOf(obj: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.append(k, v);
  return fd;
}

describe("isTransientConnectionError", () => {
  it("matches the Convex connection-lost error", () => {
    expect(isTransientConnectionError(CONVEX_DROP)).toBe(true);
  });

  it("matches other transport failures", () => {
    expect(isTransientConnectionError(new Error("Failed to fetch"))).toBe(true);
    expect(isTransientConnectionError(new Error("WebSocket closed"))).toBe(true);
    expect(isTransientConnectionError(new Error("Request timed out"))).toBe(true);
    expect(isTransientConnectionError("TypeError: network error")).toBe(true);
  });

  it("does not match auth rejections", () => {
    expect(isTransientConnectionError(new Error("Invalid code"))).toBe(false);
    expect(isTransientConnectionError(new Error("Token expired"))).toBe(false);
    expect(isTransientConnectionError(new Error("boom"))).toBe(false);
  });
});

describe("isAuthRejectionError", () => {
  it("matches wrong/expired codes", () => {
    expect(isAuthRejectionError(new Error("Invalid code"))).toBe(true);
    expect(isAuthRejectionError(new Error("Code expired"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isAuthRejectionError(new Error("boom"))).toBe(false);
    expect(isAuthRejectionError(CONVEX_DROP)).toBe(false);
  });
});

describe("signInWithRetry", () => {
  it("returns on first success", async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    await expect(
      signInWithRetry(signIn, "email-otp", { email: "a@b.c" }),
    ).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("retries the convex connection drop and succeeds", async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(CONVEX_DROP)
      .mockResolvedValueOnce(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(
      signInWithRetry(signIn, "device", { token: "t" }, { delayMs: wait }),
    ).resolves.toBeUndefined();
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(1);
  });

  it("passes the SAME params on every attempt", async () => {
    const params = formDataOf({ email: "a@b.c", code: "123456" });
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(CONVEX_DROP)
      .mockResolvedValueOnce(undefined);
    await signInWithRetry(signIn, "email-otp", params, {
      delayMs: async () => {},
    });
    expect(signIn).toHaveBeenNthCalledWith(1, "email-otp", params);
    expect(signIn).toHaveBeenNthCalledWith(2, "email-otp", params);
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget", async () => {
    const signIn = vi.fn().mockRejectedValue(CONVEX_DROP);
    await expect(
      signInWithRetry(signIn, "device", { token: "t" }, { attempts: 2, delayMs: async () => {} }),
    ).rejects.toBe(CONVEX_DROP);
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("rethrows auth rejections immediately without retrying", async () => {
    const signIn = vi.fn().mockRejectedValue(new Error("Invalid code"));
    await expect(
      signInWithRetry(signIn, "email-otp", { email: "a@b.c", code: "000000" }),
    ).rejects.toThrow("Invalid code");
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("rethrows unrelated errors immediately", async () => {
    const signIn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      signInWithRetry(signIn, "email-otp", {}),
    ).rejects.toThrow("boom");
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("works when a real FormData object is passed", async () => {
    const fd = formDataOf({ email: "a@b.c" });
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(CONVEX_DROP)
      .mockResolvedValueOnce(undefined);
    await signInWithRetry(signIn, "email-otp", fd, { delayMs: async () => {} });
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});
