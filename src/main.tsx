import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireAdmin } from "@/components/RequireAdmin";
import { RequireNonStudent } from "@/components/RequireNonStudent";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { Fragment, StrictMode, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import { LoadingGif } from "@/components/LoadingGif";
import { PreviousLocationTracker } from "@/hooks/use-previous-location";
import { CoverBackground } from "@/components/CoverBackground";
import { attachOfflineGuard } from "@/lib/offline";
import { installWriteSyncReceiver } from "@/lib/sync/write-sync";
import {
  createStaleWatcher,
  installDynamicImportRecovery,
} from "@/lib/dev-reload";
import { initThemeFromCache } from "@/lib/appTheme";
import { AppThemeProvider } from "@/hooks/use-app-theme";
import { useNavigationWatchdog } from "@/hooks/use-navigation-watchdog";

// Published app theme: re-apply the cached theme synchronously BEFORE the
// first paint so every visit opens with the admin's colors — no flash, no
// network wait (the AppThemeProvider below keeps it live from Convex).
initThemeFromCache();

// Route components are imported EAGERLY, not lazily.
//
// Lazily-imported routes were the direct cause of the reported glitch: "I
// click a nav link, the URL changes, but the old page stays until I refresh".
// With <Suspense> above <Routes>, a route chunk that has not resolved yet
// leaves React displaying the PREVIOUS tree — by design, so the transition
// doesn't flash. One slow or stale chunk request therefore freezes the UI on
// the old page with nothing clickable, and only a full reload recovers.
//
// Importing the pages up front removes the chunk fetch from navigation
// altogether, so a route change always paints immediately. The trade is a
// larger first load: this is a small internal tool for a single club, and
// predictable navigation is worth more here than saving a few hundred KB.
import Landing from "./pages/Landing";
import AuthPage from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import GroupDetail from "./pages/GroupDetail";
import PartDetail from "./pages/PartDetail";
import RentScan from "./pages/RentScan";
import QrRoute from "./pages/QrRoute";
import MyRentals from "./pages/MyRentals";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Closets from "./pages/Closets";
import ClosetDetail from "./pages/ClosetDetail";
import AdminRequests from "./pages/AdminRequests";
import AdminPeople from "./pages/AdminPeople";
import ImportCSV from "./pages/ImportCSV";
import Labels from "./pages/Labels";
import AdminReports from "./pages/AdminReports";
import ExportStudio from "./pages/ExportStudio";
import Settings from "./pages/Settings";
import MemberSettings from "./pages/MemberSettings";
import AdminSettings from "./pages/AdminSettings";
import Profile from "./pages/Profile";
import PersonCard from "./pages/PersonCard";
import Printing3D from "./pages/Printing3D";
import NotFound from "./pages/NotFound";

// Loading fallback for route transitions (the shared animated gif)
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <LoadingGif size={64} label="Loading…" />
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Cross-window delta-sync invalidation: another browser tab of this app
// shares the same IndexedDB cache, so teach THIS tab to re-pull its deltas
// the instant a sibling tab writes. Must be installed before any write.
installWriteSyncReceiver();

// Offline mode: one app-wide write guard. While the device is offline every
// mutation/action is refused with a clear message (nothing hangs or silently
// fails); reactive reads and the IndexedDB delta cache keep working.
attachOfflineGuard(convex);

// The preview dev server must not hot-update the open page, so the browser
// keeps running the module graph it loaded at startup. Both halves of that
// problem used to end with "…and I'll just refresh the browser": stale routes
// that never show your latest edit, and lazy chunks that fail against the old
// graph. Reload for the user instead. Dev-only, fires at most once, and stays
// quiet if the server cannot be reached.
if (import.meta.env.DEV) {
  const reload = () => window.location.reload();
  installDynamicImportRecovery(reload);

  createStaleWatcher({
    load: async () => {
      const res = await fetch(import.meta.env.BASE_URL + "src/main.tsx", {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return await res.text();
    },
    reload,
  }).start();
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

/** Per-navigation error boundary: a crash on one page shows a recoverable
 *  panel (with the message) instead of a dead app; moving to another page
 *  clears it. `resetKey` (not a React `key`) is deliberate — a key change would
 *  remount the whole route tree on every navigation and blank the app while a
 *  lazily-loaded page fetches its code. */
function RoutedBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // Repairs a navigation that failed to render. The key stays 0 while
  // everything is healthy, so a normal route change is a plain React update;
  // it only changes once the watchdog has compared the screen before and after
  // a navigation, found them identical, and rebuilt the route tree. If even
  // that is not enough it escalates to a reload, which is the manual browser
  // refresh this replaces.
  const remounts = useNavigationWatchdog();
  return (
    <PageErrorBoundary resetKey={location.pathname}>
      <Fragment key={remounts}>{children}</Fragment>
    </PageErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        {/* Global published app theme (admin Settings → App theme): applies
            to every member, keeps the localStorage cache fresh, and repaints
            live whenever the admin publishes a change. */}
        <AppThemeProvider />
        {/* Global cover background: sits behind EVERY page (landing, auth,
            app shell). Replace src/assets/cover.png or cover.svg to change
            the artwork — height fits the window, width follows the A4 ratio. */}
        <CoverBackground />
        <BrowserRouter>
          {/* Tracks the previous route so detail pages can offer a truthful
              back button ("return to the storage I came from"). */}
          <PreviousLocationTracker />
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <RoutedBoundary>
              <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/inventory"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <Inventory />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/group/:id"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <GroupDetail />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/part/:id"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <PartDetail />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/rent-scan"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <RentScan />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route path="/qr" element={<QrRoute />} />
              <Route
                path="/rentals"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <MyRentals />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/projects"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <Projects />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/projects/:id"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <ProjectDetail />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/closets"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <Closets />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/closets/:id"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <ClosetDetail />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/requests"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminRequests />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/people"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminPeople />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/import"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <ImportCSV />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/labels"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <Labels />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/export"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <ExportStudio />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/reports"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminReports />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              {/* One Settings route for every role: admins get the lab
                  console, members/students get their personal settings. */}
              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <Settings />
                  </RequireAuth>
                }
              />
              <Route
                path="/profile"
                element={
                  <RequireAuth>
                    <Profile />
                  </RequireAuth>
                }
              />
              {/* Person QR: scanned member card (all signed-in roles). */}
              <Route
                path="/person/:id"
                element={
                  <RequireAuth>
                    <PersonCard />
                  </RequireAuth>
                }
              />
              {/* 3D printing farm: placeholder module, gated like inventory. */}
              <Route
                path="/3d-printing"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <Printing3D />
                    </RequireNonStudent>
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </RoutedBoundary>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
