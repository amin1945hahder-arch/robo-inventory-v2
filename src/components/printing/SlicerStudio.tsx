import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  Cog,
  Download,
  FileUp,
  Layers,
  Loader2,
  Printer,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasPrinterPrivilege } from "@/lib/printer-role";
import {
  parseGcodeStats,
  snapshotFromKiri,
  snapshotToNote,
  type GcodeStats,
  type SlicerSnapshot,
} from "@/lib/kiri-process";
import {
  classifyKiriReply,
  exportJobTransition,
  exportTimeoutMs,
  fileBaseName,
  GET_REPLY_GRACE_MS,
  GET_RETRY_DELAY_MS,
  GET_RETRY_MAX,
  kiriMsg,
  MODEL_LOAD_EVENTS,
  planModelLoad,
  READY_EVENTS,
  widgetFileName,
  WIDGET_POLL_DELAY_MS,
  WIDGET_POLL_MAX_MS,
  type ExportJob,
  type KiriWidgetInfo,
} from "@/lib/slicer-protocol";

/**
 * Slicer Studio — embeds the self-hosted Kiri:Moto (same origin /slicer/) with
 * a slim action rail on the left. The slicer's own UI stays the source of
 * truth for every setting; the bridge only:
 *   • pushes the club printer profile ("Set printer")
 *   • applies material temps ("Set material")
 *   • reads everything back ("Get data") into a grouped spec readout
 *   • after slice+prepare, pulls the G-code via the export.done EVENT — the
 *     file is held in browser memory only (downloadable), never sent to the DB.
 *     Submitting the job sends stats + settings snapshot for admin approval.
 */

const KIRI_URL = "/slicer/";

