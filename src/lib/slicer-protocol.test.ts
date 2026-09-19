import { describe, expect, it } from "vitest";
import {
  classifyKiriReply,
  exportJobTransition,
  exportTimeoutMs,
  fileBaseName,
  GET_REPLY_GRACE_MS,
  GET_RETRY_MAX,
  JOB_ERROR_EVENTS,
  kiriMsg,
  MODEL_LOAD_EVENTS,
  planModelLoad,
  PREVIEW_END_EVENTS,
  READY_EVENTS,
  SLICE_BEGIN_EVENTS,
  SLICE_END_EVENTS,
  sliceFlowTransition,
  sliceTimeoutMs,
  widgetFileName,
  WIDGET_IDLE_SYNC_MS,
  WIDGET_POLL_DELAY_MS,
  WIDGET_POLL_MAX_MS,
} from "./slicer-protocol";

describe("kiriMsg wire builders", () => {
  it("builds function calls with callback:true", () => {
    expect(kiriMsg.slice()).toEqual({ function: "slice", callback: true });
    expect(kiriMsg.prepare()).toEqual({ function: "prepare", callback: true });
    expect(kiriMsg.export()).toEqual({ function: "export", callback: true });
  });

  it("builds get requests for process, device, mode and widgets", () => {
    expect(kiriMsg.getProcess()).toEqual({ get: "process" });
    expect(kiriMsg.getDevice()).toEqual({ get: "device" });
    expect(kiriMsg.getMode()).toEqual({ get: "mode" });
    expect(kiriMsg.getWidgets()).toEqual({ get: "widgets" });
  });

  it("builds settings pushes and model loads", () => {
    expect(kiriMsg.setDevice({ deviceName: "X" })).toEqual({ device: { deviceName: "X" } });
    expect(kiriMsg.setProcess({ outputTemp: 205 })).toEqual({ process: { outputTemp: 205 } });
    expect(kiriMsg.parse("data", "stl")).toEqual({ parse: "data", type: "stl" });
    expect(kiriMsg.clear()).toEqual({ clear: true });
  });
});

describe("classifyKiriReply", () => {
  it("classifies named events with payloads", () => {
    expect(classifyKiriReply({ event: "slice.end", data: "FDM" })).toEqual({
      kind: "event",
      event: "slice.end",
      data: "FDM",
    });
    expect(classifyKiriReply({ event: "export.done", data: "G1 X0" })).toEqual({
      kind: "event",
      event: "export.done",
      data: "G1 X0",
    });
  });

  it("classifies bare {get} replies (no event key)", () => {
    expect(classifyKiriReply({ process: { sliceShells: 3 } })).toEqual({
      kind: "process",
      process: { sliceShells: 3 },
    });
    expect(classifyKiriReply({ device: { deviceName: "Ender" } })).toEqual({
      kind: "device",
      device: { deviceName: "Ender" },
    });
    expect(classifyKiriReply({ mode: "FDM" })).toEqual({ kind: "mode", mode: "FDM" });
  });

  it("classifies the {get:widgets} reply shape from the 4.7.3 bundle", () => {
    // Exact shape emitted by Kiri's frame handler:
    // { widgets: tl.all().map(Q => ({id: Q.id, meta: Q.meta, track: Q.track})) }
    const reply = classifyKiriReply({
      widgets: [{ id: "w1", meta: { file: "bracket.stl" }, track: 1 }],
    });
    expect(reply.kind).toBe("widgets");
    if (reply.kind === "widgets") {
      expect(widgetFileName(reply.widgets)).toBe("bracket.stl");
    }
    // Empty bed → classified as widgets with an empty list, no file name.
    const empty = classifyKiriReply({ widgets: [] });
    expect(empty.kind).toBe("widgets");
    if (empty.kind === "widgets") expect(widgetFileName(empty.widgets)).toBeNull();
  });

  it("classifies the default {get} reply ({all: settings})", () => {
    expect(classifyKiriReply({ all: { mode: "FDM" } }).kind).toBe("all");
  });

  it("ignores non-kiri noise (app route pings, primitives)", () => {
    expect(classifyKiriReply(null).kind).toBe("unknown");
    expect(classifyKiriReply("hello").kind).toBe("unknown");
    expect(classifyKiriReply(undefined).kind).toBe("unknown");
    expect(classifyKiriReply(["x"]).kind).toBe("unknown");
    expect(classifyKiriReply({ type: "iframe-route-change", path: "/" }).kind).toBe("unknown");
    expect(classifyKiriReply({ random: true }).kind).toBe("unknown");
  });
});

