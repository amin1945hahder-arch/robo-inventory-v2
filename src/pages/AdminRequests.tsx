import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
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
import { Award, Boxes, Check, PackagePlus, Printer, RotateCcw, ScanLine, SquarePen, X } from "lucide-react";
import { EditRentalDialog } from "@/components/EditRentalDialog";
import {
  DocAttachmentField,
  type AttachedDoc,
} from "@/components/DocAttachmentField";

type Row = {
  rental: any;
  part: any;
  group: any;
  student: any;
};

export default function AdminRequests() {
  // Pending tab uses a grouped query: singles are one row each, pending
  // package units collapse into one row per package — badge and list always
  // match what is actually rendered.
  const pendingRowsQ = useQuery(api.parts.pendingRentalRows, {});
  const pendingSingles = (pendingRowsQ ?? []).filter((r: any) => r.kind === "single");
  const pendingPkgRows = (pendingRowsQ ?? []).filter((r: any) => r.kind === "package");
  const active = useQuery(api.parts.listAllRentals, { status: "active" });
  // Approved but not yet handed over — the pick-up stage.
  const awaiting = useQuery(api.parts.listAllRentals, { status: "approved" });
  const onProject = useQuery(api.parts.listAllRentals, { status: "on_project" });
  const history = useQuery(api.parts.listAllRentals, { status: "returned" });
  const packages = useQuery(api.parts.listPackages, { scope: "all" });
  const returnWholePkg = useMutation(api.parts.returnWholePackage);
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const profileReqs = useQuery(api.notifications.listProfileRequests, { status: "pending" });
  const decideProfile = useMutation(api.notifications.decideProfileRequest);
  const rankReqs = useQuery(api.users.listRankRequests, { status: "pending" });
  const decideRank = useMutation(api.users.decideRankRequest);
  const printerReqs = useQuery(api.users.listPrinterRequests, { status: "pending" });
  const decidePrinter = useMutation(api.users.decidePrinterRequest);
  // Unread admin notifications: listed below the tabs, marked read when this
  // page opens (and per-row on click) so the sidebar/header bubbles decrease
  // properly instead of only clearing when every row is actioned.
  const notifications = useQuery(api.notifications.listNotifications, {});
  const markAllRead = useMutation(api.notifications.markAllRead);
  const markRead = useMutation(api.notifications.markRead);
  const unread = (notifications ?? []).filter((n) => n.read !== true);

  useEffect(() => {
    if (unread.length === 0) return;
    markAllRead().catch(() => undefined);
    // markAllRead identity is stable; only re-run when the unread set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.length]);

  const act = useMutation(api.parts.adminRentalAction);
  const decidePkg = useMutation(api.parts.decidePackage);
  const unapproved = useQuery(api.users.listUnapprovedProfiles, {});
  // Scheduled pick-ups for approved rentals: reusable slots + a no-show list.
  const pickups = useQuery(api.parts.scheduledPickups, {});

  const [busyId, setBusyId] = useState<string | null>(null);
  // Approve flow: pick the pick-up date/time (or reuse a scheduled slot).
  const [approveFor, setApproveFor] = useState<Row | null>(null);
  const [editRentalFor, setEditRentalFor] = useState<any>(null);
  const [approvePkgFor, setApprovePkgFor] = useState<{ key: string; unitCount: number } | null>(null);
  const [pickupLocal, setPickupLocal] = useState("");
  const [approveBusy, setApproveBusy] = useState(false);
  const [returnFor, setReturnFor] = useState<Row | null>(null);
  const [destination, setDestination] = useState<"shelf" | "project" | "transferred">("shelf");
  const [functional, setFunctional] = useState(true);
  const [report, setReport] = useState("");
  const [projectId, setProjectId] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  // Transfer-out fields (destination name + details + doc file).
  const [transferName, setTransferName] = useState("");
  const [transferDetails, setTransferDetails] = useState("");
  const [transferDoc, setTransferDoc] = useState<AttachedDoc | null>(null);
  // Bulk consumable return: how much of the taken amount came back.
  const [recovered, setRecovered] = useState("");

  // Package units are decided as a bundle in the Packages tab (all-or-nothing).
  // The grouped pending query already collapses them into package rows.
  const pendingRows = pendingSingles;
  const pendingCount = pendingRowsQ?.length ?? 0;

  // Whole-package return from the Packages tab (admin one-click).
  const [wholeFor, setWholeFor] = useState<any | null>(null);
  const [wholeBusy, setWholeBusy] = useState(false);
  const [wholeDestination, setWholeDestination] = useState<"shelf" | "project" | "transferred">("shelf");
  const [wholeFunctional, setWholeFunctional] = useState(true);
  const [wholeReport, setWholeReport] = useState("");
  const [wholeProjectId, setWholeProjectId] = useState("");
  const [wholeCreatingProject, setWholeCreatingProject] = useState(false);
  const [wholeNewProjectName, setWholeNewProjectName] = useState("");
  const [wholeTransferName, setWholeTransferName] = useState("");
  const [wholeTransferDetails, setWholeTransferDetails] = useState("");
  const createProject = useMutation(api.projects.upsertProject);

  const wholeValid =
    wholeDestination === "shelf"
      ? true
      : wholeDestination === "transferred"
        ? wholeTransferName.trim().length > 1
        : wholeCreatingProject
          ? wholeNewProjectName.trim().length > 1
          : Boolean(wholeProjectId);

  const submitWholeReturn = async () => {
    if (!wholeFor || !wholeValid) return;
    setWholeBusy(true);
    try {
      let target = wholeProjectId;
      if (wholeDestination === "project" && wholeCreatingProject) {
        target = await createProject({ name: wholeNewProjectName.trim(), status: "active" });
      }
      const res = await returnWholePkg({
        packageId: wholeFor.package._id,
        destination: wholeDestination,
        projectId: wholeDestination === "project" ? (target as any) : undefined,
        functional: wholeFunctional,
        conditionReport: wholeReport.trim() || undefined,
        ...(wholeDestination === "transferred"
          ? {
              transferToName: wholeTransferName.trim(),
              transferDetails: wholeTransferDetails.trim() || undefined,
            }
          : {}),
      });
      toast.success(
        `${res.processed} unit(s) ${wholeDestination === "transferred" ? `transferred to “${wholeTransferName.trim()}”` : wholeDestination === "project" ? "assigned to the project" : wholeFunctional ? "back on the shelf" : "marked broken"}`,
      );
      setWholeFor(null);
      setWholeReport("");
      setWholeProjectId("");
      setWholeCreatingProject(false);
      setWholeNewProjectName("");
      setWholeTransferName("");
      setWholeTransferDetails("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setWholeBusy(false);
    }
  };

  const deny = async (row: Row) => {
    setBusyId(row.rental._id);
    try {
      await act({ rentalId: row.rental._id, action: "deny" });
      toast.success("Denied — unit back on shelf");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  // Approve opens the pick-up scheduling dialog (date+time is optional but
  // recommended — it drives the Telegram reminders and the group post).
  const submitApprove = async () => {
    if (!approveFor) return;
    setApproveBusy(true);
    try {
      const pickupAt = pickupLocal ? new Date(pickupLocal).getTime() : undefined;
      await act({
        rentalId: approveFor.rental._id,
        action: "approve",
        pickupAt: Number.isFinite(pickupAt as number) ? pickupAt : undefined,
      });
      toast.success(
        pickupLocal
          ? "Approved — pick-up scheduled, member and group notified with the PDF"
          : "Approved — member notified",
      );
      setApproveFor(null);
      setPickupLocal("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setApproveBusy(false);
    }
  };

  const decidePackageAction = async (approve: boolean) => {
    if (!approvePkgFor) return;
    setApproveBusy(true);
    try {
      const pickupAt = pickupLocal ? new Date(pickupLocal).getTime() : undefined;
      await decidePkg({
        packageId: approvePkgFor.key as any,
        approve,
        pickupAt: Number.isFinite(pickupAt as number) ? pickupAt : undefined,
      });
      toast.success(
        approve
          ? pickupLocal
            ? "Package approved — pick-up scheduled, member and group notified"
            : "Package approved — member notified"
          : "Package denied — units released",
      );
      setApprovePkgFor(null);
      setPickupLocal("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setApproveBusy(false);
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
      } else if (destination === "transferred") {
        await act({
          rentalId: returnFor.rental._id,
          action: "transfer",
          transferToName: transferName.trim(),
          transferDetails: transferDetails.trim() || undefined,
          transferDoc: transferDoc ?? undefined,
          functional,
          conditionReport: report.trim() || undefined,
        });
        toast.success(`Transferred to “${transferName.trim()}” — kept on record`);
      } else {
        const taken = returnFor.rental.amount;
        const isBulkRow = returnFor.group?.measure === "weight" || returnFor.group?.measure === "length";
        const consumableRow = isBulkRow && taken !== undefined;
        const recoveredNum =
          consumableRow && recovered.trim() !== "" ? Number(recovered) : undefined;
        if (recoveredNum !== undefined) {
          if (!Number.isFinite(recoveredNum) || recoveredNum < 0) {
            toast.error(`Enter the recovered amount in ${returnFor.group?.measureUnit ?? "units"}`);
            setBusyId(null);
            return;
          }
          if (recoveredNum > taken + 1e-9) {
            toast.error(`Recovered cannot exceed the taken ${taken} ${returnFor.group?.measureUnit ?? ""}`);
            setBusyId(null);
            return;
          }
        }
        await act({
          rentalId: returnFor.rental._id,
          action: "mark_returned",
          functional,
          conditionReport: report.trim() || undefined,
          ...(recoveredNum !== undefined ? { recoveredAmount: recoveredNum } : {}),
        });
        toast.success(functional ? "Returned to shelf" : "Marked broken");
      }
      setReturnFor(null);
      setReport("");
      setProjectId("");
      setCreatingProject(false);
      setNewProjectName("");
      setTransferName("");
      setTransferDetails("");
      setTransferDoc(null);
      setRecovered("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const RowCard = ({ row, actions }: { row: Row; actions: React.ReactNode }) => (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar className="size-8 shrink-0">
        <AvatarImage src={row.student?.image} />
        <AvatarFallback className="text-xs font-semibold">
          {(row.student?.name ?? row.student?.email ?? "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
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
              Pending {pendingCount ? `(${pendingCount})` : ""}
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
            <TabsTrigger value="printers">
              Printer {printerReqs?.length ? `(${printerReqs.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="profiles">
              Profiles
              {(profileReqs?.length ?? 0) + (unapproved?.length ?? 0)
                ? `(${(profileReqs?.length ?? 0) + (unapproved?.length ?? 0)})`
                : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            {/* Scheduled pick-ups: awaiting handover, with reminder countdown. */}
            {(pickups ?? []).length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">
                  Scheduled pick-ups · {(pickups ?? []).length}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {(pickups ?? []).map((p) => (
                    <li key={p.rentalId} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{p.groupName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.tag}</span>
                      <span className="text-muted-foreground">· {p.studentName}</span>
                      <span className="text-amber-400">
                        · {p.pickupAt ? new Date(p.pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "no time set"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Members are reminded 24h and 1h before. Mark them as taken from the Active tab or
                  by scanning the unit.
                </p>
              </div>
            )}
            {pendingRowsQ === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : pendingRows.length === 0 && pendingPkgRows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No pending requests — all clear ✨
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {pendingRows.map((row: any) => (
                  <RowCard
                    key={row.key}
                    row={row as Row}
                    actions={
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditRentalFor(row.rental)}
                          title="Edit or delete this record"
                        >
                          <SquarePen className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditRentalFor(row.rental)}
                          title="Edit or delete this record"
                        >
                          <SquarePen className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === row.key}
                          onClick={() => {
                            setApproveFor(row as Row);
                            setPickupLocal("");
                          }}
                        >
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.key}
                          onClick={() => deny(row as Row)}
                        >
                          <X className="size-4" /> Deny
                        </Button>
                      </div>
                    }
                  />
                ))}
                {pendingPkgRows.map((row: any) => (
                  <li key={row.key} className="rounded-lg border border-primary/30 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Boxes className="size-5 shrink-0 text-primary" />
                      <Avatar className="size-8 shrink-0">
                        <AvatarImage src={row.student?.image} />
                        <AvatarFallback className="text-xs font-semibold">
                          {(row.student?.name ?? row.student?.email ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          Package · {row.units.length} unit(s)
                          {row.packageNote ? ` · “${row.packageNote}”` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.units.map((u: any) => u.groupName).join(" · ")} ·{" "}
                          {new Date(row.package.requestedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={approveBusy}
                          onClick={() => {
                            setApprovePkgFor({ key: row.key, unitCount: row.units.length });
                            setPickupLocal("");
                          }}
                        >
                          <Check className="size-4" /> Approve all
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approveBusy}
                          onClick={() => {
                            setApprovePkgFor({ key: row.key, unitCount: row.units.length });
                            setPickupLocal("");
                          }}
                        >
                          <X className="size-4" /> Deny
                        </Button>
                      </div>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                      {row.units.map((u: any) => (
                        <li key={u.rentalId}>
                          <button
                            type="button"
                            onClick={() => setEditRentalFor({ ...u, _id: u.rentalId })}
                            title="Edit or delete this record"
                            className="rounded border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                          >
                            {u.tag ?? "?"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
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
                      <Avatar className="size-8 shrink-0">
                        <AvatarImage src={requester?.image} />
                        <AvatarFallback className="text-xs font-semibold">
                          {(requester?.name ?? requester?.email ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
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
                            disabled={approveBusy}
                            onClick={() => {
                              setApprovePkgFor({ key: pkg._id, unitCount: totalUnits });
                              setPickupLocal("");
                            }}
                          >
                            <Check className="size-4" /> Approve all
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={approveBusy}
                            onClick={() => {
                              setApprovePkgFor({ key: pkg._id, unitCount: totalUnits });
                              setPickupLocal("");
                            }}
                          >
                            <X className="size-4" /> Deny
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          {pkg.status === "approved" && openUnits > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                              disabled={busyId === pkg._id}
                              onClick={() => {
                                setWholeFor({ package: pkg });
                                setWholeDestination("shelf");
                                setWholeFunctional(true);
                                setWholeReport("");
                                setWholeProjectId("");
                                setWholeCreatingProject(false);
                                setWholeNewProjectName("");
                              }}
                            >
                              <RotateCcw className="size-4" /> Return all units
                            </Button>
                          )}
                          <StatusBadge status={pkg.status === "approved" ? "active" : "canceled"} />
                        </div>
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
                              {(u.status === "active" || u.status === "on_project") && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 gap-1 px-2 text-[11px]"
                                  title="Edit or delete this record"
                                  onClick={() => setEditRentalFor({ ...u, _id: u.rentalId })}
                                >
                                  <SquarePen className="size-3.5" />
                                </Button>
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
                                    setTransferName("");
                                    setTransferDetails("");
                                    setTransferDoc(null);
                                    setRecovered("");
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
            {/* Awaiting pick-up: approved, not yet handed over. */}
            {(awaiting ?? []).length > 0 && (
              <section className="mb-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
                  Awaiting pick-up · {(awaiting ?? []).length}
                </h2>
                <ul className="divide-y rounded-lg border border-amber-500/30">
                  {(awaiting ?? []).map((row) => (
                    <RowCard
                      key={row.rental._id}
                      row={row as Row}
                      actions={
                        <div className="flex flex-col items-end gap-1">
                          {row.rental.pickupAt && (
                            <span className="text-[11px] text-amber-400">
                              📅 {new Date(row.rental.pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditRentalFor(row.rental)}
                            title="Edit or delete this record"
                          >
                            <SquarePen className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            disabled={busyId === row.rental._id}
                            onClick={async () => {
                              setBusyId(row.rental._id);
                              try {
                                await act({ rentalId: row.rental._id, action: "mark_taken" });
                                toast.success("Marked as picked up — unit is now rented");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed");
                              } finally {
                                setBusyId(null);
                              }
                            }}
                          >
                            <Check className="size-4" /> Mark picked up
                          </Button>
                        </div>
                      }
                    />
                  ))}
                </ul>
              </section>
            )}
            {active === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : active.length === 0 && (awaiting?.length ?? 0) === 0 ? (
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
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditRentalFor(row.rental)} title="Edit or delete this record">
                          <SquarePen className="size-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => {
                        setReturnFor(row as Row);
                        setDestination("shelf");
                        setFunctional(true);
                        setReport("");
                        setProjectId("");
                        setCreatingProject(false);
                        setNewProjectName("");
                        setTransferName("");
                        setTransferDetails("");
                        setTransferDoc(null);
                        setRecovered("");
                        setDestination("shelf");
                        setFunctional(true);
                        setReport("");
                        setProjectId("");
                        setCreatingProject(false);
                        setNewProjectName("");
                      }}>
                        <RotateCcw className="size-4" /> Process return
                      </Button>
                      </div>
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
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditRentalFor(row.rental)} title="Edit or delete this record">
                          <SquarePen className="size-4" />
                        </Button>
                        <StatusBadge status="on_project" />
                      </div>
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
                    actions={
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditRentalFor(row.rental)}
                          title="Edit or delete this record"
                        >
                          <SquarePen className="size-4" />
                        </Button>
                        <StatusBadge status={row.rental.status} />
                      </div>
                    }
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

          <TabsContent value="printers" className="mt-4">
            {printerReqs === undefined ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : printerReqs.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No printer-access requests — members can send them from their profile page.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {printerReqs.map(({ request, user }) => (
                  <li key={request._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Printer className="size-4 shrink-0 text-cyan-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user?.name ?? user?.email ?? "(removed)"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        requests printer access{request.message ? ` — “${request.message}”` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={busyId === request._id}
                      onClick={async () => {
                        setBusyId(request._id);
                        try {
                          await decidePrinter({ id: request._id, approve: true });
                          toast.success("Printer access granted");
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
                          await decidePrinter({ id: request._id, approve: false });
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

        {editRentalFor && (
          <EditRentalDialog
            open={Boolean(editRentalFor)}
            onOpenChange={(v) => !v && setEditRentalFor(null)}
            rental={editRentalFor}
          />
        )}

        {/* Admin notifications: newest first; opening this page marks them read
            (bubbles in the sidebar/header decrease), tapping a row marks just
            that one. */}
        {notifications !== undefined && notifications.length > 0 && (
          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {unread.length > 0 && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white">
                  {unread.length} new
                </span>
              )}
            </div>
            <ul className="divide-y">
              {notifications.slice(0, 20).map((n) => (
                <li key={n._id}>
                  <button
                    type="button"
                    onClick={() => n.read !== true && markRead({ id: n._id })}
                    className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                      n.read !== true ? "bg-primary/5" : "opacity-70"
                    }`}
                  >
                    {n.read !== true ? (
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{n.text}</span>
                    {n.link && (
                      <Link
                        to={n.link}
                        className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open
                      </Link>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(n._creationTime).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
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
              onValueChange={(v) => setDestination(v as "shelf" | "project" | "transferred")}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "shelf" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="shelf" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Return to shelf</p>
                  <p className="text-xs text-muted-foreground">Back to its storage, rentable again.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "project" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="project" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Assign to project</p>
                  <p className="text-xs text-muted-foreground">Stays checked out until dismantled.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "transferred" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="transferred" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Transferred to</p>
                  <p className="text-xs text-muted-foreground">Handed to another dept/lab — kept on record.</p>
                </div>
              </label>
            </RadioGroup>

            {destination === "transferred" && (
              <div className="flex flex-col gap-2">
                <Label>Transfer destination name</Label>
                <Input
                  value={transferName}
                  onChange={(e) => setTransferName(e.target.value)}
                  placeholder="e.g. Mechatronics dept., Al-Amal school lab…"
                />
                <Label>Details</Label>
                <Textarea
                  value={transferDetails}
                  onChange={(e) => setTransferDetails(e.target.value)}
                  placeholder="Who received it, why, reference number…"
                  rows={2}
                />
                <DocAttachmentField doc={transferDoc} onChange={setTransferDoc} />
              </div>
            )}

            {destination === "shelf" &&
              (returnFor?.group?.measure === "weight" || returnFor?.group?.measure === "length") &&
              returnFor?.rental?.amount !== undefined && (
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                  <Label>
                    Amount recovered ({returnFor.group.measureUnit ?? ""}) — taken: {returnFor.rental.amount}{" "}
                    {returnFor.group.measureUnit ?? ""}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={recovered}
                    onChange={(e) => setRecovered(e.target.value)}
                    placeholder={`What physically came back (≤ ${returnFor.rental.amount})`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to shelve all of it. The difference is logged as consumed.
                  </p>
                </div>
              )}

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

      {/* Whole-package return: one decision for every active unit of the bundle */}
      <Dialog open={Boolean(wholeFor)} onOpenChange={(v) => !v && setWholeFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Return the whole package</DialogTitle>
            <DialogDescription>
              Every active unit of this bundle gets the same destination and condition. For
              per-unit fine-tuning, use the individual Return buttons on the unit rows.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <RadioGroup
              value={wholeDestination}
              onValueChange={(v) => setWholeDestination(v as "shelf" | "project" | "transferred")}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${wholeDestination === "shelf" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="shelf" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Return to shelf</p>
                  <p className="text-xs text-muted-foreground">All units back in their storages (or marked broken).</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${wholeDestination === "project" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="project" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Assign to project</p>
                  <p className="text-xs text-muted-foreground">Everything stays checked out until dismantled.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${wholeDestination === "transferred" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="transferred" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Transferred to</p>
                  <p className="text-xs text-muted-foreground">All units handed to another dept/lab.</p>
                </div>
              </label>
            </RadioGroup>

            {wholeDestination === "transferred" && (
              <div className="flex flex-col gap-2">
                <Label>Transfer destination name</Label>
                <Input
                  value={wholeTransferName}
                  onChange={(e) => setWholeTransferName(e.target.value)}
                  placeholder="e.g. Mechatronics dept., Al-Amal school lab…"
                />
                <Label>Details</Label>
                <Textarea
                  value={wholeTransferDetails}
                  onChange={(e) => setWholeTransferDetails(e.target.value)}
                  placeholder="Who received everything, why, reference number…"
                  rows={2}
                />
              </div>
            )}

            {wholeDestination === "project" && (
              <div className="flex flex-col gap-2">
                <Label>Project</Label>
                {!wholeCreatingProject ? (
                  <div className="flex gap-2">
                    <Select value={wholeProjectId} onValueChange={setWholeProjectId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an active project" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((p) => (
                          <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => setWholeCreatingProject(true)}>
                      New
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      className="flex-1"
                      value={wholeNewProjectName}
                      onChange={(e) => setWholeNewProjectName(e.target.value)}
                      placeholder="New project name"
                    />
                    <Button type="button" variant="outline" onClick={() => setWholeCreatingProject(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Condition check (applies to every unit)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={wholeFunctional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setWholeFunctional(true)}
                >
                  Works fine
                </Button>
                <Button
                  type="button"
                  variant={!wholeFunctional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setWholeFunctional(false)}
                >
                  Needs repair
                </Button>
              </div>
              <Textarea
                value={wholeReport}
                onChange={(e) => setWholeReport(e.target.value)}
                placeholder="Anything to note? (applied to every unit)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWholeFor(null)}>Cancel</Button>
            <Button onClick={submitWholeReturn} disabled={!wholeValid || wholeBusy}>
              <RotateCcw className="size-4" /> {wholeBusy ? "Processing…" : "Process all units"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Approve: schedule the pick-up ===== */}
      <Dialog open={Boolean(approveFor)} onOpenChange={(v) => !v && setApproveFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve &amp; schedule pick-up</DialogTitle>
            <DialogDescription>
              {approveFor && (
                <>
                  {approveFor.group?.name ?? "Part"} ({approveFor.part?.tag}) for{" "}
                  {approveFor.student?.name ?? approveFor.student?.email ?? "a member"}.
                </>
              )}
              {" "}They'll be notified with the date, and reminded 24h and 1h before on Telegram.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pickup-at">Pick-up date &amp; time</Label>
              <Input
                id="pickup-at"
                type="datetime-local"
                value={pickupLocal}
                onChange={(e) => setPickupLocal(e.target.value)}
              />
            </div>
            {(pickups ?? []).length > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  Or reuse an existing scheduled slot
                </Label>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                  {(pickups ?? [])
                    .filter((p) => p.pickupAt)
                    .slice(0, 6)
                    .map((p) => (
                      <button
                        key={p.rentalId}
                        type="button"
                        className="rounded-md border px-3 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-muted/50"
                        onClick={() => {
                          const d = new Date(p.pickupAt!);
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setPickupLocal(
                            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                          );
                        }}
                      >
                        📅 {new Date(p.pickupAt!).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                        <span className="text-muted-foreground"> — {p.studentName} · {p.groupName}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Leaving it empty means "come whenever the lab is open" — no reminders will be sent.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveFor(null)}>Cancel</Button>
            <Button onClick={submitApprove} disabled={approveBusy}>
              <Check className="size-4" /> {approveBusy ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Approve / deny a package: schedule the pick-up ===== */}
      <Dialog open={Boolean(approvePkgFor)} onOpenChange={(v) => !v && setApprovePkgFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Package · schedule pick-up</DialogTitle>
            <DialogDescription>
              {approvePkgFor && (
                <>All {approvePkgFor.unitCount} unit(s) stay reserved until the member picks them up — hand each over with “Mark picked up”, then process returns unit by unit.</>
              )}{" "}
              They'll be notified with the date, and reminded 24h and 1h before on Telegram.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pkg-pickup-at">Pick-up date &amp; time</Label>
              <Input
                id="pkg-pickup-at"
                type="datetime-local"
                value={pickupLocal}
                onChange={(e) => setPickupLocal(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leaving it empty means "come whenever the lab is open" — no reminders will be sent.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setApprovePkgFor(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => decidePackageAction(false)} disabled={approveBusy}>
              <X className="size-4" /> Deny
            </Button>
            <Button onClick={() => decidePackageAction(true)} disabled={approveBusy}>
              <Check className="size-4" /> {approveBusy ? "Approving…" : "Approve all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
