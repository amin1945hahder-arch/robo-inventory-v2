import { describe, expect, it } from "vitest";
import {
  classifyKiriReply,
  exportJobTransition,
  exportTimeoutMs,
  fileBaseName,
  kiriMsg,
  MODEL_LOAD_EVENTS,
  planModelLoad,
  READY_EVENTS,
  widgetFileName,
  WIDGET_POLL_DELAY_MS,
  WIDGET_POLL_MAX_MS,
} from "./slicer-protocol";

describe("kiriMsg wire builders", () => {
  it("builds function calls with callback:true", () => {
    expect(kiriMsg.slice()).toEqual({ function: "slice", callback: true });
    expect(kiriMsg.prepare()).toEqual({ function: "prepare", callback: true });
    expect(kiriMsg.export()).toEqual({ function: "export", callback: true });
  });

  it("builds get requests for process and device", () => {
    expect(kiriMsg.getProcess()).toEqual({ get: "process" });
    expect(kiriMsg.getDevice()).toEqual({ get: "device" });
    expect(kiriMsg.getMode()).toEqual({ get: "mode" });
  });

  it("builds settings pushes and model loads", () => {
    expect(kiriMsg.setDevice({ deviceName: "X" })).toEqual({ device: { deviceName: "X" } });
    expect(kiriMsg.setProcess({ outputTemp: 205 })).toEqual({ process: { outputTemp: 205 } });
    expect(kiriMsg.parse("data", "stl")).toEqual({ parse: "data", type: "stl" });
    expect(kiriMsg.clear()).toEqual({ clear: true });
  });

  it("builds the widgets ground-truth poll", () => {
    expect(kiriMsg.getWidgets()).toEqual({ get: "widgets" });
  });
});

describe("classifyKiriReply", () => {
  it("classifies named events with payloads", () => {
    expect(classifyKiriReply({ event: "slice.done", data: "FDM" })).toEqual({
      kind: "event",
      event: "slice.done",
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

  it("ignores non-kiri noise (app route pings, primitives)", () => {
    expect(classifyKiriReply(null).kind).toBe("unknown");
    expect(classifyKiriReply("hello").kind).toBe("unknown");
    expect(classifyKiriReply(undefined).kind).toBe("unknown");
    expect(classifyKiriReply(["x"]).kind).toBe("unknown");
    expect(classifyKiriReply({ type: "iframe-route-change", path: "/" }).kind).toBe("unknown");
    expect(classifyKiriReply({ random: true }).kind).toBe("unknown");
  });
});

describe("event name tables", () => {
  it("treats parsed/loaded as model load completion", () => {
    expect(MODEL_LOAD_EVENTS.has("parsed")).toBe(true);
    expect(MODEL_LOAD_EVENTS.has("loaded")).toBe(true);
    expect(MODEL_LOAD_EVENTS.has("slice.done")).toBe(false);
  });

  it("treats init-done and preset as readiness signals", () => {
    expect(READY_EVENTS.has("init-done")).toBe(true);
    expect(READY_EVENTS.has("preset")).toBe(true);
  });
});

describe("exportJobTransition", () => {
  it("idle → requested on request, and ignores duplicate requests", () => {
    let job = exportJobTransition({ phase: "idle" }, { type: "request" });
    expect(job.phase).toBe("requested");
    job = exportJobTransition(job, { type: "request" });
    expect(job.phase).toBe("requested");
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

  it("error while requested → failed; error while idle is ignored", () => {
    expect(exportJobTransition({ phase: "requested" }, { type: "error" }).phase).toBe("failed");
    expect(exportJobTransition({ phase: "idle" }, { type: "error" }).phase).toBe("idle");
  });

  it("reset returns to idle", () => {
    expect(exportJobTransition({ phase: "done", gcode: "x" }, { type: "reset" })).toEqual({ phase: "idle" });
  });
});

describe("exportTimeoutMs", () => {
  it("arms a watchdog only while requested", () => {
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
    expect(fileBaseName("C:\\\\models\\\\arm.stl")).toBe("arm");
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
    // No frame support → fall back to the file input.
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

describe("widget poll constants", () => {
  it("poll fast but never longer than 12s", () => {
    expect(WIDGET_POLL_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(WIDGET_POLL_DELAY_MS).toBeLessThanOrEqual(1000);
    expect(WIDGET_POLL_MAX_MS).toBeGreaterThanOrEqual(5000);
    expect(WIDGET_POLL_MAX_MS).toBeLessThanOrEqual(30_000);
    expect(WIDGET_POLL_MAX_MS % WIDGET_POLL_DELAY_MS).toBe(0);
  });

  it("model load events never overlap with readiness events", () => {
    for (const ev of MODEL_LOAD_EVENTS) expect(READY_EVENTS.has(ev)).toBe(false);
    expect(MODEL_LOAD_EVENTS.has("slice.done")).toBe(false);
  });
});
