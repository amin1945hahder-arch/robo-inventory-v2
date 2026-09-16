/**
 * Pure helpers for the Slicer Studio → Kiri:Moto bridge (self-hosted v4.7.3).
 *
 * The embedded Kiri:Moto instance is the single source of truth for every
 * slicing setting. The app:
 *   1. reads the slicer's process + device over the frame message API
 *      ({get:"process"} → {process}, {get:"device"} → {device})
 *   2. turns them into a human-readable snapshot (grouped spec cards)
 *   3. after a slice, receives the G-code via {function:"export",callback:true}
 *      and parses filament/time from Kiri's standard footer comments:
 *        `; --- filament used: 1234.5 mm ---`
 *        `; --- print time: 5400s ---`
 *
 * The G-code itself NEVER goes to the database — it stays in browser memory
 * and is downloaded locally. Only the parsed stats + settings snapshot are
 * submitted with the approval request.
 */

export type KiriProcess = Record<string, unknown>;
export type KiriDevice = Record<string, unknown>;

export type SpecRow = { label: string; value: string };
export type SpecGroup = { id: string; title: string; rows: SpecRow[] };

export type SlicerSnapshot = {
  capturedAt: number;
  mode: string;
  deviceName: string;
  groups: SpecGroup[];
  raw: { process: KiriProcess; device: KiriDevice };
};

export type GcodeStats = {
  grams: number;
  minutes: number;
  lines: number;
  bytes: number;
};

const dash = "—";

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === "") return dash;
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : dash;
  if (typeof v === "boolean" || typeof v === "object") return dash;
  return String(v);
}

function withUnit(v: unknown, unit: string): string {
  const s = fmt(v);
  return s === dash ? dash : `${s} ${unit}`;
}

function pct(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : dash;
}

/**
 * Turn Kiri's raw process/device objects into grouped spec sections.
 * Missing values render as "—" so users can see exactly what the slicer
 * did and did not configure.
 */
