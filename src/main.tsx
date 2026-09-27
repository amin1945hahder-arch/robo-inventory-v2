import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireAdmin } from "@/components/RequireAdmin";
import { RequireNonStudent } from "@/components/RequireNonStudent";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import { LoadingGif } from "@/components/LoadingGif";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Inventory = lazy(() => import("./pages/Inventory.tsx"));
const GroupDetail = lazy(() => import("./pages/GroupDetail.tsx"));
const PartDetail = lazy(() => import("./pages/PartDetail.tsx"));
const RentScan = lazy(() => import("./pages/RentScan.tsx"));
const QrRoute = lazy(() => import("./pages/QrRoute.tsx"));
const MyRentals = lazy(() => import("./pages/MyRentals.tsx"));
const Projects = lazy(() => import("./pages/Projects.tsx"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail.tsx"));
const Closets = lazy(() => import("./pages/Closets.tsx"));
const ClosetDetail = lazy(() => import("./pages/ClosetDetail.tsx"));
const AdminRequests = lazy(() => import("./pages/AdminRequests.tsx"));
const AdminPeople = lazy(() => import("./pages/AdminPeople.tsx"));
const ImportCSV = lazy(() => import("./pages/ImportCSV.tsx"));
const Labels = lazy(() => import("./pages/Labels.tsx"));
const AdminReports = lazy(() => import("./pages/AdminReports.tsx"));
const ExportStudio = lazy(() => import("./pages/ExportStudio.tsx"));
const AdminSettings = lazy(() => import("./pages/AdminSettings.tsx"));
const Courses = lazy(() => import("./pages/Courses.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const PersonCard = lazy(() => import("./pages/PersonCard.tsx"));
const Printing3D = lazy(() => import("./pages/Printing3D.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

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
 *  remounts fresh. */
function RoutedBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return <PageErrorBoundary key={location.pathname}>{children}</PageErrorBoundary>;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
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
              {/* Courses: modular placeholder, gated like inventory modules. */}
              <Route
                path="/courses"
                element={
                  <RequireAuth>
                    <RequireNonStudent>
                      <Courses />
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
              <Route
                path="/settings"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminSettings />
                    </RequireAdmin>
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