describe("event name tables (verified against the 4.7.3 bundle)", () => {
  it("treats slice.end as the REAL slicing completion", () => {
    // The bundle emits slice.begin when the worker starts and slice.end when
    // the slicing worker finishes — `{function:"slice"}.done` is only an ack.
    expect(SLICE_END_EVENTS.has("slice.end")).toBe(true);
    expect(SLICE_BEGIN_EVENTS.has("slice.begin")).toBe(true);
    expect(SLICE_END_EVENTS.has("slice.done")).toBe(false);
  });

  it("treats prepare.done/preview.end as export-eligible", () => {
    expect(PREVIEW_END_EVENTS.has("prepare.done")).toBe(true);
    expect(PREVIEW_END_EVENTS.has("preview.end")).toBe(true);
  });

  it("routes slicer failures through the job-error table", () => {
    expect(JOB_ERROR_EVENTS.has("slice.error")).toBe(true);
    expect(JOB_ERROR_EVENTS.has("export.error")).toBe(true);
    expect(JOB_ERROR_EVENTS.has("prepare.error")).toBe(true);
    expect(JOB_ERROR_EVENTS.has("error")).toBe(true);
  });

  it("keeps parsed/loaded as model load events, separate from readiness", () => {
    expect(MODEL_LOAD_EVENTS.has("parsed")).toBe(true);
    expect(MODEL_LOAD_EVENTS.has("loaded")).toBe(true);
    expect(READY_EVENTS.has("init-done")).toBe(true);
    for (const ev of MODEL_LOAD_EVENTS) expect(READY_EVENTS.has(ev)).toBe(false);
    expect(MODEL_LOAD_EVENTS.has("slice.end")).toBe(false);
  });
});

describe("sliceFlowTransition", () => {
  it("request starts slicing and duplicate requests are ignored", () => {
    let phase = sliceFlowTransition("idle", { type: "request" });
    expect(phase).toBe("slicing");
    phase = sliceFlowTransition(phase, { type: "request" });
    expect(phase).toBe("slicing");
  });

  it("the instant function ack does NOT complete the flow", () => {
    // THE regression: treating {event:"slice.done"} (the ack) as completion
    // made the button spin forever while Kiri had already finished.
    expect(sliceFlowTransition("slicing", { type: "ack" })).toBe("slicing");
  });

  it("slice.end completes the flow from slicing", () => {
    expect(sliceFlowTransition("slicing", { type: "end" })).toBe("sliced");
  });

  it("slice.end from Kiri's own button also lands on sliced", () => {
    // Slicing started inside Kiri (no app request) still ends sliced —
    // the event comes off the shared bus.
    expect(sliceFlowTransition("idle", { type: "end" })).toBe("sliced");
  });

  it("begin is a defensive no-op transition into slicing", () => {
    expect(sliceFlowTransition("idle", { type: "begin" })).toBe("slicing");
    expect(sliceFlowTransition("slicing", { type: "begin" })).toBe("slicing");
  });

  it("error fails only an in-flight slice", () => {
    expect(sliceFlowTransition("slicing", { type: "error" })).toBe("failed");
    expect(sliceFlowTransition("sliced", { type: "error" })).toBe("sliced");
    expect(sliceFlowTransition("idle", { type: "error" })).toBe("idle");
  });

  it("a new model invalidates old toolpaths but not a fresh slice", () => {
    expect(sliceFlowTransition("sliced", { type: "model-change" })).toBe("idle");
    expect(sliceFlowTransition("slicing", { type: "model-change" })).toBe("slicing");
  });

  it("reset returns to idle", () => {
    expect(sliceFlowTransition("sliced", { type: "reset" })).toBe("idle");
  });
});

describe("sliceTimeoutMs", () => {
  it("arms a long deadline while slicing, none when idle/sliced", () => {
    expect(sliceTimeoutMs("slicing")).toBeGreaterThanOrEqual(60_000);
    expect(sliceTimeoutMs("idle")).toBe(0);
    expect(sliceTimeoutMs("sliced")).toBe(0);
    expect(sliceTimeoutMs("failed")).toBe(0);
  });
});

describe("exportJobTransition (prepare → export chain)", () => {
  it("prepare starts the preview phase", () => {
    let job = exportJobTransition({ phase: "idle" }, { type: "prepare" });
    expect(job.phase).toBe("preparing");
    job = exportJobTransition(job, { type: "prepare" });
    expect(job.phase).toBe("preparing");
  });

  it("prepare.done promotes to requested (ready for export)", () => {
    const job = exportJobTransition({ phase: "preparing" }, { type: "prepare.done" });
    expect(job.phase).toBe("requested");
  });

  it("request jumps straight to requested when preview already exists", () => {
    expect(exportJobTransition({ phase: "idle" }, { type: "request" }).phase).toBe("requested");
  });

  it("requested → done and captures gcode from export.done", () => {
    const job = exportJobTransition({ phase: "requested" }, { type: "export.done", payload: "G28\nG1 X0" });
    expect(job.phase).toBe("done");
    expect(job.gcode).toBe("G28\nG1 X0");
  });

  it("export.done with an empty payload → failed (nothing sliced)", () => {
    expect(exportJobTransition({ phase: "requested" }, { type: "export.done", payload: "" }).phase).toBe("failed");
    expect(exportJobTransition({ phase: "requested" }, { type: "export.done", payload: "  " }).phase).toBe("failed");
    expect(exportJobTransition({ phase: "requested" }, { type: "export.done", payload: undefined }).phase).toBe("failed");
  });

  it("ignores stale export.done when idle or already done", () => {
    expect(exportJobTransition({ phase: "idle" }, { type: "export.done", payload: "G1" }).phase).toBe("idle");
    const done = { phase: "done" as const, gcode: "G1" };
    expect(exportJobTransition(done, { type: "export.done", payload: "G2" })).toEqual(done);
  });

  it("error while preparing/requested → failed; error while idle is ignored", () => {
    expect(exportJobTransition({ phase: "preparing" }, { type: "error" }).phase).toBe("failed");
    expect(exportJobTransition({ phase: "requested" }, { type: "error" }).phase).toBe("failed");
    expect(exportJobTransition({ phase: "idle" }, { type: "error" }).phase).toBe("idle");
  });

  it("reset returns to idle", () => {
    expect(exportJobTransition({ phase: "done", gcode: "x" }, { type: "reset" })).toEqual({ phase: "idle" });
  });
});

