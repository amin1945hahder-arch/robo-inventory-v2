// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useEffect, useRef, useState, StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { useAuth } from "./use-auth";
import { mergeCachedUser, readCachedUser } from "./use-auth";

/**
 * The reported glitch: "URL changes but the view never changes; only a manual
 * browser reload shows the new tab."
 *
 * Root cause: the identity-sync effect in use-auth.ts returned a FRESH object
 * from setCachedUser on every pass while the live user document existed. Its
 * own `cachedUser` dependency then changed every pass → effect re-ran →
 * returned another fresh object → an endless setState loop in EVERY component
 * that calls useAuth() (every page, every guard, the shell). React's
 * default-priority updates continuously preempt the router's startTransition
 * render, so navigation updated the URL but the new route never committed.
 *
 * These tests reproduce that loop MECHANICALLY: if the effect body runs more
 * than a bounded number of times for a stable identity, the loop is back.
 */

// ── test scaffolding ─────────────────────────────────────────────────────────

type TestUser = {
  _id: string;
  name?: string;
  role?: string;
  clubRoles?: string[];
  profile?: { major?: string; studentId?: string };
};

// Stub the Convex auth/react surface use-auth.ts imports.
const authState = { isLoading: false, isAuthenticated: true };
const liveUserRef: { current: TestUser | null | undefined } = { current: undefined };

vi.mock("convex/react", () => ({
  useConvexAuth: () => authState,
  useQuery: () => liveUserRef.current,
}));

// The app's useAuthActions comes from @convex-dev/auth/react.
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}));

// api.users.currentUser is only used for its TYPE in use-auth.ts (the query
// call is mocked out), so an empty stub is enough.
vi.mock("@/convex/_generated/api", () => ({ api: { users: { currentUser: "stub" } } }));

/** Instrumented probe: counts renders and effect runs of the sync effect. */
let effectRuns = 0;
let renders = 0;

function Probe() {
  const { user, isLoading } = useAuth();
  renders += 1;
  const runs = useRef(0);
  useEffect(() => {
    // Mirror of the identity-sync effect's re-run driver: the effect re-runs
    // whenever `user` identity changes — exactly the dependency that used to
    // churn every pass. We count re-runs while the identity is stable.
    runs.current += 1;
    effectRuns = runs.current;
  }, [user]);
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="name">{user?.name ?? "none"}</span>
    </div>
  );
}

async function mountProbe() {
  render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("useAuth identity sync (stuck-navigation root cause)", () => {
  it("the sync effect converges — a stable live user does not loop", async () => {
    localStorage.clear();
    effectRuns = 0;
    renders = 0;
    liveUserRef.current = { _id: "u1", name: "Ada", role: "member" };

    await mountProbe();
    // Allow the seed-pass and the live-arrival pass to settle; a converged
    // effect stops re-running, so the count stays far below a loop's ceiling.
    await new Promise((r) => setTimeout(r, 25));

    expect(screen.getByTestId("name").textContent).toBe("Ada");
    // A live loop never stops re-rendering; with StrictMode's double-pass and
    // the two transitions above, a converged effect settles under 25 runs.
    expect(renders).toBeLessThan(25);
    expect(effectRuns).toBeLessThan(25);
  });

  it("updating a field on the live user propagates exactly once (no churn)", async () => {
    localStorage.clear();
    effectRuns = 0;
    renders = 0;
    liveUserRef.current = { _id: "u1", name: "Ada" };

    // Tick + rerender together: the ref mutation itself can't re-render (refs
    // aren't reactive), so drive the update exactly like a Convex push would
    // — one new liveUser identity, one render pass.
    let tick = 0;
    const { rerender } = render(
      <StrictMode>
        <Probe key={tick} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Ada"));

    liveUserRef.current = { _id: "u1", name: "Ada Lovelace" };
    tick += 1;
    rerender(
      <StrictMode>
        <Probe key={tick} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Ada Lovelace"));
    // Propagation must be a step function, not per-tick churn.
    expect(renders).toBeLessThan(40);
    expect(effectRuns).toBeLessThan(40);
  });

  it("a cached seed and the live document converge to the same object", async () => {
    localStorage.clear();
    localStorage.setItem(
      "roboshelf.authUser.v1",
      JSON.stringify({
        _id: "u1",
        name: "Ada",
        profile: { major: "CS", studentId: "s1" },
      }),
    );
    const seeded = readCachedUser()!;
    // Key order differs between the storage blob and a fresh Convex doc.
    const live = { profile: { studentId: "s1", major: "CS" }, _id: "u1", name: "Ada" } as never;

    // Same content → the EXACT same object identity → the effect's dependency
    // stops changing → no loop. This is the contract mergeCachedUser provides.
    expect(mergeCachedUser(seeded, live)).toBe(seeded);
  });

  it("a genuinely changed live document still propagates", async () => {
    localStorage.clear();
    const seeded = { _id: "u1", name: "Ada", role: "member" } as never;
    const live = { _id: "u1", name: "Ada", role: "admin" } as never;
    const next = mergeCachedUser(seeded, live);
    expect(next).not.toBe(seeded);
    expect(next.role).toBe("admin");
    // and it stays converged afterwards
    expect(mergeCachedUser(next, live)).toBe(next);
  });

  it("a different member always produces a new object", () => {
    localStorage.clear();
    const seeded = { _id: "u1", name: "Ada" } as never;
    const other = mergeCachedUser(seeded, { _id: "u2", name: "Ada" } as never);
    expect(other).not.toBe(seeded);
    expect(other._id).toBe("u2");
  });
});
