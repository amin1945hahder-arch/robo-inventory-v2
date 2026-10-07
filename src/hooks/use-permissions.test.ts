import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { detectPermission, storageWorks, usePermission } from "./use-permissions";

/** Replace navigator.storage (StorageManager) for one test. */
function stubStorage(value: unknown) {
  Object.defineProperty(navigator, "storage", {
    value,
    configurable: true,
  });
}

/** Replace navigator.permissions.query with a fixed state (or a thrower). */
function stubPermissionState(state: string) {
  Object.defineProperty(navigator, "permissions", {
    value: { query: async () => ({ state }) },
    configurable: true,
  });
}

function stubPermissionThrow() {
  Object.defineProperty(navigator, "permissions", {
    value: { query: async () => { throw new Error("unknown permission name"); } },
    configurable: true,
  });
}

beforeEach(() => {
  // Drop per-test navigator stubs + any saved answer from a previous test.
  delete (navigator as unknown as Record<string, unknown>).storage;
  delete (navigator as unknown as Record<string, unknown>).permissions;
  window.localStorage.removeItem("rc.permissions.storage");
});

describe("storageWorks", () => {
  it("proves DOM storage actually works in this environment", async () => {
    await expect(storageWorks()).resolves.toBe(true);
  });

  it("reports failure when localStorage is blocked (hardened webviews)", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("Storage is disabled.");
        },
        getItem: () => {
          throw new Error("Storage is disabled.");
        },
        removeItem: () => {
          throw new Error("Storage is disabled.");
        },
      },
    });
    try {
      await expect(storageWorks()).resolves.toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else {
        delete (window as unknown as Record<string, unknown>).localStorage;
      }
    }
  });
});

describe("detectPermission(\"storage\")", () => {
  it("is granted when storage works and no StorageManager exists to pin it", async () => {
    // jsdom (and webview APK shells) have no navigator.storage — the old code
    // reported a stuck \"prompt\" whose Allow button could never change
    // anything. The working truth is: enabled.
    expect(navigator.storage).toBeUndefined();
    await expect(detectPermission("storage")).resolves.toBe("granted");
  });

  it("is granted when the data is already persisted", async () => {
    stubStorage({ persisted: async () => true });
    await expect(detectPermission("storage")).resolves.toBe("granted");
  });

  it("asks (prompt) when persisting is possible but not granted yet", async () => {
    stubStorage({ persisted: async () => false });
    stubPermissionState("prompt");
    await expect(detectPermission("storage")).resolves.toBe("prompt");
  });

  it("is denied only on the browser's hard site-permission block", async () => {
    stubStorage({ persisted: async () => false });
    stubPermissionState("denied");
    await expect(detectPermission("storage")).resolves.toBe("denied");
  });

  it("stays prompt (the one-tap ask) when nothing can report a denial", async () => {
    stubStorage({ persisted: async () => false });
    stubPermissionThrow();
    await expect(detectPermission("storage")).resolves.toBe("prompt");
  });

  it("is unsupported when no data can be stored at all", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("Storage is disabled.");
        },
        getItem: () => {
          throw new Error("Storage is disabled.");
        },
        removeItem: () => {
          throw new Error("Storage is disabled.");
        },
      },
    });
    try {
      await expect(detectPermission("storage")).resolves.toBe("unsupported");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      else {
        delete (window as unknown as Record<string, unknown>).localStorage;
      }
    }
  });
});

describe("usePermission(\"storage\") hook", () => {
  it("settles on granted in an environment where storage simply works", async () => {
    const { result } = renderHook(() => usePermission("storage"));
    await waitFor(() => expect(result.current.status).toBe("granted"));
    expect(result.current.busy).toBe(false);
  });

  it("request() resolves to a truthful status without ever hanging", async () => {
    const { result } = renderHook(() => usePermission("storage"));
    let next = "prompt" as Awaited<ReturnType<typeof result.current.request>>;
    await act(async () => {
      next = await result.current.request();
    });
    expect(["granted", "denied", "prompt", "unsupported"]).toContain(next);
    await waitFor(() => expect(result.current.status).toBe(next));
  });
});
