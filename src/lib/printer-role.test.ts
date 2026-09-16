import { describe, expect, it } from "vitest";
import { hasPrinterPrivilege, printerPrivilegeLabel } from "./printer-role";
import { flowAllowsExport, flowTransition, flowTimeoutMs } from "./kiri-process";

describe("printer privilege (client rule)", () => {
  it("admins hold it implicitly", () => {
    expect(hasPrinterPrivilege({ role: "admin" })).toBe(true);
    expect(hasPrinterPrivilege({ role: "admin", printerRole: false })).toBe(true);
  });

  it("members/students need the explicit flag", () => {
    expect(hasPrinterPrivilege({ role: "member" })).toBe(false);
    expect(hasPrinterPrivilege({ role: "member", printerRole: true })).toBe(true);
    expect(hasPrinterPrivilege({ role: "student", printerRole: true })).toBe(true);
    expect(hasPrinterPrivilege({ role: "student" })).toBe(false);
  });

  it("handles null and flag-less users", () => {
    expect(hasPrinterPrivilege(null)).toBe(false);
    expect(hasPrinterPrivilege(undefined)).toBe(false);
    expect(hasPrinterPrivilege({})).toBe(false);
  });

  it("labels the privilege for the People page", () => {
    expect(printerPrivilegeLabel({ role: "admin" })).toBe("admin (implicit)");
    expect(printerPrivilegeLabel({ role: "member", printerRole: true })).toBe("granted");
    expect(printerPrivilegeLabel({ role: "member" })).toBe("not granted");
    expect(printerPrivilegeLabel(null)).toBe("—");
  });
});

describe("slice flow machine (kiri-process)", () => {
  it("slice.done only advances from slicing (no loop on stale events)", () => {
    expect(flowTransition("idle", { kind: "slice_done" }).next).toBe("idle");
    expect(flowTransition("sliced", { kind: "slice_done" }).next).toBe("sliced");
    expect(flowTransition("slicing", { kind: "slice_done" })).toEqual({
      next: "sliced",
      sendPrepare: true,
    });
  });

  it("prepare_done completes the flow and errors fail it", () => {
    expect(flowTransition("slicing", { kind: "prepare_done" }).next).toBe("prepared");
    expect(flowTransition("slicing", { kind: "slice_error" }).next).toBe("failed");
    expect(flowTransition("failed", { kind: "reset" }).next).toBe("idle");
  });

  it("export allowed after slice.done even without prepare", () => {
    expect(flowAllowsExport("sliced")).toBe(true);
    expect(flowAllowsExport("prepared")).toBe(true);
    expect(flowAllowsExport("slicing")).toBe(false);
    expect(flowAllowsExport("idle")).toBe(false);
  });

  it("deadlines exist only for the waiting steps", () => {
    expect(flowTimeoutMs("slicing")).toBeGreaterThan(0);
    expect(flowTimeoutMs("preparing")).toBeGreaterThan(0);
    expect(flowTimeoutMs("sliced")).toBe(0);
    expect(flowTimeoutMs("idle")).toBe(0);
  });
});