export function snapshotFromKiri(
  process: KiriProcess | undefined,
  device: KiriDevice | undefined,
): SlicerSnapshot {
  const p = process ?? {};
  const d = device ?? {};
  const groups: SpecGroup[] = [];

  groups.push({
    id: "layers",
    title: "Layers",
    rows: [
      { label: "Layer height", value: withUnit(p.sliceHeight, "mm") },
      { label: "First layer height", value: withUnit(p.firstSliceHeight, "mm") },
      { label: "Start point", value: fmt(p.sliceLayerStart) },
      { label: "Top layers", value: fmt(p.sliceTopLayers) },
      { label: "Bottom layers", value: fmt(p.sliceBottomLayers) },
      { label: "Adaptive height", value: p.sliceAdaptive === true ? "On" : p.sliceAdaptive === false ? "Off" : dash },
    ],
  });

  groups.push({
    id: "shells",
    title: "Shells",
    rows: [
      { label: "Shell count", value: fmt(p.sliceShells) },
      { label: "Shell order", value: fmt(p.sliceShellOrder) },
      { label: "Line width", value: withUnit(p.sliceLineWidth, "mm") },
      { label: "Thin walls", value: p.sliceDetectThin ? fmt(p.sliceDetectThin) : dash },
    ],
  });

  groups.push({
    id: "fill",
    title: "Fill",
    rows: [
      { label: "Fill type", value: fmt(p.sliceFillType) },
      { label: "Fill amount", value: pct(p.sliceFillSparse) },
      { label: "Fill angle", value: withUnit(p.sliceFillAngle, "°") },
      { label: "Fill overlap", value: fmt(p.sliceFillOverlap) },
      { label: "Fill repeat", value: fmt(p.sliceFillRepeat) },
    ],
  });

  groups.push({
    id: "heating",
    title: "Heating",
    rows: [
      { label: "Nozzle temp", value: withUnit(p.outputTemp, "°C") },
      { label: "Bed temp", value: withUnit(p.outputBedTemp, "°C") },
      { label: "First layer nozzle", value: withUnit(p.firstLayerNozzleTemp, "°C") },
      { label: "First layer bed", value: withUnit(p.firstLayerBedTemp, "°C") },
      { label: "Fan from layer", value: fmt(p.outputFanLayer) },
    ],
  });

  const rawSupport = typeof p.sliceSupportType === "string" ? p.sliceSupportType.trim() : "";
  const supportType = !rawSupport || rawSupport.toLowerCase() === "disabled" ? "Disabled" : rawSupport;
  const supportRows: SpecRow[] = [{ label: "Type", value: supportType }];
  if (supportType !== "Disabled" && supportType !== dash) {
    supportRows.push(
      { label: "Angle", value: withUnit(p.sliceSupportAngle, "°") },
      { label: "Density", value: pct(p.sliceSupportDensity) },
      { label: "Part offset", value: withUnit(p.sliceSupportOffset, "mm") },
      { label: "Expand", value: withUnit(p.sliceSupportExtra, "mm") },
      { label: "Enclosed", value: p.sliceSupportOutline === true ? "Yes" : p.sliceSupportOutline === false ? "No" : dash },
      { label: "Layer gap", value: p.sliceSupportGap === true ? "Yes" : p.sliceSupportGap === false ? "No" : dash },
      { label: "Tree type", value: p.sliceSupportTree === true ? "Tree" : p.sliceSupportTree === false ? "Linear" : dash },
    );
  }
  groups.push({ id: "support", title: "Support", rows: supportRows });

  groups.push({
    id: "output",
    title: "Output",
    rows: [
      { label: "Print speed", value: withUnit(p.outputFeedrate, "mm/s") },
      { label: "Finish speed", value: withUnit(p.outputFinishrate, "mm/s") },
      { label: "Move speed", value: withUnit(p.outputSeekrate, "mm/s") },
      { label: "First layer speed", value: withUnit(p.firstLayerRate, "mm/s") },
      { label: "Retraction", value: withUnit(p.outputRetractDist, "mm") },
      { label: "Retract dwell", value: withUnit(p.outputRetractDwell, "ms") },
      { label: "Z hop", value: withUnit(p.zHopDistance, "mm") },
      { label: "Brim", value:
          Number(p.outputBrimCount) > 0
            ? `${fmt(p.outputBrimCount)} lines × ${fmt(p.outputBrimOffset)} mm`
            : "Off" },
      { label: "Draft shield", value: p.outputDraftShield === true ? "On" : p.outputDraftShield === false ? "Off" : dash },
    ],
  });

  const raftRows: SpecRow[] = [{ label: "Raft", value: p.outputRaft === true ? "Enabled" : p.outputRaft === false ? "Disabled" : dash }];
  if (p.outputRaft === true) {
    raftRows.push(
      { label: "Strike count", value: fmt(p.outputBrimCount) },
      { label: "Strike offset", value: withUnit(p.outputBrimOffset, "mm") },
      { label: "Raft gap", value: withUnit(p.outputRaftSpacing, "mm") },
    );
  }
  groups.push({ id: "raft", title: "Raft", rows: raftRows });

  const extruders = Array.isArray(d.extruders) ? (d.extruders as KiriDevice[]) : [];
  const tool0 = extruders[0] ?? {};
  groups.push({
    id: "device",
    title: "Machine",
    rows: [
      { label: "Device", value: fmt(d.deviceName) },
      { label: "Bed", value: d.bedWidth !== undefined ? `${fmt(d.bedWidth)} × ${fmt(d.bedDepth)} mm` : dash },
      { label: "Max height", value: withUnit(d.maxHeight, "mm") },
      { label: "Nozzle", value: withUnit(tool0.extNozzle, "mm") },
      { label: "Filament", value: withUnit(tool0.extFilament, "mm") },
      { label: "Mode", value: fmt(d.mode) },
    ],
  });

  return {
    capturedAt: Date.now(),
    mode: d.mode === undefined || d.mode === "" ? "FDM" : fmt(d.mode),
    deviceName: fmt(d.deviceName),
    groups,
    raw: { process: p, device: d },
  };
}

/**
 * Parse filament weight (grams) and print duration (minutes) out of the
 * G-code text. Kiri stamps both in standard footer comments; filament mm is
 * converted using the filament cross-section and material density
 * (defaults: 1.75 mm PLA @ 1.24 g/cm³).
 */
