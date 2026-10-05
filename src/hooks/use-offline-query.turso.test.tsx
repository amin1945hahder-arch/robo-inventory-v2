// @vitest-environment jsdom
/**
 * The Turso branch of useOfflineQuery was unreachable until a function was
 * actually converted. Now that `labels/getLabelData` is registered, this test
 * drives the branch directly: it must call the Convex ACTION, return its
 * result, and pass it through the cache write path.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { runMock, saveMock, loadMock } = vi.hoisted(() => ({
  runMock: vi.fn(async () => ({ hello: "turso" })),
  saveMock: vi.fn(async () => undefined),
  loadMock: vi.fn(async () => undefined),
}));

vi.mock("convex/react", () => ({
  useAction: () => runMock,
  useQuery: () => undefined,
}));
vi.mock("@/lib/sync/queryStore", () => ({
  loadQueryEntry: loadMock,
  saveQueryEntry: saveMock,
}));
vi.mock("@/hooks/use-auth", () => ({
  getAuthUserSync: () => ({ _id: "u1" }),
  subscribeAuthUser: () => () => undefined,
}));
vi.mock("@/lib/offline", () => ({
  isOffline: () => false,
  onConnectivityChange: () => () => undefined,
}));

import { useOfflineQuery } from "./use-offline-query";

const tursoRef = {
  url: "https://example.convex.cloud/api/v1/labels/getLabelData",
} as never;

describe("useOfflineQuery → Turso action branch", () => {
  it("runs the action, returns its data, and persists it", async () => {
    runMock.mockClear();
    const { result } = renderHook(() => useOfflineQuery(tursoRef, {} as never));
    await waitFor(() => expect(result.current).toEqual({ hello: "turso" }));
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalled();
  });

  it("does not call the action while skipped", async () => {
    runMock.mockClear();
    renderHook(() => useOfflineQuery(tursoRef, "skip"));
    await new Promise((r) => setTimeout(r, 20));
    expect(runMock).not.toHaveBeenCalled();
  });
});
