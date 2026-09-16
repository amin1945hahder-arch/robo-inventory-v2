import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Download,
  ExternalLink,
  FileUp,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Slicer Studio — embeds Kiri:Moto (grid.space) in a sandboxed iframe and
 * drives it through Kiri's documented frame message API:
 *   https://grid.space/kiri/frame.html
 *
 * Outgoing messages:  {load} {parse,type} {clear} {mode} {device} {process}
 *                     {function:"slice"|"prepare"|"export", callback:true}
 * Incoming events:    {event:"loaded"| "slice.progress" | "slice.done" |
 *                      "prepare.done" | "export.done" ...}
 */

const KIRI_URL = "https://grid.space/kiri/";

/** Kiri:FDM device profile — mirrors the shape of `kiriDeviceFor` in printing.ts. */
type KiriDevice = {
  deviceName: string;
  mode: string;
  internal: number;
  bbx: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  originCenter: boolean;
  zHome: number;
  autoBedLevel: boolean;
  output: { extLines: number; extOff: number; gcodePause: string };
  tools: Array<{
    id: number;
    nozzleD: number;
    filamentD: number;
    extrudeMult: number;
    temp: number;
    tempBed: number;
  }>;
};

const DEFAULT_PROCESS: Record<string, unknown> = {
  processName: "club-default",
  mode: "FDM",
  sliceHeight: 0.2,
  sliceShells: 2,
  sliceFillAngle: 45,
  sliceFillSparse: 0.25,
  sliceFillSize: 2.5,
  sliceTopLayers: 4,
  sliceSolidLayers: 3,
  sliceBottomLayers: 3,
  outputTemp: 205,
  outputBedTemp: 60,
  outputFeedrate: 3000,
  outputFinishrate: 2000,
  outputSeekrate: 3500,
  outputFanLayer: 1,
  firstLayerNozzleTemp: 205,
  firstLayerBedTemp: 60,
  firstLayerRate: 1500,
  raftEnable: false,
  supportEnable: false,
  supportDensity: 0.15,
  supportOffset: 0.8,
  supportGap: 1,
  supportSpan: 5,
  supportAngle: 50,
  supportSize: 6,
  brimCount: 3,
  brimOffset: 3,
  skirtCount: 3,
  skirtOffset: 6,
};

/** Baseline settings every fresh Kiri session starts from. */