describe("exportTimeoutMs", () => {
  it("arms watchdogs while preparing and requested only", () => {
    expect(exportTimeoutMs("preparing")).toBeGreaterThan(0);
    expect(exportTimeoutMs("requested")).toBeGreaterThan(0);
    expect(exportTimeoutMs("idle")).toBe(0);
    expect(exportTimeoutMs("done")).toBe(0);
    expect(exportTimeoutMs("failed")).toBe(0);
  });
});

describe("widgetFileName", () => {
  it("returns the first widget file name", () => {
    expect(widgetFileName([{ id: 1, meta: { file: "a.stl" } }])).toBe("a.stl");
    expect(widgetFileName([{ id: 1 }, { meta: { file: "b.obj" } }])).toBe("b.obj");
  });

  it("handles anonymous widgets, junk, and missing input", () => {
    expect(widgetFileName([{ id: 1, meta: {} }])).toBeNull();
    expect(widgetFileName([{ meta: { file: "   " } }])).toBeNull();
    expect(widgetFileName([{ meta: { file: 42 } }])).toBeNull();
    expect(widgetFileName([])).toBeNull();
    expect(widgetFileName(undefined)).toBeNull();
    expect(widgetFileName(null)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(widgetFileName([{ meta: { file: "  part v2.stl  " } }])).toBe("part v2.stl");
  });
});

describe("fileBaseName", () => {
  it("strips the extension", () => {
    expect(fileBaseName("bracket_v2.stl")).toBe("bracket_v2");
    expect(fileBaseName("no-extension")).toBe("no-extension");
  });

  it("takes only the final path segment", () => {
    expect(fileBaseName("/models/robot/arm.stl")).toBe("arm");
    expect(fileBaseName("C:\\models\\arm.stl")).toBe("arm");
  });
});

describe("planModelLoad", () => {
  it("routes every STL/3MF through Kiri's own file-input path", () => {
    // The frame {parse:} branch is broken for binary STLs in 4.7.3 — never
    // route binary geometry through it, even when frame support exists.
    expect(planModelLoad({ name: "bracket.stl", isText: false, hasFrameSupport: true })).toEqual({
      kind: "file-input",
      fileName: "bracket.stl",
    });
    expect(planModelLoad({ name: "part.3mf", isText: false, hasFrameSupport: true })).toEqual({
      kind: "file-input",
      fileName: "part.3mf",
    });
  });

  it("routes text gcode through the frame parse path when supported", () => {
    expect(planModelLoad({ name: "benchy.gcode", isText: true, hasFrameSupport: true })).toEqual({
      kind: "frame-parse",
      fileName: "benchy.gcode",
      type: "gcode",
    });
    expect(planModelLoad({ name: "benchy.gcode", isText: true, hasFrameSupport: false })).toEqual({
      kind: "file-input",
      fileName: "benchy.gcode",
    });
  });

  it("routes unknown formats to the file input", () => {
    expect(planModelLoad({ name: "model.step", isText: false, hasFrameSupport: true })).toEqual({
      kind: "file-input",
      fileName: "model.step",
    });
  });
});

describe("poll constants", () => {
  it("widgets poll is fast but bounded", () => {
    expect(WIDGET_POLL_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(WIDGET_POLL_DELAY_MS).toBeLessThanOrEqual(1000);
    expect(WIDGET_POLL_MAX_MS).toBeGreaterThanOrEqual(5000);
    expect(WIDGET_POLL_MAX_MS).toBeLessThanOrEqual(30_000);
    expect(WIDGET_POLL_MAX_MS % WIDGET_POLL_DELAY_MS).toBe(0);
  });

  it("idle bed sync is slower than the load watch but under 5s", () => {
    expect(WIDGET_IDLE_SYNC_MS).toBeGreaterThanOrEqual(1000);
    expect(WIDGET_IDLE_SYNC_MS).toBeLessThanOrEqual(5000);
    expect(WIDGET_IDLE_SYNC_MS).toBeGreaterThan(WIDGET_POLL_DELAY_MS);
  });

  it("settings collector retries are bounded and paced", () => {
    expect(GET_RETRY_MAX).toBeGreaterThanOrEqual(3);
    expect(GET_REPLY_GRACE_MS).toBeGreaterThan(0);
  });
});
