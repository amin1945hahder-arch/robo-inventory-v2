// @vitest-environment jsdom
/**
 * useOfflineMutation dispatch.
 *
 * The whole point of the hook is that a call site cannot tell which backend a
 * write lives on — so both branches have to be right, and the invalidation
 * contract (bump on success, never on failure) is what keeps converted writes
 * from leaving the UI showing stale rows.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { actionMock, mutationMock, bumpMock } = vi.hoisted(() => ({
  actionMock: vi.fn(async () => ({ ok: true })),
  mutationMock: vi.fn(async () => ({ ok: "convex" })),
  bumpMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => actionMock,
  useMutation: () => mutationMock,
}));
vi.mock("@/lib/sync/bus", () => ({ bumpDataSync: bumpMock }));
vi.mock("@/lib/sync/tursoFunctions", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/sync/tursoFunctions")>(
      "@/lib/sync/tursoFunctions",
    );
  return {
    ...actual,
    // Exactly one converted write, so the dispatch boundary is exercised.
    isTursoWrite: (name: string) => name === "settings/setReturnCooldown",
  };
});

import { useOfflineMutation } from "./use-offline-mutation";

const ref = (name: string) =>
  ({ url: `https://example.convex.cloud/api/v1/settings/${name}` }) as never;

describe("useOfflineMutation → dispatch", () => {
  beforeEach(() => {
    actionMock.mockClear();
    mutationMock.mockClear();
    bumpMock.mockClear();
    actionMock.mockImplementation(async () => ({ ok: true }));
  });

  it("sends a NOT-yet-converted write through useMutation", async () => {
    const { result } = renderHook(() => useOfflineMutation(ref("setCardLayout")));
    await result.current({} as never);
    expect(mutationMock).toHaveBeenCalledTimes(1);
    expect(actionMock).not.toHaveBeenCalled();
    // Convex reactivity already invalidates the reads — no extra bump.
    expect(bumpMock).not.toHaveBeenCalled();
  });

  it("sends a CONVERTED write through useAction", async () => {
    const { result } = renderHook(() =>
      useOfflineMutation(ref("setReturnCooldown")),
    );
    await result.current({ hours: 24 } as never);
    expect(actionMock).toHaveBeenCalledTimes(1);
    expect(mutationMock).not.toHaveBeenCalled();
    expect(actionMock).toHaveBeenCalledWith({ hours: 24 });
  });

  it("invalidates readers after a converted write (Turso has no subscription)", async () => {
    const { result } = renderHook(() =>
      useOfflineMutation(ref("setReturnCooldown")),
    );
    await result.current({ hours: 24 } as never);
    expect(bumpMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT invalidate when the converted write fails", async () => {
    actionMock.mockImplementationOnce(async () => {
      throw new Error("nope");
    });
    const { result } = renderHook(() =>
      useOfflineMutation(ref("setReturnCooldown")),
    );
    await expect(result.current({ hours: 24 } as never)).rejects.toThrow("nope");
    // Nothing changed server-side, so spending reads to refetch would be waste.
    expect(bumpMock).not.toHaveBeenCalled();
  });
});