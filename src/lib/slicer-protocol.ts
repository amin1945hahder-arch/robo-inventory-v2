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
 *   parent → kiri : { parse: data, type:"stl" }           (load model)
 *   parent → kiri : { clear:true } | { mode:"FDM" }
 *   kiri → parent : { event:"<fn>.done", data }           (callback reply)
 *   kiri → parent : { event:"slice.done"|"prepare.done", data:mode }
 *   kiri → parent : { event:"parsed"|"loaded", data:[ids] }
 *   kiri → parent : { process } | { device } | { mode }   ({get} replies)
 *   kiri → parent : { event:"export.done", data:"<gcode>" }
 *
 * The {function} callback fires when the synchronous call RETURNS — for
 * `export` that means "export accepted, dialog/gcode started", NOT "gcode
 * ready". The gcode itself arrives via the `export.done` EVENT. Treating the
 * callback as the payload is the classic bug that makes "Get G-code" spin or
 * resolve empty.
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
  | "slice.done"
  | "prepare.done"
  | "export.done"
  | "loaded"
  | "parsed"
  | "init-done"
  | "error"
  | string;

export type KiriReply =
  | { kind: "event"; event: KiriEventName; data?: unknown }
  | { kind: "process"; process: Record<string, unknown> }
  | { kind: "device"; device: Record<string, unknown> }
  | { kind: "mode"; mode: unknown }
  | { kind: "widgets"; widgets: KiriWidgetInfo[] }
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
  if ("mode" in d) {
    return { kind: "mode", mode: d.mode };
  }
  return { kind: "unknown" };
}

/**
 * Names Kiri emits while a model file parses/loads. Used to end the
 * "Loading model…" busy state even when Kiri's own UI stays quiet.
 */
export const MODEL_LOAD_EVENTS = new Set(["parsed", "loaded", "load-done"]);

/** Names Kiri emits when a model file fails to parse/load. */
export const MODEL_LOAD_ERROR_EVENTS = new Set(["parse.error", "load.error", "error"]);

/**
 * Names that mean "the slicer is alive" — the first of these flips the
 * bridge to ready (init-done can be missed if we attach late).
 */
export const READY_EVENTS = new Set(["init-done", "preset", "mode.set"]);

// ---- export job flow (wait for the EVENT, never the callback) ---------------

export type ExportPhase = "idle" | "requested" | "done" | "failed";

export type ExportJob = {
  phase: ExportPhase;
  /** G-code captured from the export.done event payload. */
  gcode?: string;
};

/**
 * Advance the export flow. Rules:
 *  - `export.done` with a non-empty string payload → done + gcode
 *  - `export.done` with an empty payload → failed (kiri had nothing to export)
 *  - `error` events while requested → failed
 *  - duplicate/late events after done/failed are ignored
 */
export function exportJobTransition(
  job: ExportJob,
  event:
    | { type: "request" }
    | { type: "export.done"; payload: unknown }
    | { type: "error" }
    | { type: "reset" },
): ExportJob {
  switch (event.type) {
    case "reset":
      return { phase: "idle" };
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
      return job.phase === "requested" ? { phase: "failed" } : job;
    default:
      return job;
  }
}

/**
 * Deadline for the export flow: how long to wait for `export.done` before the
 * UI should surface a timeout instead of spinning. 0 = no timer needed.
 */
export function exportTimeoutMs(phase: ExportPhase): number {
  switch (phase) {
    case "requested":
      return 60_000; // large gcode assembly can take a while, but not forever
    default:
      return 0;
  }
}

/** Milliseconds to wait for {get} replies before surfacing "no data". */
export const GET_REPLY_GRACE_MS = 600;

/**
 * How many times to retry the {get} handshake when the slicer has loaded but
 * answers with nothing (happens right at init while conf loads).
 */
export const GET_RETRY_MAX = 3;

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
