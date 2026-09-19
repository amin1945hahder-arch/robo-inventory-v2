/**
 * Kiri:Moto frame-protocol helpers (pure + testable).
 *
 * The embedded slicer lives at /slicer/ (self-hosted Kiri:Moto v4.7.3, same
 * origin, so its replies actually arrive — grid.space drops them). Wire shape
 * verified against the bundle's frame handler:
 *
 *   parent → kiri : { function:"slice"|"prepare"|"export", callback:true }
 *   parent → kiri : { get:"process"|"device" }            (async reply)
 *   parent → kiri : { process:{...} } | { device:{...} }  (push settings)
 *   parent → kiri : { clear:true } | { mode:"FDM" }
 *   kiri → parent : { event:"<fn>.done", data }           (callback reply)
 *   kiri → parent : { event:"slice.end", data:mode }      (REAL completion)
 *   kiri → parent : { event:"export.done", data:"<gcode>" }
 *   kiri → parent : { process } | { device } | { mode }   ({get} replies)
 *
 * CRITICAL timing facts (read from the 4.7.3 bundle, `kiri.js`):
 *  - The `{function}` callback reply fires when the call *returns*, not when
 *    the work finishes. For `slice` that is an instant ACK — the real
 *    completion signal is the `slice.end` event emitted after the slicing
 *    worker drains (`jC.slice=true; emit("slice.end", mode); ... cb(...)`).
 *    Treating the ack as completion is what made the slice button spin
 *    forever while Kiri had already finished.
 *  - For `export` the callback DOES fire at completion with the joined
 *    G-code (`cb(gcode, mode)`) — so `export.done` carries the payload.
 *  - Export needs preview toolpaths to exist. Requesting export before the
 *    preview is ready makes Kiri defer silently (it can hang the modal
 *    queue), so the UI sequence must be: slice → slice.end → prepare →
 *    prepare.done → export → export.done(gcode). Preparing WHILE Kiri is
 *    still slicing jams its modal queue — that was the original freeze bug.
 */

// ---- outbound wire builders -------------------------------------------------

export type KiriFrameMessage = Record<string, unknown>;

export const kiriMsg = {
  getMode: (): KiriFrameMessage => ({ get: "mode" }),
  getProcess: (): KiriFrameMessage => ({ get: "process" }),
  getDevice: (): KiriFrameMessage => ({ get: "device" }),
  setMode: (mode: "FDM" | "CAM" | "SLA" | "LASER"): KiriFrameMessage => ({ mode }),
  setDevice: (device: Record<string, unknown>): KiriFrameMessage => ({ device }),
  setProcess: (process: Record<string, unknown>): KiriFrameMessage => ({ process }),
  parse: (data: unknown, type: string): KiriFrameMessage => ({ parse: data, type }),
  load: (url: string): KiriFrameMessage => ({ load: url }),
  getWidgets: (): KiriFrameMessage => ({ get: "widgets" }),
  clear: (): KiriFrameMessage => ({ clear: true }),
  slice: (): KiriFrameMessage => ({ function: "slice", callback: true }),
  prepare: (): KiriFrameMessage => ({ function: "prepare", callback: true }),
  export: (): KiriFrameMessage => ({ function: "export", callback: true }),
} as const;

// ---- inbound classification -------------------------------------------------

export type KiriEventName =
  | "slice.begin"
  | "slice.end"
  | "slice.error"
  | "slice.done"
  | "prepare.done"
  | "preview.end"
  | "export.done"
  | "init-done"
  | "error"
  | string;

export type KiriReply =
  | { kind: "event"; event: KiriEventName; data?: unknown }
  | { kind: "process"; process: Record<string, unknown> }
  | { kind: "device"; device: Record<string, unknown> }
  | { kind: "mode"; mode: unknown }
  | { kind: "widgets"; widgets: KiriWidgetInfo[] }
  | { kind: "all"; all: Record<string, unknown> }
  | { kind: "unknown" };

/** Shape of one entry in a `{get:"widgets"}` reply (id + meta.file). */
export type KiriWidgetInfo = { id?: string | number; meta?: { file?: unknown } };

/**
 * Classify a postMessage arriving FROM the kiri frame. {get} replies are bare
 * objects ({process:…} / {device:…} / {mode:…}); everything with an `event`
 * key is a named event. Anything else is noise from other app code (the app
 * itself postMessages route changes etc.) and MUST be ignored.
 */
