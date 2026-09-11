import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Award, Boxes, Check, PackagePlus, RotateCcw, ScanLine, X } from "lucide-react";

type Row = {
  rental: any;
  part: any;
  group: any;
  student: any;
};

export default function AdminRequests() {
  const pending = useQuery(api.parts.listAllRentals, { status: "pending" });
  const active = useQuery(api.parts.listAllRentals, { status: "active" });
  const onProject = useQuery(api.parts.listAllRentals, { status: "on_project" });
  const history = useQuery(api.parts.listAllRentals, { status: "returned" });
  const packages = useQuery(api.parts.listPackages, { scope: "all" });
  const profileReqs = useQuery(api.notifications.listProfileRequests, { status: "pending" });
  const decideProfile = useMutation(api.notifications.decideProfileRequest);
  const rankReqs = useQuery(api.users.listRankRequests, { status: "pending" });
  const decideRank = useMutation(api.users.decideRankRequest);

  const act = useMutation(api.parts.adminRentalAction);
  const decidePkg = useMutation(api.parts.decidePackage);
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const unapproved = useQuery(api.users.listUnapprovedProfiles, {});

  const [busyId, setBusyId] = useState<string | null>(null);
  const [returnFor, setReturnFor] = useState<Row | null>(null);
  const [destination, setDestination] = useState<"shelf" | "project">("shelf");
  const [functional, setFunctional] = useState(true);
  const [report, setReport] = useState("");
  const [projectId, setProjectId] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const createProject = useMutation(api.projects.upsertProject);

  const decide = async (row: Row, approve: boolean) => {
    setBusyId(row.rental._id);
    try {
      await act({ rentalId: row.rental._id, action: approve ? "approve" : "deny" });
      toast.success(approve ? "Approved — student notified" : "Denied — unit back on shelf");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const decidePackageAction = async (packageId: string, approve: boolean) => {
    setBusyId(packageId);
    try {
      await decidePkg({ packageId: packageId as any, approve });
      toast.success(approve ? "Package approved — member notified" : "Package denied — units released");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const validReturn = useMemo(
    () =>
      destination === "shelf" || creatingProject
        ? true
        : destination === "project"
          ? Boolean(projectId) || newProjectName.trim().length > 1
          : false,
    [destination, projectId, creatingProject, newProjectName],
  );

  const submitReturn = async () => {
    if (!returnFor) return;
    setBusyId(returnFor.rental._id);
    try {
      if (destination === "project") {
        let target = projectId;
        if (creatingProject) {
          target = await createProject({ name: newProjectName.trim(), status: "active" });
        }
        await act({
          rentalId: returnFor.rental._id,
          action: "assign_project",
          projectId: target as any,
          functional,
          conditionReport: report.trim() || undefined,
        });
        toast.success("Assigned to project — checked out until dismantled");
      } else {
        await act({
          rentalId: returnFor.rental._id,
          action: "mark_returned",
          functional,
          conditionReport: report.trim() || undefined,
        });
        toast.success(functional ? "Returned to shelf" : "Marked broken");
      }
      setReturnFor(null);
      setReport("");
      setProjectId("");
      setCreatingProject(false);
      setNewProjectName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const RowCard = ({ row, actions }: { row: Row; actions: React.ReactNode }) => (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {row.group?.name ?? "Part"}{" "}
          <span className="font-mono text-xs text-muted-foreground">{row.part?.tag}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {row.student?.name ?? row.student?.email ?? "Member"}
          {row.student?.studentId ? ` · ${row.student.studentId}` : ""} ·{" "}
          {new Date(row.rental.requestedAt).toLocaleDateString()}
        </p>
        {row.rental.status === "active" && row.rental.returnRequestedAt !== undefined && (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-500">
            <RotateCcw className="size-3.5" />
            Member asked to return this · {new Date(row.rental.returnRequestedAt).toLocaleString()}
          </p>
        )}
      </div>
      {actions}
    </li>
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Requests & rentals</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve or deny requests, process returns, and track project assignments.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/rent-scan">
              <ScanLine className="size-4" /> Scan mode
            </Link>
          </Button>
        </header>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending {pending?.length ? `(${pending.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="packages">
              Packages {(packages ?? []).filter((p) => p.package.status === "pending").length
                ? `(${(packages ?? []).filter((p) => p.package.status === "pending").length})`
                : ""}
            </TabsTrigger>
            <TabsTrigger value="active">
              Active {active?.length ? `(${active.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="projects">
              On projects {onProject?.length ? `(${onProject.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="ranks">
              Ranks {rankReqs?.length ? `(${rankReqs.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="profiles">
              Profiles
              {(profileReqs?.length ?? 0) + (unapproved?.length ?? 0)
                ? `(${(profileReqs?.length ?? 0) + (unapproved?.length ?? 0)})`
                : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            {pending === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : pending.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No pending requests — all clear ✨
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {pending.map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    actions={
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === row.rental._id}
                          onClick={() => decide(row as Row, true)}
                        >
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.rental._id}
                          onClick={() => decide(row as Row, false)}
                        >
                          <X className="size-4" /> Deny
                        </Button>
                      </div>
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="packages" className="mt-4">
            {packages === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : packages.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No package rentals yet — members bundle multiple items from a group page.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {packages.map(({ package: pkg, lines, requester, openUnits, totalUnits, returnedUnits }) => (
                  <li key={pkg._id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Boxes className="size-5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {lines.map((l: any) => `${l.requested}× ${l.groupName}`).join(" · ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {requester?.name ?? requester?.email ?? "Member"}
                          {requester?.studentId ? ` · ${requester.studentId}` : ""} ·{" "}
                          {new Date(pkg.requestedAt).toLocaleString()} · {totalUnits} unit(s)
                          {pkg.status === "approved"
                            ? ` · ${openUnits} out, ${returnedUnits} processed`
                            : ""}
                          {pkg.note ? ` · “${pkg.note}”` : ""}
                        </p>
                        {pkg.status === "approved" && pkg.returnRequestedAt !== undefined && (
                          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-500">
                            <RotateCcw className="size-3.5" />
                            Member asked to return this package ·{" "}
                            {new Date(pkg.returnRequestedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {pkg.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busyId === pkg._id}
                            onClick={() => decidePackageAction(pkg._id, true)}
                          >
                            <Check className="size-4" /> Approve all
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === pkg._id}
                            onClick={() => decidePackageAction(pkg._id, false)}
                          >
                            <X className="size-4" /> Deny
                          </Button>
                        </div>
                      ) : (
                        <StatusBadge status={pkg.status === "approved" ? "active" : "canceled"} />
                      )}
                    </div>
                    <ul className="mt-3 flex flex-col gap-1 border-t pt-3">
                      {lines.map((l: any) =>
                        l.units.length === 0 ? (
                          <li key={l.groupId} className="text-xs text-muted-foreground">
                            {l.groupName}: no units attached yet
                          </li>
                        ) : (
                          l.units.map((u: any) => (
                            <li key={u.rentalId} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono">{u.tag}</span>
                              <StatusBadge status={u.status} />
                              {u.rentBroken && (
                                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                                  broken
                                </span>
                              )}
                              {u.status === "active" && u.returnRequestedAt !== undefined && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                                  return asked
                                </span>
                              )}
                              {u.status === "active" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="ml-auto h-6 gap-1 px-2 text-[11px]"
                                  disabled={busyId === u.rentalId}
                                  onClick={() => {
                                    // Reuse the shared per-unit return dialog:
                                    // every unit of a package is decided
                                    // individually (shelf / project / broken).
                                    setReturnFor({
                                      rental: { _id: u.rentalId },
                                      part: { tag: u.tag },
                                      group: { name: l.groupName },
                                      student: requester,
                                    } as Row);
                                    setDestination("shelf");
                                    setFunctional(true);
                                    setReport("");
                                    setProjectId("");
                                    setCreatingProject(false);
                                    setNewProjectName("");
                                  }}
                                >
                                  <RotateCcw className="size-3" /> Return
                                </Button>
                              )}
                            </li>
                          ))
                        ),
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="active" className="mt-4">
            {active === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : active.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                Nothing is out on rental right now.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {active.map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    actions={
                      <Button size="sm" variant="outline" onClick={() => {
                        setReturnFor(row as Row);
                        setDestination("shelf");
                        setFunctional(true);
                        setReport("");
                        setProjectId("");
                        setCreatingProject(false);
                        setNewProjectName("");
                      }}>
                        <RotateCcw className="size-4" /> Process return
                      </Button>
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="projects" className="mt-4">
            {onProject === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : onProject.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No parts are checked out to projects.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {onProject.map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    actions={
                      <StatusBadge status="on_project" />
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {history === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : history.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No completed rentals yet.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {history.slice(0, 40).map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    actions={<StatusBadge status={row.rental.status} />}
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="ranks" className="mt-4">
            {rankReqs === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : rankReqs.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No rank requests — members can send them from their profile page.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {rankReqs.map(({ request, user }) => (
                  <li key={request._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Award className="size-4 shrink-0 text-violet-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user?.name ?? user?.email ?? "(removed)"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        wants: {request.requestedRoles.join(" · ")}
                        {request.message ? ` — “${request.message}”` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={busyId === request._id}
                      onClick={async () => {
                        setBusyId(request._id);
                        try {
                          await decideRank({ id: request._id, approve: true });
                          toast.success("Positions granted");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      <Check className="size-4" /> Grant
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === request._id}
                      onClick={async () => {
                        setBusyId(request._id);
                        try {
                          await decideRank({ id: request._id, approve: false });
                          toast.success("Request denied");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="profiles" className="mt-4">
            {profileReqs === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : profileReqs.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No profile change requests.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {profileReqs.map(({ request, user }) => (
                  <li key={request._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user?.name ?? user?.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {Object.entries(request.payload)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await decideProfile({ id: request._id, approve: true });
                          toast.success("Profile updated");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        }
                      }}
                    >
                      <Check className="size-4" /> Apply
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await decideProfile({ id: request._id, approve: false });
                          toast.success("Request denied");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        }
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Return / assign dialog */}
      <Dialog open={Boolean(returnFor)} onOpenChange={(v) => !v && setReturnFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Process return</DialogTitle>
            <DialogDescription>
              {returnFor?.group?.name} — unit {returnFor?.part?.tag}. Choose where it goes next and
              record its condition.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <RadioGroup
              value={destination}
              onValueChange={(v) => setDestination(v as "shelf" | "project")}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "shelf" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="shelf" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Return to shelf</p>
                  <p className="text-xs text-muted-foreground">Back to its closet, rentable again.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "project" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="project" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Assign to project</p>
                  <p className="text-xs text-muted-foreground">Stays checked out until dismantled.</p>
                </div>
              </label>
            </RadioGroup>

            {destination === "project" && (
              <div className="flex flex-col gap-2">
                <Label>Project</Label>
                {!creatingProject ? (
                  <div className="flex gap-2">
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an active project" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((p) => (
                          <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => setCreatingProject(true)}>
                      New
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      className="flex h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="New project name"
                    />
                    <Button type="button" variant="outline" onClick={() => setCreatingProject(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Condition check</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={functional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFunctional(true)}
                >
                  Works fine
                </Button>
                <Button
                  type="button"
                  variant={!functional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFunctional(false)}
                >
                  Needs repair
                </Button>
              </div>
              <Textarea
                value={report}
                onChange={(e) => setReport(e.target.value)}
                placeholder="Anything to note? (missing cable, scratched pins…)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnFor(null)}>Cancel</Button>
            <Button onClick={submitReturn} disabled={!validReturn || busyId !== null}>
              <PackagePlus className="size-4" /> Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
