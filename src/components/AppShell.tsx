import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { QrScanDialog } from "@/components/QrScanDialog";
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
  Boxes,
  FileDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  QrCode,
  ScanLine,
  Settings,
  UserCircle2,
  Users,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeScan } from "@/lib/qr";
import { useSound } from "@/hooks/use-sound";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/closets", label: "Closets", icon: Warehouse },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/rentals", label: "My rentals", icon: PackageSearch },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "admin";
  const [scanOpen, setScanOpen] = useState(false);
  const notifData = useQuery(
    api.notifications.unreadCount,
    isAdmin ? {} : "skip",
  );
  const claimAdmin = useMutation(api.users.claimAdminIfNoAdmins);
  const reconcile = useMutation(api.users.reconcileProfile);
  const playSound = useSound();
  const prevNotifs = useRef<number | null>(null);

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

  // Play the notification sound when new admin notifications arrive while
  // the shell is open (Convex pushes updates automatically — no reload).
  useEffect(() => {
    if (notifData === undefined) return;
    const prev = prevNotifs.current;
    if (prev !== null && notifData > prev) playSound("notification");
    prevNotifs.current = notifData;
  }, [notifData, playSound]);

  // Short beep on tab navigation (kept subtle).
  useEffect(() => {
    playSound("scan");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const handleScan = (text: string) => {
    setScanOpen(false);
    playSound("scan");
    navigate(`/qr?p=${encodeURIComponent(normalizeScan(text))}`);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card/50 px-4 py-6 md:flex">
        <Link to="/dashboard" className="mb-8 flex items-center gap-2 px-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary neon-ring">
            <Boxes className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">RoboShelf</p>
            <p className="text-xs text-muted-foreground">Robotics club inventory</p>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to);
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
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
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
                <Bell className="size-4" />
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
                <Users className="size-4" />
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
                <PackageSearch className="size-4" />
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
                <QrCode className="size-4" />
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
                <FileDown className="size-4" />
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
                <BarChart3 className="size-4" />
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
                <Settings className="size-4" />
                Settings
              </Link>
            </>
          )}
        </nav>

        <Button className="mt-4 w-full gap-2" onClick={() => setScanOpen(true)}>
          <ScanLine className="size-4" /> Scan QR
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-1 md:hidden">
            {NAV.slice(0, 4).map(({ to, label, icon: Icon }) => (
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
                <Icon className="size-4" />
              </Link>
            ))}
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
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

        <main className="flex-1 px-4 py-8 md:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={handleScan} />
    </div>
  );
}
