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
  ExternalLink,
  FileUp,
  Layers,
  Loader2,
  Printer,
  Send,
  Trash2,
} from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  parseGcodeStats,
  snapshotFromKiri,
  snapshotToNote,
  type GcodeStats,
  type SlicerSnapshot,
} from "@/lib/kiri-process";

/**
 * Slicer Studio — embeds Kiri:Moto (grid.space) full-bleed with a slim action
 * rail on the left. The slicer's own UI stays the source of truth for every
 * setting; the bridge only:
 *   • pushes the club printer profile ("Set printer")
 *   • applies material temps ("Set material")
 *   • reads everything back ("Get data") into a grouped spec readout
 *   • after a slice, pulls the G-code via Kiri's export callback — the file
 *     is held in browser memory only (downloadable), never sent to the DB.
 *     Submitting the job sends stats + settings snapshot for admin approval.
 */

const KIRI_ORIGIN = "https://grid.space";
const KIRI_URL = `${KIRI_ORIGIN}/kiri/`;

export function SlicerStudio({
  printers,
  filaments,
}: {
  printers: Doc<"printers">[];
  filaments: Doc<"filaments">[];
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingGet = useRef<{ process?: Record<string, unknown>; device?: Record<string, unknown> }>({});
  const [ready, setReady] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [slicing, setSlicing] = useState(false);
  const [sliced, setSliced] = useState(false);
  const [snapshot, setSnapshot] = useState<SlicerSnapshot | null>(null);
  const [gcode, setGcode] = useState<string | null>(null);
  const [stats, setStats] = useState<GcodeStats | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [jobName, setJobName] = useState("");
  const [note, setNote] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [printerId, setPrinterId] = useState("");
  const [filamentId, setFilamentId] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const submitSlicedJob = useMutation(api.printing.submitSlicedJob);

  const send = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(msg, KIRI_ORIGIN);
  }, []);

  const addLog = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 30));
  }, []);

  // ---- inbound bridge ------------------------------------------------------
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== KIRI_ORIGIN) return;
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;

      // replies to {get:"process"|"device"} arrive as bare {process:…}/{device:…}
      if (data.process && !data.event) {
        pendingGet.current.process = data.process as Record<string, unknown>;
      }
      if (data.device && !data.event) {
        pendingGet.current.device = data.device as Record<string, unknown>;
        const dn = (data.device as Record<string, unknown>).deviceName;
        if (typeof dn === "string") setDeviceLabel(dn);
      }
      if (data.mode && !data.event) setReady(true);

      if (typeof data.event === "string") {
        const name = data.event;
        addLog(name);
        if (name === "load-done" || name === "init-done") {
          setReady(true);
          setBusyLabel(null);
        }
        if (name === "loaded" || name === "parsed") {
          setBusyLabel(null);
          toast.success("Model loaded into the slicer.");
        }
        if (name === "slice.done" || name === "sliced") {
          setSlicing(false);
          setSliced(true);
          setBusyLabel(null);
          toast.success("Slicing finished — press “Get G-code” to capture it.");
        }
        if (name === "export.done") {
          setBusyLabel(null);
          const payload = data.data;
          if (typeof payload === "string" && payload.length > 0) {
            setGcode(payload);
            setStats(parseGcodeStats(payload));
            toast.success("G-code captured — stored locally in your browser.");
          } else {
            toast.error("The slicer returned no G-code. Slice the model first.");
          }
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [addLog]);

  const frameLoaded = () => {
    // Kiri posts init-done / load-done; this timer is only a fallback.
    setTimeout(() => setReady(true), 3000);
  };

  // ---- rail actions --------------------------------------------------------
  const setPrinterInKiri = () => {
    const printer = printers.find((p) => p._id === printerId);
    if (!printer) {
      toast.error("Choose one of the club printers first.");
      return;
    }
    const bw = printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.w * 10) : 220;
    const bd = printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.d * 10) : 220;
    const bh = printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.h * 10) : 250;
    send({
      device: {
        deviceName: `${printer.name} (club)`,
        bedWidth: bw,
        bedDepth: bd,
        maxHeight: bh,
        bedRound: 0,
        bedBelt: 0,
        extruders: [{ extFilament: 1.75, extNozzle: printer.nozzleMm ?? 0.4, extOffsetX: 0, extOffsetY: 0 }],
        gcodeTime: 1,
      },
    });
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
    send({ process: { outputTemp: t.temp, outputBedTemp: t.bed, firstLayerNozzleTemp: t.temp, firstLayerBedTemp: t.bed } });
    toast.success(`Material set to ${filament.material} · ${filament.colorName} (${t.temp}°C).`);
    addLog(`material → ${filament.material}`);
  };

  const getData = () => {
    if (!ready) {
      toast.error("The slicer is still loading — try again in a moment.");
      return;
    }
    pendingGet.current = {};
    send({ get: "process" });
    send({ get: "device" });
    // Kiri replies asynchronously; small grace period before building the view.
    setTimeout(() => {
      const { process, device } = pendingGet.current;
      if (!process && !device) {
        toast.error("No settings came back from the slicer — is it fully loaded?");
        return;
      }
      setSnapshot(snapshotFromKiri(process, device));
      toast.success("Settings captured from the slicer.");
    }, 350);
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
      const type = /\.stl$/i.test(file.name) ? "stl" : /\.3mf$/i.test(file.name) ? "3mf" : /\.gcode$/i.test(file.name) ? "gcode" : "svg";
      send({ parse: reader.result, type });
      setBusyLabel("Loading model…");
    };
    if (/\.(stl|3mf|gcode)$/i.test(file.name)) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const doSlice = () => {
    if (!ready) {
      toast.error("The slicer is still loading.");
      return;
    }
    setSlicing(true);
    setSliced(false);
    setGcode(null);
    setStats(null);
    send({ function: "slice", callback: true });
    setTimeout(() => send({ function: "prepare", callback: true }), 400);
    addLog("slice + prepare requested");
  };

  const getGcode = () => {
    if (!sliced) {
      toast.error("Slice the model first — the G-code exists only after slicing.");
      return;
    }
    setBusyLabel("Exporting G-code…");
    send({ function: "export", callback: true });
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
    send({ clear: true });
    setSliced(false);
    setSlicing(false);
    setGcode(null);
    setStats(null);
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

  // ---- UI ------------------------------------------------------------------
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
          <a href={KIRI_URL} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <ExternalLink className="size-3.5" /> Open full
            </Button>
          </a>
        </div>
      </div>

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
          <Button size="sm" variant="outline" className={railButton} onClick={doSlice} disabled={!ready || slicing}>
            {slicing ? <Loader2 className="size-3.5 animate-spin" /> : <Cog className="size-3.5" />}
            Slice in Kiri
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={railButton}
            onClick={getGcode}
            disabled={!sliced || busyLabel === "Exporting G-code…"}
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
                <Button size="sm" className="h-6 flex-1 px-2 text-[10px]" onClick={openSubmit}>
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
            <Button onClick={submitForApproval} disabled={submitting || !jobName.trim()}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              <Send className="size-4" /> Send for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
