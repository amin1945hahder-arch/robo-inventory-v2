import { describe, expect, it } from "vitest";
import {
  classifyKiriReply,
  exportJobTransition,
  exportTimeoutMs,
  kiriMsg,
  MODEL_LOAD_EVENTS,
  READY_EVENTS,
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
