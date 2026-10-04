import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useConvexConnectionState } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { QrScanDialog } from "@/components/QrScanDialog";
import { PermissionsPrompt } from "@/components/PermissionsPrompt";
import { RentCardRelay } from "@/components/RentCardRelay";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart3,
  Bell,
  BellRing,
  Boxes,
  Box,
  FileDown,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  QrCode,
  ScanLine,
  Settings,
  UserCircle2,
  Users,
  Warehouse,
  WifiOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeScan } from "@/lib/qr";
import { AppIcon } from "@/components/AppIcon";
import { useSound } from "@/hooks/use-sound";
import { useAppearance } from "@/hooks/use-appearance";
import { useFont } from "@/hooks/use-font";
import { usePush } from "@/hooks/use-push";
import { usePermission } from "@/hooks/use-permissions";
import { useOnline } from "@/hooks/use-online";
import { setBackendConnected } from "@/lib/offline";
import { toast } from "sonner";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes, studentBlocked: true },
  { to: "/closets", label: "Storages", icon: Warehouse, studentBlocked: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, studentBlocked: true },
  { to: "/rentals", label: "My rentals", icon: PackageSearch, studentBlocked: true },
  { to: "/3d-printing", label: "3D printing", icon: Box, studentBlocked: true },
];

/** Admin nav rows (mobile menu) — each has an icon-override slot:
 *  src/assets/icons/nav/<route>.svg — see AppIcon for the exact list. */