export function classifyKiriReply(data: unknown): KiriReply {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { kind: "unknown" };
  }
  const d = data as Record<string, unknown>;
  if (typeof d.event === "string") {
    return { kind: "event", event: d.event, data: d.data };
  }
  if (d.process && typeof d.process === "object") {
    return { kind: "process", process: d.process as Record<string, unknown> };
  }
  if (Array.isArray(d.widgets)) {
    return { kind: "widgets", widgets: d.widgets as KiriWidgetInfo[] };
  }
  if (d.device && typeof d.device === "object") {
    return { kind: "device", device: d.device as Record<string, unknown> };
  }
  if (d.all && typeof d.all === "object") {
    return { kind: "all", all: d.all as Record<string, unknown> };
  }
  if ("mode" in d) {
    return { kind: "mode", mode: d.mode };
  }
  return { kind: "unknown" };
}

/** Events that mark the slicer bridge as alive (whichever comes first). */
export const READY_EVENTS = new Set(["init-done", "preset", "load-done", "mode.set"]);

/** Emitted when the slicing worker STARTS. */
export const SLICE_BEGIN_EVENTS = new Set(["slice.begin"]);
/** Emitted when the slicing worker FINISHES — the real completion signal. */
export const SLICE_END_EVENTS = new Set(["slice.end"]);
/** Failure variants reported by the slicer. */
export const SLICE_ERROR_EVENTS = new Set(["slice.error", "error"]);
/** Preview (prepare) finished — export may proceed. */
export const PREVIEW_END_EVENTS = new Set(["prepare.done", "preview.end"]);
/** Export finished; payload is the joined G-code string (or empty on failure). */
export const EXPORT_END_EVENTS = new Set(["export.done"]);
/** Generic failure events while a job is in flight. */
export const JOB_ERROR_EVENTS = new Set([
  "slice.error",
  "prepare.error",
  "export.error",
  "error",
]);

/**
 * Emitted while a model file parses/loads (frame-parse path only — Kiri's own
 * import emits none; the widgets poll is the universal verification). Note:
 * `load-done` is Kiri's BOOT completion event, not a model event.
 */
export const MODEL_LOAD_EVENTS = new Set(["parsed", "loaded"]);
/** Events that mean a model file failed to parse/load. */
export const MODEL_LOAD_ERROR_EVENTS = new Set(["parse.error", "load.error"]);

// ---- slice flow state machine ----------------------------------------------

export type SlicePhase = "idle" | "slicing" | "sliced" | "failed";

export type SliceEvent =
  | { type: "request" }
  | { type: "begin" }
  | { type: "end" }
  | { type: "ack" }
  | { type: "error" }
  | { type: "model-change" }
  | { type: "reset" };

/**
 * Advance the slice flow.
 *  - `request`  → slicing (the ack comes back instantly; keep spinning)
 *  - `ack`      → no-op (the `{function}.done` callback reply — NOT completion)
 *  - `begin`    → no-op (already slicing; defensive against lost requests)
 *  - `end`      → sliced (the real completion — works for slices started from
 *                 Kiri's own button too, since the event comes off the bus)
 *  - `error`    → failed
 *  - `model-change` → a new model landed on the bed → old toolpaths are stale
 *  - `reset`    → idle
 */
export function sliceFlowTransition(phase: SlicePhase, event: SliceEvent): SlicePhase {
  switch (event.type) {
    case "reset":
      return "idle";
    case "request":
      return phase === "slicing" ? phase : "slicing";
    case "begin":
      return phase === "slicing" ? phase : "slicing";
    case "end":
      return "sliced";
    case "ack":
      return phase;
    case "error":
      return phase === "slicing" ? "failed" : phase;
    case "model-change":
      return phase === "sliced" ? "idle" : phase;
    default:
      return phase;
  }
}

/**
 * Deadline (ms) after which the UI should give up waiting for the phase to
 * resolve and re-enable controls instead of spinning forever. 0 = none.
 */
export function sliceTimeoutMs(phase: SlicePhase): number {
  switch (phase) {
    case "slicing":
      return 10 * 60_000; // big models legitimately take minutes
    case "failed":
      return 0;
    default:
      return 0;
  }
}

// ---- export/preview flow state machine -------------------------------------

export type ExportPhase = "idle" | "preparing" | "requested" | "done" | "failed";

export type ExportJob = {
  phase: ExportPhase;
  /** G-code captured from the export.done event payload. */
  gcode?: string;
};

export type ExportEvent =
  | { type: "prepare" }
  | { type: "prepare.done" }
  | { type: "request" }
  | { type: "export.done"; payload: unknown }
  | { type: "error" }
  | { type: "reset" };