export function SlicerStudio({
  printers,
  filaments,
  jobContext,
}: {
  printers: Doc<"printers">[];
  filaments: Doc<"filaments">[];
  /** When a farm job is being prepared, its name shows in the header. */
  jobContext?: { name: string; fileName?: string } | null;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [frameBusy, setFrameBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [sliced, setSliced] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [printerId, setPrinterId] = useState<string>("");
  const [filamentId, setFilamentId] = useState<string>("");
  const [layerHeight, setLayerHeight] = useState(0.2);
  const [fill, setFill] = useState(25);
  const [shells, setShells] = useState(2);
  const [support, setSupport] = useState(false);

  const printer = printers.find((p) => p._id === printerId) ?? null;
  const filament = filaments.find((f) => f._id === filamentId) ?? null;

  const deviceProfile: KiriDevice | null = printer
    ? {
        deviceName: `${printer.name} (club)`,
        mode: "FDM",
        internal: 0,
        bbx: {
          min: { x: 0, y: 0, z: 0 },
          max: {
            x: printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.w * 10) : 220,
            y: printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.d * 10) : 220,
            z: printer.buildVolumeCm ? Math.round(printer.buildVolumeCm.h * 10) : 250,
          },
        },
        originCenter: false,
        zHome: 0,
        autoBedLevel: true,
        output: { extLines: 3, extOff: 0, gcodePause: "" },
        tools: [
          {
            id: 0,
            nozzleD: printer.nozzleMm ?? 0.4,
            filamentD: 1.75,
            extrudeMult: 1,
            temp: 205,
            tempBed: 60,
          },
        ],
      }
    : null;

  const send = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(msg, "https://grid.space");
  }, []);

  const pushSettings = useCallback(
    (silent = false) => {
      if (!deviceProfile) {
        if (!silent) toast.error("Pick a printer first — it defines the machine profile.");
        return false;
      }
      const process: Record<string, unknown> = {
        ...DEFAULT_PROCESS,
        sliceHeight: layerHeight,
        sliceShells: shells,
        sliceFillSparse: fill / 100,
        supportEnable: support,
      };
      send({ process });
      send({ device: deviceProfile });
      return true;
    },
    [deviceProfile, layerHeight, shells, fill, support, send],
  );

  // React to messages from the Kiri iframe.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== "https://grid.space") return;
      const data = ev.data as { event?: string; data?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.event) {
        const name = data.event;
        setLog((l) => [name, ...l].slice(0, 40));
        if (name === "load-done" || name === "init-done") {
          setReady(true);
          setFrameBusy(null);
        }
        if (name === "loaded") {
          setFrameBusy(null);
          toast.success("Model loaded — adjust settings, then slice.");
        }
        if (name.startsWith("slice.progress") || name.startsWith("sliced.progress")) {
          const p = (data.data as number) ?? 0;
          setProgress(Math.round(p * 100));
        }
        if (name === "sliced" || name === "slice.done") {
          setSliced(true);
          setProgress(100);
          setFrameBusy(null);
          toast.success("Sliced — preview the toolpaths inside the frame.");
        }
        if (name === "prepared" || name === "prepare.done") setFrameBusy(null);
        if (name === "exported" || name === "export.done") setFrameBusy(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Mark ready once the frame has fully loaded (belt + braces with events).
  const onFrameLoad = () => {
    setTimeout(() => setReady(true), 2500);
  };

  const pickFile = () => fileRef.current?.click();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(stl|3mf|gcode|svg)$/i.test(file.name)) {
      toast.error("Kiri:Moto accepts STL, 3MF, GCODE and SVG files.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const type = /\.stl$/i.test(file.name) ? "stl" : /\.3mf$/i.test(file.name) ? "3mf" : /\.gcode$/i.test(file.name) ? "gcode" : "svg";
      send({ parse: reader.result, type, name: file.name });
      setFrameBusy("Loading model…");
    };
    if (/\.(stl|3mf|gcode)$/i.test(file.name)) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const doSlice = () => {
    if (!pushSettings()) return;
    setProgress(0);
    setSliced(false);
    setFrameBusy("Slicing…");
    send({ function: "slice", callback: true });
    setTimeout(() => send({ function: "prepare", callback: true }), 400);
  };

  const doExport = () => {
    if (!sliced) {
      toast.error("Slice the model first.");
      return;
    }
    send({ function: "export", callback: false });
  };

  const doClear = () => {
    send({ clear: true });
    setSliced(false);
    setProgress(0);
  };

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[560px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <span className="text-sm font-semibold">Slicer Studio</span>
          <Badge variant="outline" className="text-[11px]">Kiri:Moto · embedded</Badge>
          {jobContext && (
            <Badge variant="secondary" className="text-[11px]">for “{jobContext.name}”</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => window.location.reload()}>
            <RefreshCw className="size-3.5" /> Reload
          </Button>
          <a href={KIRI_URL} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <ExternalLink className="size-3.5" /> Open full
            </Button>
          </a>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_1fr]">
        {/* Control rail */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-card/60 p-3">
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Printer className="size-3.5" /> Machine profile
            </Label>
            <Select value={printerId || "none"} onValueChange={setPrinterId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Choose printer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None selected</SelectItem>
                {printers.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Layers className="size-3.5" /> Spool (material)
            </Label>
            <Select value={filamentId || "none"} onValueChange={setFilamentId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Choose spool" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None selected</SelectItem>
                {filaments.map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {f.material} · {f.colorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <SlidersHorizontal className="size-3.5" /> Process
              </Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => pushSettings()}
                disabled={!printerId}
              >
                Push
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Layer {layerHeight} mm</span>
                <Slider value={[layerHeight]} min={0.08} max={0.32} step={0.04} onValueChange={(v) => setLayerHeight(v[0])} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Fill {fill}%</span>
                <Slider value={[fill]} min={5} max={100} step={5} onValueChange={(v) => setFill(v[0])} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Shells {shells}</span>
                <Slider value={[shells]} min={1} max={5} step={1} onValueChange={(v) => setShells(v[0])} />
              </div>
              <div className="flex items-center justify-between rounded border px-2 py-1.5">
                <span className="text-[11px] text-muted-foreground">Support</span>
                <Switch checked={support} onCheckedChange={setSupport} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="h-8 text-xs" onClick={doSlice} disabled={frameBusy !== null}>
              {frameBusy === "Slicing…" ? <Loader2 className="size-3.5 animate-spin" /> : <Layers className="size-3.5" />}
              Slice
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={doExport} disabled={!sliced}>
              <Download className="size-3.5" /> GCODE
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={pickFile} disabled={!ready}>
              <FileUp className="size-3.5" /> Load file
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={doClear}>
              <Trash2 className="size-3.5" /> Clear
            </Button>
          </div>
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

          {progress > 0 && progress < 100 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> slicing… {progress}%
            </div>
          )}

          {log.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background/60 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
              {log.map((line, i) => (
                <p key={`${i}-${line}`}>▸ {line}</p>
              ))}
            </div>
          )}

          <p className="mt-auto text-[10px] leading-4 text-muted-foreground">
            {filament
              ? `Spool noted: ${filament.material} · ${filament.colorName} (${filament.remainingG} g left). Record the sliced estimate when scheduling.`
              : "Selecting a spool is optional — it just reminds you which material to record."}
          </p>
        </div>

        {/* Embedded Kiri frame */}
        <div className="relative min-h-0 overflow-hidden rounded-lg border bg-zinc-950">
          {!ready && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-950/90 text-zinc-300">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-sm">Loading Kiri:Moto…</p>
              <p className="text-xs text-muted-foreground">If it never loads, check your network — grid.space must be reachable.</p>
            </div>
          )}
          <iframe
            ref={frameRef}
            src={KIRI_URL}
            title="Kiri:Moto slicer"
            className="h-full w-full border-0"
            allow="clipboard-write; fullscreen"
            onLoad={onFrameLoad}
          />
        </div>
      </div>
    </div>
  );
}