export function SlicerStudio({
  printers,
  filaments,
  userRole,
  userPrinterRole,
}: {
  printers: Doc<"printers">[];
  filaments: Doc<"filaments">[];
  userRole?: string;
  userPrinterRole?: boolean;
}) {
  const canPrint = hasPrinterPrivilege({ role: userRole, printerRole: userPrinterRole });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Pending {get} replies + the timeout id of the active collection window.
  const gotProcess = useRef<Record<string, unknown> | null>(null);
  const gotDevice = useRef<Record<string, unknown> | null>(null);
  const getTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getAttempts = useRef(0);
  const frameWin = useRef<Window | null>(null);
  // Model presence is verified by polling {get:"widgets"} — never assumed.
  const widgetsPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const widgetsDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenWidgetFile = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);  const [slicePhase, setSlicePhase] = useState<"idle" | "slicing" | "sliced">("idle");
  const [snapshot, setSnapshot] = useState<SlicerSnapshot | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob>({ phase: "idle" });
  const [stats, setStats] = useState<GcodeStats | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [partName, setPartName] = useState<string | null>(null);
  const [jobName, setJobName] = useState("");
  const [note, setNote] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [printerId, setPrinterId] = useState("");
  const [filamentId, setFilamentId] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const submitSlicedJob = useMutation(api.printing.submitSlicedJob);

  const sliced = slicePhase === "sliced";
  const gcode = exportJob.gcode ?? null;

  const send = useCallback((msg: Record<string, unknown>) => {
    // Same-origin embed: the default target origin ("/") is exactly right.
    frameWin.current?.postMessage(msg, "/");
  }, []);

  const addLog = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 30));
  }, []);

  // ---- collect {get} replies ------------------------------------------------

  const collectGetData = useCallback(() => {
    if (!gotProcess.current && !gotDevice.current) {
      if (getAttempts.current < GET_RETRY_MAX) {
        getAttempts.current += 1;
        addLog(`get retry ${getAttempts.current}/${GET_RETRY_MAX}`);
        send(kiriMsg.getProcess());
        send(kiriMsg.getDevice());
        getTimer.current = setTimeout(collectGetData, GET_RETRY_DELAY_MS);
      } else {
        toast.error("No settings came back from the slicer — is it fully loaded?");
        addLog("get: no data");
      }
      return;
    }
    setSnapshot(snapshotFromKiri(gotProcess.current ?? undefined, gotDevice.current ?? undefined));
    if (gotDevice.current) {
      const dn = (gotDevice.current as Record<string, unknown>).deviceName;
      if (typeof dn === "string" && dn) setDeviceLabel(dn);
    }
    toast.success("Settings captured from the slicer.");
    addLog("get: ok");
  }, [addLog, send]);

  const getData = () => {
    if (!ready) {
      toast.error("The slicer is still loading — try again in a moment.");
      return;
    }
    gotProcess.current = null;
    gotDevice.current = null;
    getAttempts.current = 0;
    if (getTimer.current) clearTimeout(getTimer.current);
    send(kiriMsg.getProcess());
    send(kiriMsg.getDevice());
    getTimer.current = setTimeout(collectGetData, GET_REPLY_GRACE_MS);
  };

  useEffect(
    () => () => {
      if (getTimer.current) clearTimeout(getTimer.current);
    },
    [],
  );

  // ---- inbound bridge --------------------------------------------------------

  // export watchdog: if export.done never arrives, stop the spinner.
  useEffect(() => {
    const ms = exportTimeoutMs(exportJob.phase);
    if (exportJob.phase !== "requested" || ms <= 0) return;
    const t = setTimeout(() => {
      setExportJob((j) => (j.phase === "requested" ? { phase: "failed" } : j));
      setBusyLabel(null);
      addLog("export timed out");
      toast.error("G-code export timed out — slice the model and try again.");
    }, ms);
    return () => clearTimeout(t);
  }, [exportJob.phase, addLog]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      // Same-origin only — Kiri's replies target the default origin.
      if (ev.source !== frameWin.current) return;
      const reply = classifyKiriReply(ev.data);
      if (reply.kind === "unknown") return;

      if (reply.kind === "widgets") {
        const name = widgetFileName(reply.widgets);
        seenWidgetFile.current = name;
        if (name) {
          setPartName((prev) => (prev === name ? prev : name));
          if (!jobNameRef.current) setJobName(fileBaseName(name));
          // Any widgets on the bed → model load verified.
          finishLoadWatch(true);
        }
        return;
      }
      if (reply.kind === "process") {
        gotProcess.current = reply.process;
        // Any structured reply proves the slicer booted — flip ready.
        setReady(true);
        return;
      }
      if (reply.kind === "device") {
        gotDevice.current = reply.device;
        const dn = (reply.device as Record<string, unknown>).deviceName;
        if (typeof dn === "string" && dn) setDeviceLabel(dn);
        setReady(true);
        return;
      }
      if (reply.kind === "mode") {
        // First sign of life from the slicer.
        setReady(true);
        return;
      }
      if (reply.kind !== "event") return;
      const name = reply.event;
      addLog(name);

      if (READY_EVENTS.has(name)) {
        setReady(true);
        setBusyLabel((b) => (b === "Loading Kiri:Moto…" ? null : b));
      }
      if (MODEL_LOAD_EVENTS.has(name)) {
        // Events only fire for the frame parse/load path; Kiri's own import
        // emits none — widget polling is the universal verification.
        finishLoadWatch(true);
        setBusyLabel(null);
        toast.success("Model loaded into the slicer.");
      }
      if (name === "parse.error" || name === "load.error") {
        finishLoadWatch(false);
        setBusyLabel(null);
        toast.error(`The slicer could not load the file (${name}).`);
      }
      if (name === "slice.done") {
        // NOTE: do NOT auto-prepare here. Kiri's slice flow already renders
        // its own preview, and firing a second {function:prepare} while the
        // slicer is still finishing its own state transition jams its modal
        // queue (bed freezes until reload). Export self-prepares when needed.
        setSlicePhase((p) => (p === "slicing" ? "sliced" : p));
        setBusyLabel(null);
        toast.success("Slicing finished — press “Get G-code” to capture it.");
      }
      if (name === "prepare.done") {
        setBusyLabel(null);
      }
      if (name === "export.done") {
        setExportJob((j) => exportJobTransition(j, { type: "export.done", payload: reply.data }));
        setBusyLabel(null);
      }
      if (name === "slice.error" || name === "prepare.error" || name === "export.error" || name === "error") {
        setSlicePhase((p) => (p === "slicing" ? "idle" : p));
        setExportJob((j) => exportJobTransition(j, { type: "error" }));
        setBusyLabel(null);
        toast.error(`The slicer reported: ${name}`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [addLog, send]);

  // Reflect export results in UI state (single place, no race with the bridge).
  useEffect(() => {
    if (exportJob.phase === "done" && exportJob.gcode) {
      setStats(parseGcodeStats(exportJob.gcode));
      toast.success("G-code captured — stored locally in your browser.");
    }
    if (exportJob.phase === "failed") {
      toast.error("The slicer returned no G-code. Slice the model first.");
    }
  }, [exportJob]);

  const frameLoaded = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    frameWin.current = e.currentTarget.contentWindow;
    // Kiri won't always emit init-done before we attach; poll {get:"mode"} as a
    // handshake. Each reply hits the "mode" branch above and flips ready.
    // 120 tries × 500ms = 60s: the 4.7.3 bundle is big and a cold cache can
    // legitimately take a while to finish booting inside the frame.
    let tries = 0;
    const tick = () => {
      if (frameRef.current?.contentWindow === frameWin.current && !readyRef.current && tries < 120) {
        tries += 1;
        send(kiriMsg.getMode());
        setTimeout(tick, 500);
      } else if (!readyRef.current && tries >= 120) {
        // Never leave the user on an infinite spinner — uncover the frame so
        // they can use the slicer's own UI even if the handshake never lands.
        setReady(true);
        addLog("handshake timed out — exposing slicer anyway");
      }
    };
    setTimeout(tick, 800);
  };

  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // Watchdog: no busy label should ever spin for more than 90s. Kiri boots
  // slower than expected on cold caches, but 90s without a reply means the
  // reply was missed — clear the spinner instead of looping forever.
  useEffect(() => {
    if (!busyLabel) return;
    const t = setTimeout(() => {
      setBusyLabel((b) => (b === busyLabel ? null : b));
      addLog(`busy timeout: ${busyLabel}`);
    }, 90_000);
    return () => clearTimeout(t);
  }, [busyLabel, addLog]);

  // ---- rail actions ----------------------------------------------------------

  const setPrinterInKiri = () => {
    const printer = printers.find((p) => p._id === printerId);
    if (!printer) {
      toast.error("Choose one of the club printers first.");
      return;
    }
    const bw = printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.w * 10) : 220;
    const bd = printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.d * 10) : 220;
    const bh = printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.h * 10) : 250;
    send(
      kiriMsg.setDevice({
        deviceName: `${printer.name} (club)`,
        bedWidth: bw,
        bedDepth: bd,
        maxHeight: bh,
        bedRound: 0,
        bedBelt: 0,
        extruders: [{ extFilament: 1.75, extNozzle: printer.nozzleMm ?? 0.4, extOffsetX: 0, extOffsetY: 0 }],
        gcodeTime: 1,
      }),
    );
    toast.success(`Machine profile “${printer.name}” set in the slicer.`);
    addLog(`device → ${printer.name}`);
  };

  const setMaterialInKiri = () => {
    const filament = filaments.find((f) => f._id === filamentId);
    if (!filament) {
      toast.error("Choose a spool first.");
      return;
    }
    const temps: Record<string, { temp: number; bed: number }> = {
      PLA: { temp: 205, bed: 60 },
      "PLA+": { temp: 210, bed: 60 },
      PETG: { temp: 235, bed: 80 },
      ABS: { temp: 245, bed: 100 },
      ASA: { temp: 250, bed: 100 },
      TPU: { temp: 225, bed: 45 },
      Other: { temp: 210, bed: 60 },
    };
    const t = temps[filament.material] ?? temps.Other;
    send(
      kiriMsg.setProcess({
        outputTemp: t.temp,
        outputBedTemp: t.bed,
        firstLayerNozzleTemp: t.temp,
        firstLayerBedTemp: t.bed,
      }),
    );
    toast.success(`Material set to ${filament.material} · ${filament.colorName} (${t.temp}°C).`);
    addLog(`material → ${filament.material}`);
  };

  const pickFile = () => fileRef.current?.click();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(stl|3mf|gcode|svg)$/i.test(file.name)) {
      toast.error("Kiri:Moto accepts STL, 3MF, GCODE and SVG files.");
      return;
    }
    if (!jobName.trim()) setJobName(file.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = () => {
      const type = /\.stl$/i.test(file.name)
        ? "stl"
        : /\.3mf$/i.test(file.name)
          ? "3mf"
          : /\.gcode$/i.test(file.name)
            ? "gcode"
            : "svg";
      setSlicePhase("idle");
      setExportJob({ phase: "idle" });
      setStats(null);
      setBusyLabel("Loading model…");
      send(kiriMsg.parse(reader.result, type));
    };
    if (/\.(stl|3mf|gcode)$/i.test(file.name)) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const doSlice = () => {
    if (!ready) {
      toast.error("The slicer is still loading.");
      return;
    }
    if (!sentModel.current) {
      toast.error("Load a model first — the slicer has nothing to slice.");
      return;
    }
    setSlicePhase("slicing");
    setExportJob({ phase: "idle" });
    setStats(null);
    // Kiri's own slice flow handles prepare internally when preview runs;
    // slice.done (below) drives prepare for the bridge path.
    send(kiriMsg.slice());
    addLog("slice requested");
  };

  const getGcode = () => {
    if (!sliced) {
      toast.error("Slice the model first — the G-code exists only after slicing.");
      return;
    }
    if (exportJob.phase === "requested") return;
    setBusyLabel("Exporting G-code…");
    setExportJob((j) => exportJobTransition(j, { type: "request" }));
    send(kiriMsg.export());
  };

  const downloadGcode = () => {
    if (!gcode) return;
    const blob = new Blob([gcode], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(jobName || "club-print").replace(/[^\w.-]+/g, "_")}.gcode`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doClear = () => {
    send(kiriMsg.clear());
    sentModel.current = false;
    setSlicePhase("idle");
    setExportJob({ phase: "idle" });
    setStats(null);
    setBusyLabel(null);
  };

  const openSubmit = () => {
    if (!stats) {
      toast.error("Capture the G-code first — it carries the print estimates.");
      return;
    }
    setSubmitOpen(true);
  };

  const submitForApproval = async () => {
    if (!stats) return;
    if (!jobName.trim()) {
      toast.error("Give the part a name.");
      return;
    }
    setSubmitting(true);
    try {
      const printer = printers.find((p) => p._id === printerId);
      const filament = filaments.find((f) => f._id === filamentId);
      const header = [
        snapshot ? `Sliced on: ${snapshot.deviceName || "slicer"}${printer ? ` · target: ${printer.name}` : ""}` : null,
        filament ? `Material: ${filament.material} · ${filament.colorName} (${filament.remainingG} g on spool)` : null,
        stats.grams > 0 ? `Est. filament: ${stats.grams} g` : null,
        stats.minutes > 0 ? `Est. duration: ${stats.minutes} min` : null,
        note.trim() ? `Note: ${note.trim()}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const specNote = snapshot ? snapshotToNote(snapshot) : "";
      await submitSlicedJob({
        name: jobName.trim(),
        note: [header, specNote].filter(Boolean).join("\n\n"),
        grams: stats.grams || undefined,
        minutes: stats.minutes || undefined,
        deviceName: snapshot?.deviceName ?? deviceLabel ?? undefined,
        snapshot: snapshot ? { groups: snapshot.groups } : undefined,
      });
      toast.success("Sent for approval — an admin will review and schedule it.");
      setSubmitOpen(false);
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the job");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- UI --------------------------------------------------------------------

  const railButton = "h-9 w-full justify-start gap-2 text-xs font-medium";

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[560px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <span className="text-sm font-semibold">Slicer Studio</span>
          <Badge variant="outline" className="text-[11px]">Kiri:Moto · embedded</Badge>
          {deviceLabel && <Badge variant="secondary" className="text-[11px]">{deviceLabel}</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          {sliced && (
            <Badge className="bg-emerald-500/15 text-emerald-400 text-[11px]">
              <CheckCircle2 className="size-3" /> sliced
            </Badge>
          )}
          <a href="https://grid.space/kiri/" target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              Kiri docs <ExternalLinkIcon />
            </Button>
          </a>
        </div>
      </div>

      {!canPrint && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
          <ShieldCheck className="size-4 shrink-0" />
          You can explore the slicer, but submitting prints needs the “printer”
          privilege — request it from your profile page.
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[220px_1fr]">
        {/* Action rail */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border bg-card/60 p-2.5">
          <div className="flex flex-col gap-1">
            <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Printer className="size-3" /> Printer
            </Label>
            <select
              value={printerId}
              onChange={(e) => setPrinterId(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Choose…</option>
              {printers.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" className={railButton} onClick={setPrinterInKiri}>
              <Printer className="size-3.5" /> Set printer
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Layers className="size-3" /> Material
            </Label>
            <select
              value={filamentId}
              onChange={(e) => setFilamentId(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Choose…</option>
              {filaments.map((f) => (
                <option key={f._id} value={f._id}>{f.material} · {f.colorName}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" className={railButton} onClick={setMaterialInKiri}>
              <Layers className="size-3.5" /> Set material
            </Button>
          </div>

          <div className="my-1 border-t" />

          <Button size="sm" className={railButton} onClick={pickFile} disabled={!ready}>
            <FileUp className="size-3.5" /> Load model
          </Button>
          <Button size="sm" variant="outline" className={railButton} onClick={doSlice} disabled={!ready || slicePhase === "slicing"}>
            {slicePhase === "slicing" ? <Loader2 className="size-3.5 animate-spin" /> : <Cog className="size-3.5" />}
            Slice in Kiri
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={railButton}
            onClick={getGcode}
            disabled={!sliced || exportJob.phase === "requested" || busyLabel === "Exporting G-code…"}
          >
            <Download className="size-3.5" /> Get G-code
          </Button>
          <Button size="sm" variant="outline" className={railButton} onClick={getData}>
            <ClipboardList className="size-3.5" /> Get data
          </Button>
          <Button size="sm" variant="ghost" className={railButton + " text-muted-foreground"} onClick={doClear}>
            <Trash2 className="size-3.5" /> Clear bed
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".stl,.3mf,.gcode,.svg"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {stats && (
            <div className="mt-auto rounded-md border bg-background/70 p-2 text-[11px]">
              <p className="font-medium">Captured G-code</p>
              <p className="text-muted-foreground">
                {stats.grams > 0 ? `${stats.grams} g` : "grams unknown"} ·{" "}
                {stats.minutes > 0 ? `${stats.minutes} min` : "time unknown"} ·{" "}
                {(stats.bytes / 1024).toFixed(0)} KB
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="outline" className="h-6 flex-1 px-2 text-[10px]" onClick={downloadGcode}>
                  Save file
                </Button>
                <Button size="sm" className="h-6 flex-1 px-2 text-[10px]" onClick={openSubmit} disabled={!canPrint}>
                  Send for approval
                </Button>
              </div>
            </div>
          )}

          {log.length > 0 && (
            <div className="max-h-28 overflow-y-auto rounded-md border bg-background/60 p-1.5 font-mono text-[9.5px] leading-4 text-muted-foreground">
              {log.map((line, i) => (
                <p key={`${i}-${line}`}>▸ {line}</p>
              ))}
            </div>
          )}
        </div>

        {/* Embedded Kiri frame */}
        <div className="relative min-h-0 overflow-hidden rounded-lg border bg-zinc-950">
          {!ready && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950/90 text-zinc-300">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-sm">Loading Kiri:Moto…</p>
              <p className="text-xs text-muted-foreground">
                All slicing controls live inside the frame — use the panels on its right.
              </p>
            </div>
          )}
          <iframe
            ref={frameRef}
            src={KIRI_URL}
            title="Kiri:Moto slicer"
            className="h-full w-full border-0"
            allow="clipboard-write; fullscreen"
            onLoad={frameLoaded}
          />
          {/* Escape hatch: never trap the user behind an infinite spinner —
              the slicer below is often usable even if our handshake missed. */}
          {!ready && (
            <button
              type="button"
              onClick={() => {
                setReady(true);
                addLog("overlay dismissed manually");
              }}
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-zinc-600 bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-100"
            >
              Taking too long? Open the slicer anyway
            </button>
          )}
        </div>
      </div>

      {/* ===== Settings readout ===== */}
      <Dialog open={snapshot !== null} onOpenChange={(o) => !o && setSnapshot(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="size-4 text-primary" /> Slicer settings
              {snapshot?.deviceName && <Badge variant="secondary" className="text-[11px]">{snapshot.deviceName}</Badge>}
            </DialogTitle>
            <DialogDescription>
              Read straight out of Kiri:Moto — “—” means the slicer left it unset.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot?.groups.map((g) => (
              <div key={g.id} className="rounded-lg border p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Cog className="size-3" /> {g.title}
                </p>
                <dl className="grid gap-1">
                  {g.rows.map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-2 text-xs">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className={r.value === "—" ? "text-muted-foreground/50" : "font-medium"}>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Submit for approval ===== */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send “{jobName || "part"}” for approval</DialogTitle>
            <DialogDescription>
              The G-code stays on your device — only the stats and the settings
              snapshot go to the admins. Filament is deducted only when the print
              actually starts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="sl-name">Part name *</Label>
              <Input id="sl-name" value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Bracket v2" />
            </div>
            {stats && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                ~{stats.grams > 0 ? `${stats.grams} g` : "unknown weight"} ·{" "}
                {stats.minutes > 0 ? `${stats.minutes} min` : "unknown time"} · {deviceLabel ?? "slicer profile"}
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="sl-note">Note for the admins</Label>
              <Textarea
                id="sl-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the operator should know: orientation, supports to check, urgency…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitForApproval} disabled={submitting || !jobName.trim() || !canPrint}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <Send className="size-4" /> Send for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExternalLinkIcon() {
  return <span aria-hidden className="text-[10px]">↗</span>;
}
