// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { useNavigationWatchdog } from "./use-navigation-watchdog";

/**
 * The watchdog must never get in the way of a healthy navigation, and must
 * repair one that leaves the old page on screen.
 */

function Nav({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  );
}

/** Byte-identical markup on both routes: the screen cannot be told apart. */
function Identical() {
  return (
    <main>
      <Nav to="/two" label="go two" />
      <Nav to="/same" label="go same" />
      <p>HOME PAGE</p>
    </main>
  );
}

function Different() {
  return (
    <main>
      <p>SECOND PAGE</p>
    </main>
  );
}

/** Mirrors RoutedBoundary: the key only matters when the watchdog bumps it. */
function Tree() {
  const remounts = useNavigationWatchdog(50);
  return (
    <div>
      <span data-testid="remounts">{remounts}</span>
      <Routes>
        <Route path="/" element={<Identical />} />
        <Route path="/two" element={<Different />} />
        <Route path="/same" element={<Identical />} />
      </Routes>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(120);
  });
}

async function click(label: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await act(async () => {
    await user.click(screen.getByText(label));
  });
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Tree />
    </MemoryRouter>,
  );
}

describe("useNavigationWatchdog", () => {
  it("does nothing when navigation renders the new page", async () => {
    mount();
    await screen.findByText("HOME PAGE");

    await click("go two");
    await settle();

    await screen.findByText("SECOND PAGE");
    expect(screen.getByTestId("remounts").textContent).toBe("0");
  });

  it("does nothing on the very first load", async () => {
    mount();
    await settle();
    expect(screen.getByTestId("remounts").textContent).toBe("0");
  });

  it("remounts the route tree when the screen never changes", async () => {
    mount();
    await screen.findByText("HOME PAGE");

    // "/" and "/same" render identical markup, so the fingerprint cannot
    // change — exactly the stuck-navigation signature.
    await click("go same");
    await settle();

    expect(Number(screen.getByTestId("remounts").textContent)).toBeGreaterThan(0);
  });
});