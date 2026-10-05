// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";

/**
 * The reported glitch: "URL changes but the old page content stays", on every
 * sidebar link, every time.
 *
 * The earlier navigation test used MemoryRouter. This one uses BrowserRouter
 * — the real router in src/main.tsx — because the symptom is exactly what you
 * would see if the router's history and the rendered route tree disagreed.
 */
function Shell() {
  return (
    <PageErrorBoundary resetKey={window.location.pathname}>
      <Routes>
        <Route path="/" element={<Link to="/inventory">Go inventory</Link>} />
        <Route path="/inventory" element={<p>INVENTORY PAGE</p>} />
        <Route path="/closets" element={<p>CLOSETS PAGE</p>} />
        <Route path="*" element={<p>NOT FOUND</p>} />
      </Routes>
    </PageErrorBoundary>
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("BrowserRouter navigation", () => {
  it("updates the URL and the rendered page on a Link click", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/");
    render(
      <BrowserRouter>
        <Shell />
      </BrowserRouter>,
    );

    await user.click(screen.getByText("Go inventory"));
    await waitFor(() => expect(screen.getByText("INVENTORY PAGE")).toBeTruthy());
    expect(window.location.pathname).toBe("/inventory");

    // And a second, different destination replaces it rather than stacking.
    await act(async () => {
      window.history.replaceState(null, "", "/closets");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByText("CLOSETS PAGE")).toBeTruthy());
    expect(screen.queryByText("INVENTORY PAGE")).toBeNull();
  });
});