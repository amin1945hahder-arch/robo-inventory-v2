// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * The client half of "Turso is the database". These tests pin the behaviour
 * that replaces Convex's reactive useQuery: an action call, a poll, and a
 * refetch when the member comes back to the tab.
 */

const runAction = vi.fn();
vi.mock("convex/react", () => ({
  useAction: () => runAction,
}));

import { useTursoQuery } from "./use-turso-query";

type Group = { _id: string; name: string };

function Probe(props: Parameters<typeof useTursoQuery>[1]) {
  const { data, error, isLoading } = useTursoQuery<Group>("groups", props);
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <span data-testid="count">{data?.length ?? -1}</span>
      <span data-testid="first">{data?.[0]?.name ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  runAction.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useTursoQuery", () => {
  it("loads rows from the Turso-backed action", async () => {
    runAction.mockResolvedValue([{ _id: "a", name: "LDR" }]);
    render(<Probe limit={5} pollMs={0} />);

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    expect(screen.getByTestId("first").textContent).toBe("LDR");
    expect(runAction).toHaveBeenCalledWith({
      table: "groups",
      filter: undefined,
      orderBy: undefined,
      limit: 5,
    });
  });

  it("surfaces an error instead of hanging on the loading state", async () => {
    runAction.mockRejectedValue(new Error("Admin access required"));
    render(<Probe pollMs={0} />);

    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe("Admin access required"),
    );
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("does not call the action when disabled", async () => {
    render(<Probe enabled={false} pollMs={0} />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(runAction).not.toHaveBeenCalled();
  });

  it("polls while mounted and stops on unmount", async () => {
    vi.useFakeTimers();
    runAction.mockResolvedValue([]);
    const { unmount } = render(<Probe pollMs={1000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterFirst = runAction.mock.calls.length;
    expect(afterFirst).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(runAction.mock.calls.length).toBeGreaterThan(afterFirst);

    const beforeUnmount = runAction.mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(runAction.mock.calls.length).toBe(beforeUnmount);
  });

  it("refetches when the window regains focus", async () => {
    runAction.mockResolvedValue([]);
    render(<Probe pollMs={0} />);
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(2));
  });

  it("does not restart polling when an inline filter object is re-created", async () => {
    vi.useFakeTimers();
    runAction.mockResolvedValue([]);
    const { rerender } = render(<Probe filter={{ closetId: "c1" }} pollMs={1000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(runAction).toHaveBeenCalledTimes(1);

    // A new object literal each render is the common call-site mistake.
    rerender(<Probe filter={{ closetId: "c1" }} pollMs={1000} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(runAction).toHaveBeenCalledTimes(1);
  });
});