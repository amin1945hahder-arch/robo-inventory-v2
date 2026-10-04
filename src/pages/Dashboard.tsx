import { useQuery } from "convex/react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { closetQr, projectQr } from "@/lib/qr";
import {
  Boxes,
  CircleDot,
  Clock,
  FolderKanban,
  Package,
  PackageCheck,
  ScanLine,
  TriangleAlert,
  Warehouse,
  Wrench,
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const overview = useQuery(api.stats.overview, {});
  const pending = useQuery(
    api.parts.listAllRentals,
    isAdmin ? { status: "pending" } : "skip",
  );
  const my = useQuery(api.parts.listMyRentals, {});
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const closets = useQuery(api.catalog.listClosets, {});


  const myActive = (my ?? []).filter((r) => r.rental.status === "active");
  const myPending = (my ?? []).filter((r) => r.rental.status === "pending");
  const myOnProject = (my ?? []).filter((r) => r.rental.status === "on_project");

  const statCards = isAdmin
    ? [
        { label: "Pending requests", value: overview?.pendingRequests ?? 0, icon: Clock, to: "/admin/requests", tone: "text-amber-400" },
        { label: "Units available", value: overview?.available ?? 0, icon: PackageCheck, to: "/inventory", tone: "text-emerald-400" },
        { label: "Out on rental", value: overview?.rented ?? 0, icon: Package, to: "/admin/requests", tone: "text-sky-400" },
        { label: "On projects", value: overview?.onProject ?? 0, icon: FolderKanban, to: "/projects", tone: "text-violet-400" },
        { label: "Broken units", value: overview?.broken ?? 0, icon: Wrench, to: "/inventory", tone: "text-rose-400" },
        { label: "Active projects", value: overview?.projects ?? 0, icon: CircleDot, to: "/projects", tone: "text-primary" },
      ]
    : [
        { label: "My active rentals", value: myActive.length, icon: Package, to: "/rentals", tone: "text-sky-400" },
        { label: "Awaiting approval", value: myPending.length, icon: Clock, to: "/rentals", tone: "text-amber-400" },
        { label: "On my projects", value: myOnProject.length, icon: FolderKanban, to: "/projects", tone: "text-violet-400" },
        { label: "Units available", value: overview?.available ?? 0, icon: PackageCheck, to: "/inventory", tone: "text-emerald-400" },
      ];

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-4 wide:flex-row wide:items-end">
          <div>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? "Lab admin console" : "Welcome back"}
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              {isAdmin ? "Control room" : `Hi ${user?.name?.split(" ")[0] ?? "maker"} 👋`}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/rent-scan">
                <ScanLine className="size-4" /> Scan to rent
              </Link>
            </Button>
            <Button asChild>
              <Link to="/inventory">Browse inventory</Link>
            </Button>
          </div>
        </header>

        {/* stat cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {statCards.map(({ label, value, icon: Icon, to, tone }) => (
            <Link key={label} to={to}>
              <Card className="group relative overflow-hidden border-border/80">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className={`icon-glass flex size-11 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                    <Icon className="icon-3d size-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* pending requests (admin) or my requests (member) */}
          <section className="glass-3d rounded-lg">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold">
                {isAdmin ? "Pending rental requests" : "My requests"}
              </h2>
              <Link
                to={isAdmin ? "/admin/requests" : "/rentals"}
                className="text-xs text-muted-foreground underline"
              >
                View all
              </Link>
            </div>
            {pending === undefined || my === undefined ? (
              <LoadingGif size={40} label={null} />
            ) : isAdmin && pending.length > 0 ? (
              <ul className="divide-y">
                {pending.slice(0, 5).map(({ rental, part, group, student }) => (
                  <li key={rental._id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {group?.name ?? "Part"} <span className="font-mono text-xs text-muted-foreground">{part?.tag}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {student?.name ?? student?.email ?? "Member"} ·{" "}
                        {new Date(rental.requestedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusBadge status="pending" />
                  </li>
                ))}
              </ul>
            ) : isAdmin ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">All caught up 🎉</p>
            ) : myPending.length === 0 && myActive.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nothing yet — <Link to="/inventory" className="underline">find a part</Link> and request it.
              </p>
            ) : (
              <ul className="divide-y">
                {[...myPending, ...myActive].slice(0, 5).map(({ rental, part, group }) => (
                  <li key={rental._id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{group?.name ?? "Part"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{part?.tag}</p>
                    </div>
                    <StatusBadge status={rental.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* quick links */}
          <section className="glass-3d rounded-lg">
            <div className="border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Quick access</h2>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border">
              <Link to="/inventory" className="flex flex-col gap-1 bg-background px-5 py-4 transition-colors hover:bg-muted/60">
                <Boxes className="size-4 text-primary" />
                <p className="text-sm font-medium">Inventory</p>
                <p className="text-xs text-muted-foreground">{overview?.groups ?? 0} component groups</p>
              </Link>
              <Link to="/closets" className="flex flex-col gap-1 bg-background px-5 py-4 transition-colors hover:bg-muted/60">
                <Warehouse className="size-4 text-primary" />
                <p className="text-sm font-medium">Storages</p>
                <p className="text-xs text-muted-foreground">{closets?.length ?? 0} storage locations</p>
              </Link>
              <Link to="/projects" className="flex flex-col gap-1 bg-background px-5 py-4 transition-colors hover:bg-muted/60">
                <FolderKanban className="size-4 text-primary" />
                <p className="text-sm font-medium">Projects</p>
                <p className="text-xs text-muted-foreground">{projects?.length ?? 0} active builds</p>
              </Link>
              <Link to="/rent-scan" className="flex flex-col gap-1 bg-background px-5 py-4 transition-colors hover:bg-muted/60">
                <ScanLine className="size-4 text-primary" />
                <p className="text-sm font-medium">Scan</p>
                <p className="text-xs text-muted-foreground">Rent, return or explore via QR</p>
              </Link>
            </div>
          </section>
        </div>

        {/* admin: notifications preview */}
        {isAdmin && (pending?.length ?? 0) > 0 && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 text-amber-400" />
            {pending?.length} request{pending?.length === 1 ? "" : "s"} waiting on you —
            <Link to="/admin/requests" className="underline">review now</Link>
          </p>
        )}

        {/* print QR labels for storages and projects straight from the dashboard */}
        {isAdmin && ((closets?.length ?? 0) > 0 || (projects?.length ?? 0) > 0) && (
          <section className="glass-3d rounded-lg p-5">
            <h2 className="text-sm font-semibold">Print lab labels</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Every storage and project has its own QR — print and stick them on the doors.
            </p>
            <div className="mt-4 flex flex-wrap gap-4">
              {(closets ?? []).map((c) => (
                <div key={c._id} className="flex items-center gap-2">
                  <QrChip payload={closetQr(c._id)} label={c.name} />
                  <span className="text-xs text-muted-foreground">{c.name}</span>
                </div>
              ))}
              {(projects ?? []).map((p) => (
                <div key={p._id} className="flex items-center gap-2">
                  <QrChip payload={projectQr(p._id)} label={p.name} />
                  <span className="text-xs text-muted-foreground">{p.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