const ADMIN_LINKS = [
  { to: "/admin/requests", label: "Requests", icon: Bell },
  { to: "/people", label: "People", icon: Users },
  { to: "/import", label: "Import CSV", icon: PackageSearch },
  { to: "/labels", label: "Print labels", icon: QrCode },
  { to: "/export", label: "Export", icon: FileDown },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "admin";
  // Students get the restricted navigation: inventory-related tabs are hidden
  // (and every protected backend call is rejected server-side as well).
  const isStudent = user?.role === "student";
  const [scanOpen, setScanOpen] = useState(false);
  // Mobile hamburger menu (below md): lists everything the sidebar does.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const notifData = useQuery(
    api.notifications.unreadCount,
    isAdmin ? {} : "skip",
  );
  const claimAdmin = useMutation(api.users.claimAdminIfNoAdmins);
  const reconcile = useMutation(api.users.reconcileProfile);
  const playSound = useSound();
  // Per-user app mode (dark/light/system): applies the theme for THIS member
  // and keeps it in sync across their devices.
  useAppearance(user?._id);
  // Per-user font: applies the member's saved typeface on <html>.
  useFont();
  const prevNotifs = useRef<number | null>(null);
  // Member tab bubble: pending rental requests on "My rentals" (live-updated).
  const myCounts = useQuery(api.parts.myRequestCounts, {});
  // OS-level push notifications (service worker) for the wrapped APK/EXE apps.
  usePush();

  // Offline mode: the browser's network events PLUS the live Convex websocket
  // state feed one central flag (src/lib/offline.ts). When it flips, the
  // header shows an Offline chip + banner, and the client-wide write guard
  // refuses every mutation/action until the backend is reachable again.
  const online = useOnline();
  const connState = useConvexConnectionState();
  useEffect(() => {
    // Only a websocket that HAS connected and then dropped marks the app
    // offline — the pre-first-connect state would false-positive at startup.
    setBackendConnected(!(connState.hasEverConnected && !connState.isWebSocketConnected));
  }, [connState.hasEverConnected, connState.isWebSocketConnected]);

  // Notification permission: offer the OS prompt the first time (one tap,
  // never auto-fire — browsers require a user gesture and iOS requires it
  // to be synchronous). Android WebViews without the Notification API fall
  // back to in-page banners so the shell still notifies visibly.
  const notifPerm = usePermission("notifications");
  const [askedNotif, setAskedNotif] = useState(true);
  useEffect(() => {
    try {
      setAskedNotif(window.localStorage.getItem("roboShelf.notifAsked") === "1");
    } catch {
      setAskedNotif(false);
    }
  }, []);
  const askNotifications = async () => {
    const res = await notifPerm.request();
    try {
      window.localStorage.setItem("roboShelf.notifAsked", "1");
    } catch {
      /* private mode */
    }
    setAskedNotif(true);
    if (res === "granted") toast.success("Notifications enabled");
    else if (res === "denied") toast.error("Blocked — enable notifications from your browser/app settings");
  };
  const showNotifBanner = async (title: string, body: string) => {
    const sw = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (sw && typeof Notification !== "undefined" && Notification.permission === "granted") {
      sw.active?.postMessage({ type: "SHOW_NOTIFICATION", title, body, tag: "roboshelf-activity", url: "/admin/requests" });
      return;
    }
    toast(title, { description: body, duration: 8000 });
  };

  // First-run bootstrap: (1) merge a pre-seeded club profile (name, ids,
  // phone, admin role) into this auth account if one exists, and (2) if no
  // admins exist yet, the first signed-in user becomes admin automatically.
  useEffect(() => {
    if (!user) return;
    reconcile().catch(() => undefined);
    if (user.role !== "admin") {
      claimAdmin().catch(() => undefined);
    }
  }, [user?._id, user?.role, claimAdmin, reconcile]);

  // Persistent storage ("storage permission"): pins the app's offline data
  // (service-worker shell + IndexedDB delta cache) so it survives storage
  // pressure. No OS dialog exists for this on the web — this one-tap strip is
  // the visible ask, remembered per device like the notifications strip.
  const storagePerm = usePermission("storage");
  const [askedStorage, setAskedStorage] = useState(true);
  useEffect(() => {
    try {
      setAskedStorage(window.localStorage.getItem("roboShelf.storageAsked") === "1");
    } catch {
      setAskedStorage(false);
    }
  }, []);
  const askStorage = async () => {
    const res = await storagePerm.request();
    try {
      window.localStorage.setItem("roboShelf.storageAsked", "1");
    } catch {
      /* private mode */
    }
    setAskedStorage(true);
    if (res === "granted") toast.success("Offline storage enabled — your saved data stays on this device");
    else if (res === "denied")
      toast.error("Storage was declined — the app works, but the browser may clear offline data when space runs low");
  };

  // Play the notification sound when new admin notifications arrive while
  // the shell is open (Convex pushes updates automatically — no reload).
  useEffect(() => {
    if (notifData === undefined) return;
    const prev = prevNotifs.current;
    if (prev !== null && notifData > prev) {
      playSound("notification");
      void showNotifBanner("RoboShelf", "New activity in the requests console");
    }
    prevNotifs.current = notifData;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifData, playSound]);

  // One-tap permission banner in the shell until answered (prompt/denied
  // both re-ask — the browser itself enforces the quiet-time after a deny).

  // Short beep on tab navigation (kept subtle).
  useEffect(() => {
    playSound("scan");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Every route change starts at the top of the content column (React Router
  // keeps the old scroll offset otherwise).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleScan = (text: string) => {
    setScanOpen(false);
    playSound("scan");
    navigate(`/qr?p=${encodeURIComponent(normalizeScan(text))}`);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-transparent">
      {/* Floating glass sidebar — Telegram-style: inset from the screen edge
          with its own rounded 3D glass panel + deep floating shadow. */}
      <div className="hidden shrink-0 py-3 pl-3 md:block">
        <aside className="glass-strong flex h-[calc(100dvh-1.5rem)] w-56 flex-col overflow-y-auto rounded-2xl border px-4 py-6">
        <Link to="/dashboard" className="mb-8 flex items-center gap-2 px-2">
          <div className="icon-glass flex size-9 items-center justify-center rounded-lg text-primary">
            <Boxes className="icon-3d size-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">RoboShelf</p>
            <p className="text-xs text-muted-foreground">Robotics club inventory</p>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.filter(({ studentBlocked }) => !studentBlocked || !isStudent).map(
            ({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to);
            // Bubble count per tab: "My rentals" shows pending requests, the
            // admin "Requests" tab keeps its unread-count bubble below.
            const bubble =
              to === "/rentals" && (myCounts?.pending ?? 0) > 0 ? myCounts?.pending : undefined;
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route={to} fallback={Icon} className="size-6" />
                {label}
                {bubble ? (
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {bubble}
                  </span>
                ) : null}
              </Link>
            );
            },
          )}
          {isAdmin && (
            <>
              <p className="mt-6 mb-1 px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Admin
              </p>
              <Link
                to="/admin/requests"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/admin")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/admin/requests" fallback={Bell} className="size-6" />
                Requests
                {notifData ? (
                  <span className="ml-auto rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                    {notifData}
                  </span>
                ) : null}
              </Link>
              <Link
                to="/people"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/people")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/people" fallback={Users} className="size-6" />
                People
              </Link>
              <Link
                to="/import"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/import")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/import" fallback={PackageSearch} className="size-6" />
                Import CSV
              </Link>
              <Link
                to="/labels"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/labels")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/labels" fallback={QrCode} className="size-6" />
                Print labels
              </Link>
              <Link
                to="/export"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/export")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/export" fallback={FileDown} className="size-6" />
                Export
              </Link>
              <Link
                to="/admin/reports"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/admin/reports")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/admin/reports" fallback={BarChart3} className="size-6" />
                Reports
              </Link>
              <Link
                to="/settings"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  location.pathname.startsWith("/settings")
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <AppIcon route="/settings" fallback={Settings} className="size-6" />
                Settings
              </Link>
            </>
          )}
        </nav>

        <Button className="press-3d mt-4 w-full gap-2" onClick={() => setScanOpen(true)}>
          <ScanLine className="size-4" /> Scan QR
        </Button>
        </aside>
      </div>

      <div ref={scrollRef} className="flex h-dvh min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Floating top bar — a content-width glass pill (matches the floating
            sidebar) instead of a full-width strip. Everything that lived in
            the old bar (mobile shortcuts + profile) sits inside the pill;
            the offline banner and mobile menu hang below it. */}
        <div className="sticky top-0 z-20 flex flex-col gap-2 px-3 pt-3">
        <header className="glass-strong flex w-fit max-w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 self-end rounded-2xl border px-2 py-1.5">
          <div className="flex items-center gap-1 md:hidden">
            {/* Hamburger: opens the full mobile menu (everything in the
                sidebar, laid out as a dropdown panel). */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              title="Menu"
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
            {NAV.filter(({ studentBlocked }) => !studentBlocked || !isStudent)
              .slice(0, 3)
              .map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "rounded-md p-2",
                  location.pathname.startsWith(to)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground",
                )}
                title={label}
              >
                <AppIcon route={to} fallback={Icon} className="size-4" />
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!online && (
              <span
                className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-500"
                title="Offline — browsing saved data; changes are disabled"
              >
                <WifiOff className="size-3" />
                Offline
              </span>
            )}
            <Button variant="outline" size="sm" className="gap-2 md:hidden" onClick={() => setScanOpen(true)}>
              <ScanLine className="size-4" />
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="icon" className="relative" asChild>
                <Link to="/admin/requests" title="Notifications">
                  <Bell className="size-4" />
                  {notifData ? (
                    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
                  ) : null}
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="size-6">
                    <AvatarImage src={user?.image} />
                    <AvatarFallback className="text-xs">
                      {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm sm:inline">{user?.name ?? "Member"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <UserCircle2 className="size-4" /> Profile
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin/requests")}>
                    <Bell className="size-4" /> Admin requests
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await signOut();
                    navigate("/");
                  }}
                >
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Offline mode: cached data stays browsable (reactive queries keep
            their last values, Inventory reads its IndexedDB delta cache);
            every database write is refused until the backend is reachable. */}
        {!online && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-500">
            <WifiOff className="size-3.5 shrink-0" />
            <span className="min-w-0">
              <span className="font-semibold text-foreground">Offline</span> — showing saved data.
              Actions that change the database are disabled until you're back online.
            </span>
          </div>
        )}

        {/* ===== Mobile menu dropdown (below md) ===== */}
        {mobileMenuOpen && (
          <div className="glass-strong overflow-hidden rounded-xl border md:hidden">
            <nav className="flex max-h-[70dvh] flex-col gap-1 overflow-y-auto px-4 py-3">
              {NAV.filter(({ studentBlocked }) => !studentBlocked || !isStudent).map(
                ({ to, label, icon: Icon }) => {
                  const active = location.pathname.startsWith(to);
                  const bubble =
                    to === "/rentals" && (myCounts?.pending ?? 0) > 0 ? myCounts?.pending : undefined;
                  return (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <AppIcon route={to} fallback={Icon} className="size-4" />
                      {label}
                      {bubble ? (
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          {bubble}
                        </span>
                      ) : null}
                    </Link>
                  );
                },
              )}
              {isAdmin && (
                <>
                  <p className="mt-3 mb-1 px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    Admin
                  </p>
                  {ADMIN_LINKS.map(({ to, label, icon }) => (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                        location.pathname.startsWith(to)
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <AppIcon route={to} fallback={icon} className="size-4" />
                      {label}
                      {to === "/admin/requests" && notifData ? (
                        <span className="ml-auto rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                          {notifData}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </>
              )}
              <Button
                className="mt-2 w-full gap-2"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setScanOpen(true);
                }}
              >
                <ScanLine className="size-4" /> Scan QR
              </Button>
            </nav>
          </div>
        )}
        </div>

        <main className="flex-1 px-4 py-8 md:px-8">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            {/* First-run enable-notifications strip: one tap fires the native
                prompt (Safari-safe: click handler → sync requestPermission). */}
            {notifPerm.status === "prompt" && !askedNotif && (
              <button
                type="button"
                onClick={askNotifications}
                className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-left transition-colors hover:bg-primary/10"
              >
                <span className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Turn on notifications</span> — know the moment a
                  request is approved or a return is due.
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  <BellRing className="size-3.5" /> Enable
                </span>
              </button>
            )}
            {/* The strip's whole job is the one visible "ask" for pinning data
                as persistent. It shows whenever storage is still "prompt" —
                which now only happens where a StorageManager actually exists
                to grant it (webview shells without one report the working
                truth as granted instead of a stuck "Not set"). */}
            {storagePerm.status === "prompt" && !askedStorage && (
              <button
                type="button"
                onClick={askStorage}
                className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-left transition-colors hover:bg-primary/10"
              >
                <span className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Turn on offline storage</span> — keeps your saved
                  inventory on this device so the app keeps working without a connection.
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  <HardDrive className="size-3.5" /> Enable
                </span>
              </button>
            )}
            {children}
          </div>
        </main>
      </div>

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={handleScan} />
      {/* Renders queued rent-card PDFs (identical to the manual card) for the
          automated Telegram posts — approve / return / assign / packages. */}
      <RentCardRelay />
      {/* One-time camera permission prompt on first load */}
      <PermissionsPrompt />
    </div>
  );
}
