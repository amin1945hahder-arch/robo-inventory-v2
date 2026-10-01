import { useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import {
  Activity,
  Archive,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Cog,
  Cpu,
  EllipsisVertical,
  HardDrive,
  Layers,
  LifeBuoy,
  Loader2,
  Package,
  Plus,
  Printer,
  TriangleAlert,
  Video,
  Wrench,
  X,
} from "lucide-react";
import { SlicerStudio } from "@/components/printing/SlicerStudio";
import { NewJobDialog } from "@/components/printing/NewJobDialog";
import { ScheduleJobDialog } from "@/components/printing/ScheduleJobDialog";
import { PrinterFormDialog } from "@/components/printing/PrinterFormDialog";
import { FilamentFormDialog } from "@/components/printing/FilamentFormDialog";
import { hasPrinterPrivilege } from "@/lib/printer-role";

const STATUS_META: Record<
  Doc<"printJobs">["status"],
  { label: string; className: string }
> = {
  pending: { label: "Review", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  approved: { label: "Approved", className: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  denied: { label: "Denied", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  need_slicing: { label: "Needs slicing", className: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30" },
  slicing: { label: "Slicing…", className: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  queued: { label: "Queued", className: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  printing: { label: "Printing", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  done: { label: "Done", className: "bg-emerald-600/15 text-emerald-500 border-emerald-600/30" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  canceled: { label: "Canceled", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const PRINTER_META: Record<
  Doc<"printers">["status"],
  { label: string; dot: string; className: string }
> = {
  printing: { label: "Printing", dot: "bg-emerald-400", className: "border-emerald-500/40" },
  idle: { label: "Idle", dot: "bg-sky-400", className: "border-sky-500/30" },
  maintenance: { label: "Maintenance", dot: "bg-amber-400", className: "border-amber-500/30" },
  offline: { label: "Offline", dot: "bg-zinc-500", className: "border-zinc-500/30" },
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  danger,
}: {
  icon: typeof Printer;
  label: string;
  value: number | string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 glass-3d rounded-lg border bg-card/60 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Icon className={`size-4 ${danger ? "text-amber-400" : "text-primary"}`} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold leading-tight">{value}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

// Jobs come back from listJobs with a joined requesterName.
type EnrichedJob = Doc<"printJobs"> & { requesterName: string };

type TabKey =
  | "dashboard"
  | "jobs"
  | "slicer"
  | "filament"
  | "stream"
  | "printers";

export default function Printing3D() {
  const { user } = useAuth();
  // Admins hold the printer privilege implicitly — one gate drives all actions.
  const isReviewer = hasPrinterPrivilege(user);

  const printers = useQuery(api.printing.listPrinters) ?? [];
  const filaments = useQuery(api.printing.listFilaments) ?? [];
  // Client-side enrichment: requesterName rides along from listJobs — the query
  // returns it, but typing needs the extension.
  const jobs = (useQuery(api.printing.listJobs) ?? []) as EnrichedJob[];
  const stats = useQuery(api.printing.farmStats);

  const approveJob = useMutation(api.printing.approveJob);
  const denyJob = useMutation(api.printing.denyJob);
  const archiveJob = useMutation(api.printing.archiveJob);
  const startPrint = useMutation(api.printing.startPrint);
  const completePrint = useMutation(api.printing.completePrint);
  const failPrint = useMutation(api.printing.failPrint);
  const cancelJob = useMutation(api.printing.cancelJob);
  const claimSlicing = useMutation(api.printing.claimSlicing);
  const setPrinterStatus = useMutation(api.printing.setPrinterStatus);
  const deletePrinter = useMutation(api.printing.deletePrinter);
  const archiveFilament = useMutation(api.printing.archiveFilament);
  const addMaintenance = useMutation(api.printing.addMaintenance);

  const [newJobOpen, setNewJobOpen] = useState(false);
  // Lifted tab state so dialogs (e.g. NewJobDialog → Slicer Studio) can navigate.
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [scheduleJob, setScheduleJob] = useState<Doc<"printJobs"> | null>(null);
  const [printerForm, setPrinterForm] = useState<Doc<"printers"> | null>(null);
  const [printerFormOpen, setPrinterFormOpen] = useState(false);
  const [filamentForm, setFilamentForm] = useState<Doc<"filaments"> | null>(null);
  const [filamentFormOpen, setFilamentFormOpen] = useState(false);
  const [maintPrinter, setMaintPrinter] = useState<Doc<"printers"> | null>(null);
  const [maintText, setMaintText] = useState("");
  const [maintKind, setMaintKind] = useState<"routine" | "repair">("routine");
  const [completeJob, setCompleteJob] = useState<Doc<"printJobs"> | null>(null);
  const [completeWeight, setCompleteWeight] = useState("");
  const [completeMinutes, setCompleteMinutes] = useState("");
  const [failJob, setFailJob] = useState<Doc<"printJobs"> | null>(null);
  const [failReason, setFailReason] = useState("");
  const [decideJob, setDecideJob] = useState<EnrichedJob | null>(null);
  const [decideNote, setDecideNote] = useState("");
  const [busy, setBusy] = useState(false);

  const activeJobs = jobs.filter((j) => j.status === "printing");
  const pendingJobs = jobs.filter((j) => j.status === "pending" && !j.archivedAt);
  const approvedJobs = jobs.filter((j) => ["approved", "need_slicing", "slicing"].includes(j.status) && !j.archivedAt);
  const queueJobs = jobs.filter((j) => j.status === "queued" && !j.archivedAt);
  const historyJobs = jobs.filter((j) => ["done", "failed", "canceled", "denied"].includes(j.status) && !j.archivedAt);
  const jobPrinter = (id: string | undefined) => printers.find((p) => p._id === id);
  const jobSpool = (id: string | undefined) => filaments.find((f) => f._id === id);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitMaintenance = async () => {
    if (!maintPrinter || !maintText.trim()) return;
    await act(
      () =>
        addMaintenance({
          printerId: maintPrinter._id,
          kind: maintKind,
          text: maintText.trim(),
        }),
      "Maintenance logged.",
    );
    setMaintPrinter(null);
    setMaintText("");
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 wide:flex-row wide:items-end">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Printer className="size-6 text-primary" /> 3D Print Farm
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Print requests, approvals, the job queue, filament stock and the embedded slicer — all in one console.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setNewJobOpen(true)}>
              <Plus className="size-4" /> New print request
            </Button>
          </div>
        </header>

        {/* Farm overview strip */}
        {stats && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <StatTile icon={Printer} label="Printers" value={stats.printers} hint={`${stats.printing} printing · ${stats.maintenance} in maintenance`} />
            <StatTile icon={Clock} label="Queue" value={stats.queue} hint="waiting jobs" />
            <StatTile icon={Activity} label="Active prints" value={stats.active} />
            <StatTile icon={Package} label="Completed" value={stats.done} />
            <StatTile icon={TriangleAlert} label="Failed" value={stats.failed} danger={stats.failed > 0} />
            <StatTile icon={Boxes} label="Spools" value={stats.spools} hint="on the shelf" />
            <StatTile icon={TriangleAlert} label="Low filament" value={stats.lowFilaments} danger={stats.lowFilaments > 0} hint="below threshold" />
          </section>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs{" "}
              {(pendingJobs.length + approvedJobs.length + queueJobs.length) > 0 && (
                <Badge variant="secondary" className="ml-1.5 px-1.5">
                  {pendingJobs.length + approvedJobs.length + queueJobs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="slicer">
              Slicer <Layers className="ml-1.5 size-3.5" />
            </TabsTrigger>
            <TabsTrigger value="filament">
              Filament {stats && stats.lowFilaments > 0 && <span className="ml-1.5 text-amber-400">⚠</span>}
            </TabsTrigger>
            <TabsTrigger value="stream">
              Live stream <Video className="ml-1.5 size-3.5" />
            </TabsTrigger>
            {isReviewer && <TabsTrigger value="printers">Printers</TabsTrigger>}
          </TabsList>

          {/* ===== Dashboard tab ===== */}
          <TabsContent value="dashboard" className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {printers.length === 0 && (
                <Card className="md:col-span-2 xl:col-span-3">
                  <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                    <Printer className="size-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium">No printers registered yet</p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {isReviewer
                        ? "Add your first machine from the Printers tab to start scheduling jobs."
                        : "Ask an admin to register the club's printers."}
                    </p>
                  </CardContent>
                </Card>
              )}
              {printers.map((p) => {
                const current = activeJobs.find((j) => j.printerId === p._id);
                const upcoming = queueJobs
                  .filter((j) => j.printerId === p._id)
                  .sort((a, b) => (a.queuePos ?? 0) - (b.queuePos ?? 0));
                const meta = PRINTER_META[p.status];
                const elapsedMin = current?.startedAt ? Math.round((Date.now() - current.startedAt) / 60000) : 0;
                const pct = current?.minutes ? Math.min(100, Math.round((elapsedMin / current.minutes) * 100)) : 0;
                return (
                  <Card key={p._id} className={meta.className}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <span className={`inline-block size-2 rounded-full ${meta.dot} ${p.status === "printing" ? "animate-pulse" : ""}`} />
                            {p.name}
                          </CardTitle>
                          <CardDescription className="truncate">
                            {p.model ?? "—"} {p.nozzleMm !== undefined && `· ${p.nozzleMm} mm nozzle`}
                            {p.buildVolumeCm && ` · ${p.buildVolumeCm.w}×${p.buildVolumeCm.d}×${p.buildVolumeCm.h} cm`}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className="shrink-0">{meta.label}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      {current ? (
                        <div className="flex flex-col gap-2 glass-3d rounded-lg border bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{current.name}</p>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {elapsedMin} / {current.minutes ?? "?"} min
                            </span>
                          </div>
                          <Progress value={pct} />
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="truncate">
                              {current.requesterName} · {jobSpool(current.filamentId)?.colorName ?? "—"} ({current.weightG ?? "?"} g)
                            </span>
                            <span>{pct}%</span>
                          </div>
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                          {upcoming.length > 0
                            ? `Next in queue: ${upcoming[0].name}`
                            : p.status === "maintenance"
                              ? "Under maintenance"
                              : "Nothing printing — ready for jobs"}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {upcoming.length > 0 && (
                          <Badge variant="secondary" className="text-[11px]">
                            {upcoming.length} queued
                          </Badge>
                        )}
                      </div>
                      {isReviewer && (
                        <div className="flex gap-2">
                          {current && (
                            <>
                              <Button
                                size="sm"
                                className="h-7 flex-1 text-xs"
                                onClick={() => {
                                  setCompleteJob(current);
                                  setCompleteWeight(String(current.weightG ?? ""));
                                  setCompleteMinutes(String(current.minutes ?? ""));
                                }}
                                disabled={busy}
                              >
                                Finish
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 flex-1 text-xs"
                                onClick={() => {
                                  setFailJob(current);
                                  setFailReason("");
                                }}
                                disabled={busy}
                              >
                                Failed
                              </Button>
                            </>
                          )}
                          {!current && p.status === "idle" && upcoming[0] && (
                            <Button
                              size="sm"
                              className="h-7 flex-1 text-xs"
                              onClick={() => act(() => startPrint({ jobId: upcoming[0]._id }), "Print started.")}
                              disabled={busy}
                            >
                              Start “{upcoming[0].name.slice(0, 18)}”
                            </Button>
                          )}
                          {p.status !== "printing" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setMaintPrinter(p);
                                setMaintKind(p.status === "maintenance" ? "routine" : "repair");
                                setMaintText("");
                              }}
                            >
                              <Wrench className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ===== Jobs tab ===== */}
          <TabsContent value="jobs" className="flex flex-col gap-4">
            {pendingJobs.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Awaiting approval</h2>
                {pendingJobs.map((j) => (
                  <Card key={j._id} className="border-amber-500/30 py-3">
                    <CardContent className="flex flex-col gap-2 px-4 wide:flex-row wide:items-center wide:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{j.name}</p>
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-500">
                            Request
                          </Badge>
                          {j.priority === "high" && <Badge className="bg-red-500/15 text-red-400 text-[11px]">High</Badge>}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {j.requesterName}
                          {j.fileName && ` · ${j.fileName}`}
                          {j.details && ` · ${j.details.split("\n")[0]}`}
                        </p>
                      </div>
                      {isReviewer && (
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <Button size="sm" className="h-7 text-xs" onClick={() => { setDecideJob(j); setDecideNote(""); }} disabled={busy}>
                            <Check className="size-3.5" /> Review
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}

            {approvedJobs.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Approved — preparing</h2>
                {approvedJobs.map((j) => {
                  const meta = STATUS_META[j.status];
                  return (
                    <Card key={j._id} className="py-3">
                      <CardContent className="flex flex-col gap-2 px-4 wide:flex-row wide:items-center wide:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{j.name}</p>
                            <Badge variant="outline" className={`text-[11px] ${meta.className}`}>{meta.label}</Badge>
                            {j.priority === "high" && <Badge className="bg-red-500/15 text-red-400 text-[11px]">High</Badge>}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {j.requesterName} · {j.fileName ?? (j.slicingNote?.startsWith("{") ? "sliced in Slicer Studio" : "no file")}
                            {j.estWeightG !== undefined && ` · ~${j.estWeightG} g`}
                            {j.estMinutes !== undefined && ` · ~${Math.round(j.estMinutes / 60)} min`}
                            {j.details && ` · ${j.details.split("\n")[0]}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {j.status === "need_slicing" && isReviewer && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => act(() => claimSlicing({ jobId: j._id }), "Slicing claimed.")} disabled={busy}>
                              <LifeBuoy className="size-3.5" /> Take slicing
                            </Button>
                          )}
                          {isReviewer && j.status !== "slicing" && (
                            <Button size="sm" className="h-7 text-xs" onClick={() => setScheduleJob(j)} disabled={busy}>
                              <Cog className="size-3.5" /> Schedule
                            </Button>
                          )}
                          {(isReviewer || j.requesterId === user?._id) && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => act(() => cancelJob({ jobId: j._id }), "Job canceled.")} disabled={busy}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            )}

            {queueJobs.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Queued</h2>
                {queueJobs.map((j) => {
                  const spool = jobSpool(j.filamentId);
                  return (
                    <Card key={j._id} className="py-3">
                      <CardContent className="flex flex-col gap-2 px-4 wide:flex-row wide:items-center wide:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{j.name}</p>
                            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/15 text-[11px] text-sky-400">#{j.queuePos} in queue</Badge>
                            {j.priority === "high" && <Badge className="bg-red-500/15 text-red-400 text-[11px]">High</Badge>}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {j.requesterName} · on {jobPrinter(j.printerId)?.name ?? "?"} · {spool?.colorName ?? "—"} ({j.weightG ?? "?"} g · ~{Math.round((j.minutes ?? 0) / 60)} min)
                          </p>
                        </div>
                        {isReviewer && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => act(() => cancelJob({ jobId: j._id }), "Job canceled.")} disabled={busy}>
                              <EllipsisVertical className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            )}

            {pendingJobs.length === 0 && approvedJobs.length === 0 && queueJobs.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                Nothing in the pipeline — requests, approvals and the queue all clear.
              </p>
            )}

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted-foreground">History</h2>
              {historyJobs.length === 0 && (
                <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No finished prints yet.
                </p>
              )}
              {historyJobs.map((j) => {
                const meta = STATUS_META[j.status];
                return (
                  <Card key={j._id} className="py-3">
                    <CardContent className="flex flex-col gap-1 px-4 wide:flex-row wide:items-center wide:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{j.name}</p>
                          <Badge variant="outline" className={`text-[11px] ${meta.className}`}>{meta.label}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {j.requesterName}
                          {j.weightG !== undefined && ` · ${j.weightG} g`}
                          {j.minutes !== undefined && ` · ${Math.round(j.minutes)} min`}
                          {j.failureNote && ` · ${j.failureNote}`}
                        </p>
                      </div>
                      {isReviewer && (
                        <div className="shrink-0">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => act(() => archiveJob({ jobId: j._id }), "Archived.")} disabled={busy}>
                            <Archive className="size-3.5" /> Archive
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          </TabsContent>

          {/* ===== Slicer tab ===== */}
          <TabsContent value="slicer" className="flex flex-col gap-4">
            {printers.length === 0 ? (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                The slicer needs at least one registered printer for machine profiles — ask an admin to add one.
              </p>
            ) : (
              <SlicerStudio
                printers={printers}
                filaments={filaments}
                userRole={user?.role}
                userPrinterRole={user?.printerRole}
              />
            )}
          </TabsContent>

          {/* ===== Filament tab ===== */}
          <TabsContent value="filament" className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Spools on the shelf — grams are deducted automatically as prints complete.
              </p>
              <Button size="sm" variant="outline" onClick={() => { setFilamentForm(null); setFilamentFormOpen(true); }}>
                <Plus className="size-4" /> Add spool
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filaments.length === 0 && (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                  No spools registered yet — add the first one to start scheduling prints.
                </p>
              )}
              {filaments.map((f) => {
                const remaining = Number(f.remainingG);
                const pct = Math.min(100, Math.round((remaining / Math.max(1, f.weightG)) * 100));
                const low = f.lowAtG !== undefined && remaining <= f.lowAtG;
                return (
                  <Card key={f._id} className={low ? "border-amber-500/40" : undefined}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        <span className="size-8 shrink-0 glass-3d rounded-lg border shadow-inner" style={{ background: f.colorHex ?? "#666" }} />
                        <div className="min-w-0 flex-1">
                          <CardTitle className="truncate text-base">
                            {f.material} · {f.colorName}
                          </CardTitle>
                          <CardDescription className="truncate">{f.brand ?? "Generic"}</CardDescription>
                        </div>
                        {low && <Badge className="shrink-0 bg-amber-500/15 text-amber-400 text-[11px]">Low</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold">
                          {f.remainingG} g <span className="text-xs font-normal text-muted-foreground">/ {f.weightG} g</span>
                        </p>
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                      <Progress value={pct} />
                      {f.inventoryGroupId && (
                        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <HardDrive className="size-3" /> Synced with club inventory
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => { setFilamentForm(f); setFilamentFormOpen(true); }}>
                          Adjust
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => act(() => archiveFilament({ id: f._id }), "Spool archived.")}
                          disabled={busy}
                        >
                          Archive
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ===== Live stream tab (camera feeds arrive later) ===== */}
          <TabsContent value="stream" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Video className="size-4 text-primary" /> Live print streams
                </CardTitle>
                <CardDescription>
                  Watch the printers in real time — camera feeds will plug in here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {printers.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No printers registered yet — streams appear once machines exist.
                  </p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {printers.map((p) => {
                      const current = activeJobs.find((j) => j.printerId === p._id);
                      return (
                        <div key={p._id} className="flex flex-col gap-2 glass-3d rounded-lg border bg-zinc-950/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            <Badge variant="outline" className="text-[10px]">
                              {current ? `printing ${current.name}` : "idle"}
                            </Badge>
                          </div>
                          <div className="flex aspect-video items-center justify-center glass-3d rounded-md border border-dashed bg-background/40 text-xs text-muted-foreground">
                            <span className="flex flex-col items-center gap-1.5">
                              <Video className="size-5" />
                              camera feed not configured
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== Printers tab (reviewers) ===== */}
          {isReviewer && (
            <TabsContent value="printers" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Register machines and keep their config — build volume and nozzle feed the embedded slicer.
                </p>
                <Button size="sm" onClick={() => { setPrinterForm(null); setPrinterFormOpen(true); }}>
                  <Plus className="size-4" /> Add printer
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {printers.map((p) => {
                  const meta = PRINTER_META[p.status];
                  return (
                    <Card key={p._id} className={meta.className}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base">{p.name}</CardTitle>
                            <CardDescription>{p.model ?? "—"}</CardDescription>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7">
                                <EllipsisVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setPrinterForm(p); setPrinterFormOpen(true); }}>
                                <Cog className="size-4" /> Configure
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setMaintPrinter(p); setMaintKind("routine"); setMaintText(""); }}>
                                <Wrench className="size-4" /> Log maintenance
                              </DropdownMenuItem>
                              {p.status !== "maintenance" ? (
                                <DropdownMenuItem onClick={() => act(() => setPrinterStatus({ id: p._id, status: "maintenance" }), "Marked under maintenance.")}>
                                  <Wrench className="size-4" /> Take down for maintenance
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => act(() => setPrinterStatus({ id: p._id, status: "idle" }), "Printer back online.")}>
                                  <Activity className="size-4" /> Back online
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => act(() => deletePrinter({ id: p._id }), "Printer removed.")} disabled={busy}>
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="w-fit">{meta.label}</Badge>
                        {p.buildVolumeCm && <span>Build volume {p.buildVolumeCm.w}×{p.buildVolumeCm.d}×{p.buildVolumeCm.h} cm</span>}
                        <span className="inline-flex items-center gap-1"><Cpu className="size-3" /> {p.nozzleMm ?? "?"} mm nozzle</span>
                        {p.note && <span className="mt-1 italic">{p.note}</span>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* ===== Dialogs ===== */}
        <NewJobDialog
          open={newJobOpen}
          onOpenChange={setNewJobOpen}
          onGoToSlicer={() => setTab("slicer")}
        />
        <ScheduleJobDialog job={scheduleJob} open={scheduleJob !== null} onOpenChange={(o) => !o && setScheduleJob(null)} />
        <PrinterFormDialog printer={printerForm} open={printerFormOpen} onOpenChange={setPrinterFormOpen} />
        <FilamentFormDialog spool={filamentForm} open={filamentFormOpen} onOpenChange={setFilamentFormOpen} />

        {/* Approve / deny a request */}
        <Dialog open={decideJob !== null} onOpenChange={(o) => !o && setDecideJob(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Review “{decideJob?.name}”</DialogTitle>
              <DialogDescription>
                Approve to let the member slice and schedule it — or decline with a reason.
              </DialogDescription>
            </DialogHeader>
            {decideJob && (
              <div className="glass-3d rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {decideJob.requesterName}
                {decideJob.fileName && ` · ${decideJob.fileName}`}
                {decideJob.details && ` — ${decideJob.details.split("\n")[0]}`}
              </div>
            )}
            <Textarea
              className="mt-1"
              rows={2}
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value)}
              placeholder="Optional note for the member…"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecideJob(null)} disabled={busy}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (!decideJob) return;
                  await act(() => denyJob({ jobId: decideJob._id, note: decideNote.trim() || undefined }), "Request denied.");
                  setDecideJob(null);
                }}
              >
                <X className="size-4" /> Deny
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!decideJob) return;
                  await act(() => approveJob({ jobId: decideJob._id, note: decideNote.trim() || undefined }), "Request approved.");
                  setDecideJob(null);
                }}
              >
                <CheckCircle2 className="size-4" /> Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Complete print */}
        <Dialog open={completeJob !== null} onOpenChange={(o) => !o && setCompleteJob(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Finish “{completeJob?.name}”</DialogTitle>
              <DialogDescription>
                Confirm the real numbers — the spool's remaining grams are deducted.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="grid gap-2">
                <Label htmlFor="fin-weight">Filament used (g)</Label>
                <Input id="fin-weight" type="number" value={completeWeight} onChange={(e) => setCompleteWeight(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fin-min">Duration (min)</Label>
                <Input id="fin-min" type="number" value={completeMinutes} onChange={(e) => setCompleteMinutes(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Filament is deducted from the spool automatically when you finish.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCompleteJob(null)} disabled={busy}>Cancel</Button>
              <Button
                disabled={busy || !completeWeight || !completeMinutes}
                onClick={async () => {
                  if (!completeJob) return;
                  await act(
                    () =>
                      completePrint({
                        jobId: completeJob._id,
                        weightG: Number(completeWeight),
                        minutes: Number(completeMinutes),
                      }),
                    "Print finished — spool updated.",
                  );
                  setCompleteJob(null);
                }}
              >
                {busy && <LoadingGifInline size={18} className="size-4" />} Finish print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Fail print */}
        <Dialog open={failJob !== null} onOpenChange={(o) => !o && setFailJob(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark “{failJob?.name}” as failed</DialogTitle>
              <DialogDescription>
                The printer goes to maintenance and a repair entry is logged.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              className="mt-2"
              rows={2}
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder="Spaghetti at layer 12, bed adhesion lost…"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setFailJob(null)} disabled={busy}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={busy || !failReason.trim()}
                onClick={async () => {
                  if (!failJob) return;
                  await act(() => failPrint({ jobId: failJob._id, reason: failReason.trim() }), "Marked as failed.");
                  setFailJob(null);
                }}
              >
                Mark failed
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Maintenance log */}
        <Dialog open={maintPrinter !== null} onOpenChange={(o) => !o && setMaintPrinter(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Maintenance — {maintPrinter?.name}</DialogTitle>
              <DialogDescription>Log what was done; the printer's history keeps everything.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={maintKind} onValueChange={(v) => setMaintKind(v as "routine" | "repair")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">Routine upkeep</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea rows={3} value={maintText} onChange={(e) => setMaintText(e.target.value)} placeholder="Swapped 0.4 nozzle, cleaned and lubricated rails…" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMaintPrinter(null)} disabled={busy}>Cancel</Button>
              <Button disabled={busy || !maintText.trim()} onClick={submitMaintenance}>Save entry</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AppShell>
  );
}
