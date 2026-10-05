// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

/**
 * Reproduction for the reported freeze: "I click a tab, nothing happens,
 * only a browser refresh shows the change."
 *
 * The defect: useAuth's sync effect DEPENDED on `cachedUser` and always
 * wrote a BRAND-NEW object back into that state:
 *
 *   setCachedUser((prev) => { const next = { ...liveUser, _id: ... }; ... return next; });
 *
 * React bails out of a state update only when the next value is the SAME
 * object (Object.is). A fresh object identity every run re-arms the effect
 * on every pass — effect → setState → re-render → effect → … The main
 * thread saturates: the URL still changes (pushState runs in the click
 * handler) but React never repaints the new route, which is exactly the
 * reported behaviour, and only a manual browser refresh lands on the
 * destination.
 *
 * It only fires once the LIVE user record arrives (signed in, backend
 * connected) — the reason the earlier store-level tests never caught it.
 *
 * The guard below turns that runaway loop into a FAST, explicit failure:
 * the probe throws once it has rendered too many times, an error boundary
 * catches it (stopping the loop), and the test reports the count.
 */

const LIVE_USER = { _id: "u-live-1", name: "Ada", role: "admin" } as never;
const MAX_SETTLED_RENDERS = 20;

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  // A real subscription returns the SAME object identity while nothing
  // changed — precisely the situation a correct effect must settle on.
  useQuery: () => LIVE_USER,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}));

class ProbeBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

describe("useAuth with a live user record (navigation-freeze regression)", () => {
  it("settles after the live user arrives instead of re-rendering forever", async () => {
    const { useAuth } = await import("./use-auth");

    let renders = 0;
    let latest: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      // useAuth FIRST so the hook order stays constant on every pass.
      const auth = useAuth();
      latest = auth;
      renders += 1;
      if (renders > MAX_SETTLED_RENDERS) {
        throw new Error(
          `useAuth re-rendered ${renders} times without settling — infinite effect loop`,
        );
      }
      return null;
    }

    expect(() =>
      render(
        <ProbeBoundary>
          <Probe />
        </ProbeBoundary>,
      ),
    ).not.toThrow();

    // A healthy effect chain settles within a couple of renders; anything
    // near the guard means the effect is re-arming on its own state write.
    expect(renders).toBeLessThanOrEqual(MAX_SETTLED_RENDERS);

    // …and the hook still resolves the member from the live record.
    expect(latest?.user?._id).toBe("u-live-1");
    expect(latest?.isAuthenticated).toBe(true);
  });
});