export function parseGcodeStats(
  gcode: string,
  filamentDiameterMm = 1.75,
  densityGCm3 = 1.24,
): GcodeStats {
  const lines = gcode ? gcode.split("\n").length : 0;
  let filamentMm: number | undefined;
  let seconds: number | undefined;
  for (const line of gcode.split("\n")) {
    if (filamentMm === undefined) {
      const m = line.match(/filament used:\s*([\d.]+)\s*mm/i);
      if (m) filamentMm = Number(m[1]);
    }
    if (seconds === undefined) {
      const m = line.match(/print time:\s*([\d.]+)\s*s/i);
      if (m) seconds = Number(m[1]);
    }
    if (filamentMm !== undefined && seconds !== undefined) break;
  }
  const areaMm2 = Math.PI * (filamentDiameterMm / 2) ** 2;
  const grams =
    filamentMm !== undefined
      ? Math.round(((filamentMm * areaMm2) / 1000) * densityGCm3 * 100) / 100
      : 0;
  const minutes = seconds !== undefined ? Math.max(1, Math.round(seconds / 60)) : 0;
  return { grams, minutes, lines, bytes: gcode.length };
}

/**
 * Compact text summary of a snapshot for the approval note — skips rows the
 * slicer left unset (—) as well as default-off pseudo-values (Disabled / Off),
 * so the note only carries what was actively configured. The full snapshot is
 * stored with the job either way.
 */
export function snapshotToNote(snapshot: SlicerSnapshot, maxLines = 48): string {
  const noise = new Set([dash, "Disabled", "Off"]);
  const lines: string[] = [];
  for (const group of snapshot.groups) {
    const filled = group.rows.filter((r) => !noise.has(r.value));
    if (filled.length === 0) continue;
    lines.push(`${group.title}: ${filled.map((r) => `${r.label.toLowerCase()} ${r.value}`).join(", ")}`);
  }
  return lines.slice(0, maxLines).join("\n");
}

// ===== Slice flow state machine =============================================
//
// In Kiri 4.7.3 slicing a model runs {function:"slice"} → `slice.done`, then
// the toolpath preview needs {function:"prepare"} → `prepare.done`. Both
// callbacks report through ONE postMessage channel, and a crashed worker can
// stall the chain forever, so the UI needs explicit, testable rules for
// driving and abandoning the two-step flow.

export type FlowStep = "idle" | "slicing" | "sliced" | "preparing" | "prepared" | "failed";

/**
 * What a bridge event means for the slice flow.
 * `null` = event does not affect the flow.
 */
export function flowTransition(
  step: FlowStep,
  event: { kind: "slice_done" | "prepare_done" | "slice_error" | "reset" | "other"; hasModel?: boolean },
): { next: FlowStep; sendPrepare: boolean } {
  switch (event.kind) {
    case "reset":
      return { next: "idle", sendPrepare: false };
    case "slice_done":
      // Only honor slice.done when we are actually waiting for it — stale or
      // duplicate events (double click, late worker reply) must not restart
      // the flow or clobber a later state.
      if (step !== "slicing") return { next: step, sendPrepare: false };
      return { next: "sliced", sendPrepare: true };
    case "prepare_done":
      return { next: "prepared", sendPrepare: false };
    case "slice_error":
      return { next: "failed", sendPrepare: false };
    default:
      return { next: step, sendPrepare: false };
  }
}

/** The flow is done enough to allow G-code capture + export. */
export function flowAllowsExport(step: FlowStep): boolean {
  return step === "sliced" || step === "prepared";
}

/**
 * Deadline (ms since flow start) after which the UI should give up waiting
 * for a reply and re-enable the controls instead of spinning forever.
 * 0 = no deadline for this step.
 */
export function flowTimeoutMs(step: FlowStep): number {
  switch (step) {
    case "slicing":
      return 10 * 60_000; // big models legitimately take minutes
    case "preparing":
      return 90_000;
    default:
      return 0;
  }
}

/** Milliseconds to wait after requesting a `{get}` reply before surfacing "no data". */
export const GET_REPLY_GRACE_MS = 500;

/** Which flow step a bridge message advances (or null when unrelated). */
export function classifyEvent(data: Record<string, unknown>): {
  kind: "slice_done" | "prepare_done" | "slice_error" | "reset" | "other";
} {
  if (typeof data.event !== "string") return { kind: "other" };
  switch (data.event) {
    case "slice.done":
      return { kind: "slice_done" };
    case "prepare.done":
      return { kind: "prepare_done" };
    case "slice.error":
    case "export.error":
    case "error":
      return { kind: "slice_error" };
    default:
      return { kind: "other" };
  }
}
