import { describe, expect, it } from "vitest";
import { Suspense, lazy, type ReactElement, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Link,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";

/**
 * The exact route composition used by src/main.tsx:
 *
 *   BrowserRouter
 *     └ Suspense (full-screen fallback)
 *         └ PageErrorBoundary key={location.pathname}
 *             └ Routes … (all lazily loaded)
 *
 * Reproduced here because "I click a nav tab and the page does not appear
 * until I refresh the browser" is a routing-shell symptom, and this is the
 * only way to prove it here (no browser preview is available).
 *
 * The nav links live in a layout route (via <Outlet />) exactly like the real
 * AppShell sidebar, so they survive navigation — links placed inside a page
 * would disappear with that page and make the test lie.
 */

const Alpha = lazy(() => Promise.resolve({ default: () => <p>ALPHA PAGE</p> }));
const Beta = lazy(() => Promise.resolve({ default: () => <p>BETA PAGE</p> }));
// Declared return type + explicit cast: a function that only throws infers
// `never`, which React.lazy() cannot resolve to a component type.
const Boom = lazy(
  () =>
    Promise.resolve({
      default: function Boom(): ReactElement {
        throw new Error("kaboom");
      },
    }) as Promise<{ default: () => ReactElement }>,
);

function Boundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <PageErrorBoundary key={location.pathname}>{children}</PageErrorBoundary>;
}

function Layout() {
  return (
    <div>
      <nav>
        <Link to="/alpha">Go alpha</Link>
        <Link to="/beta">Go beta</Link>
        <Link to="/boom">Go boom</Link>
        <Link to="/nowhere">Go nowhere</Link>
      </nav>
      <Outlet />
    </div>
  );
}

function Shell({ from }: { from: string }) {
  return (
    <MemoryRouter initialEntries={[from]}>
      <Suspense fallback={<p>ROUTE LOADING…</p>}>
        <Boundary>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/alpha" element={<Alpha />} />
              <Route path="/beta" element={<Beta />} />
              <Route path="/boom" element={<Boom />} />
              <Route path="/dashboard" element={<p>DASHBOARD PAGE</p>} />
              <Route path="*" element={<p>NOT FOUND</p>} />
            </Route>
          </Routes>
        </Boundary>
      </Suspense>
    </MemoryRouter>
  );
}

describe("client-side navigation shell", () => {
  it("renders each destination page after clicking a nav link", async () => {
    const user = userEvent.setup();
    render(<Shell from="/alpha" />);

    await screen.findByText("ALPHA PAGE");

    await user.click(screen.getByText("Go beta"));
    await waitFor(() => expect(screen.getByText("BETA PAGE")).toBeTruthy());

    await user.click(screen.getByText("Go alpha"));
    await waitFor(() => expect(screen.getByText("ALPHA PAGE")).toBeTruthy());

    await user.click(screen.getByText("Go nowhere"));
    await waitFor(() => expect(screen.getByText("NOT FOUND")).toBeTruthy());

    // …and the shell is still alive, so navigation continues afterwards.
    await user.click(screen.getByText("Go beta"));
    await waitFor(() => expect(screen.getByText("BETA PAGE")).toBeTruthy());
  });

  it("recovers in-app after a page throws — no browser reload needed", async () => {
    const user = userEvent.setup();
    render(<Shell from="/alpha" />);

    await user.click(screen.getByText("Go boom"));
    await screen.findByText("This page hit an error");

    // The boundary sits above <Routes>, so the sidebar is gone with it — the
    // panel MUST still offer a client-side way out.
    expect(screen.queryByText("Go beta")).toBeNull();

    await user.click(screen.getByText("Back to the app"));
    await waitFor(() => expect(screen.getByText("DASHBOARD PAGE")).toBeTruthy());

    // …and the app is fully usable again afterwards.
    await user.click(screen.getByText("Go beta"));
    await waitFor(() => expect(screen.getByText("BETA PAGE")).toBeTruthy());
  });
});