/**
 * Advance the capture flow.
 *  - `prepare`      → preparing (preview toolpaths must exist before export)
 *  - `prepare.done` → requested (bridge should now send {function:export})
 *  - `request`      → requested directly (caller already knows preview is done)
 *  - `export.done`  → done + gcode (payload non-empty), else failed
 *  - `error`        → failed (while preparing/requested)
 *  - `reset`        → idle
 */
export function exportJobTransition(
  job: ExportJob,
  event: ExportEvent,
): ExportJob {
  switch (event.type) {
    case "reset":
      return { phase: "idle" };
    case "prepare":
      return job.phase === "preparing" || job.phase === "requested"
        ? job
        : { phase: "preparing" };
    case "prepare.done":
      return job.phase === "preparing" ? { phase: "requested" } : job;
    case "request":
      return job.phase === "requested" ? job : { phase: "requested" };
    case "export.done": {
      if (job.phase !== "requested") return job; // stale duplicate
      const payload = event.payload;
      if (typeof payload === "string" && payload.trim().length > 0) {
        return { phase: "done", gcode: payload };
      }
      return { phase: "failed" };
    }
    case "error":
      return job.phase === "preparing" || job.phase === "requested"
        ? { phase: "failed" }
        : job;
    default:
      return job;
  }
}

/**
 * Deadline for the capture flow: how long to wait before surfacing a timeout
 * instead of spinning. 0 = no timer needed.
 */
export function exportTimeoutMs(phase: ExportPhase): number {
  switch (phase) {
    case "preparing":
      return 90_000; // preview render can take a while on big models
    case "requested":
      return 60_000; // gcode assembly after preview
    default:
      return 0;
  }
}

// ---- settings collector ------------------------------------------------------

/** Milliseconds to wait for {get} replies before the first check. */
export const GET_REPLY_GRACE_MS = 600;

/**
 * The collector retries the {get} handshake until both process AND device
 * arrive (replies can be missed while Kiri boots its conf). After the retry
 * budget, whatever arrived is shown — partial data beats an error.
 */
export const GET_RETRY_MAX = 8;
export const GET_RETRY_DELAY_MS = 700;

// ---- model-load verification -----------------------------------------------

/**
 * How often to poll `{get:"widgets"}` after a load attempt, and for how long
 * total, before declaring the model absent. Kiri's own import path emits no
 * completion event we can catch, so polling is the only reliable signal.
 */
export const WIDGET_POLL_DELAY_MS = 400;
export const WIDGET_POLL_MAX_MS = 12_000;

/**
 * How often the idle bridge re-syncs the bed state (widgets) so models
 * imported from Kiri's own menus show up in the app without any action.
 */
export const WIDGET_IDLE_SYNC_MS = 2_500;

/**
 * Extract the file name of the (first) widget currently on the bed.
 * Kiri sets `meta.file` for files imported from disk; anonymous/converted
 * widgets may lack it. Returns null when the bed is empty.
 */
export function widgetFileName(widgets: KiriWidgetInfo[] | undefined | null): string | null {
  if (!Array.isArray(widgets)) return null;
  for (const w of widgets) {
    const f = w?.meta?.file;
    if (typeof f === "string" && f.trim()) return f.trim();
  }
  return null;
}

/**
 * Strip an extension from a file name for use as a job name.
 * "bracket_v2.stl" → "bracket_v2"; also cleans URL-ish names.
 */
export function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/\\/g, "/").split("/").pop() || name;
}

export type LoadAttempt =
  | { kind: "file-input"; fileName: string }
  | { kind: "frame-parse"; fileName: string; type: string }
  | { kind: "frame-url"; fileName: string };

/**
 * Plan how to load a model file into the embedded Kiri frame, safest first.
 *
 * The frame handler's `{parse: type:"stl"}` branch is broken in Kiri 4.7.3:
 * it re-wraps binary payloads with `new Float32Array(...)` (throws for most
 * binary STLs — the byte length 84+50n is rarely a multiple of 4) and passes
 * its done-callback where the unit-scale number belongs, producing NaN
 * vertices when it does not throw. Kiri's own import path (its hidden
 * load-file input) parses every format correctly, so we always prefer that.
 */
export function planModelLoad(file: {
  name: string;
  isText: boolean;
  hasFrameSupport: boolean;
}): LoadAttempt {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  // Only gcode is safe through the frame parse path (text → function.parse).
  if (file.hasFrameSupport && ext === "gcode" && file.isText) {
    return { kind: "frame-parse", fileName: file.name, type: "gcode" };
  }
  return { kind: "file-input", fileName: file.name };
}
