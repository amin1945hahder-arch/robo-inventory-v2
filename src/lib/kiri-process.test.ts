import { describe, expect, it } from "vitest";
import { parseGcodeStats, snapshotFromKiri, snapshotToNote } from "./kiri-process";

const GCODE = [
  "; FLAVOR:Marlin",
  "G28 ; home",
  "G1 X10 Y10 E1.0",
  "; --- filament used: 1234.5 mm ---",
  "; --- print time: 5400s ---",
  "",
].join("\n");

describe("parseGcodeStats", () => {
  it("parses filament mm and print time from Kiri's footer", () => {
    const s = parseGcodeStats(GCODE);
    // 1.75mm filament: area = π*(1.75/2)² ≈ 2.4053 mm² → 1234.5 * 2.4053/1000 * 1.24 ≈ 3.68 g
    expect(s.grams).toBeCloseTo(3.68, 1);
    expect(s.minutes).toBe(90);
    expect(s.lines).toBe(6);
    expect(s.bytes).toBe(GCODE.length);
  });

  it("returns zeros (not NaN) for gcode without the footer", () => {
    const s = parseGcodeStats("G28\nG1 X0");
    expect(s.grams).toBe(0);
    expect(s.minutes).toBe(0);
  });

  it("handles empty input", () => {
    const s = parseGcodeStats("");
    expect(s.grams).toBe(0);
    expect(s.lines).toBe(0);
  });

  it("respects custom diameter/density (2.85mm PETG)", () => {
    const s = parseGcodeStats(GCODE, 2.85, 1.27);
    // area = π*(2.85/2)² ≈ 6.379 mm² → 1234.5*6.379/1000*1.27 ≈ 10.0 g
    expect(s.grams).toBeGreaterThan(9);
    expect(s.grams).toBeLessThan(11);
  });
});

describe("snapshotFromKiri", () => {
  it("maps the documented kiri process fields into grouped specs", () => {
    const snap = snapshotFromKiri(
      {
        sliceHeight: 0.2,
        sliceShells: 3,
        sliceFillType: "grid",
        sliceFillSparse: 0.25,
        outputTemp: 205,
        outputBedTemp: 60,
        outputFeedrate: 50,
        sliceSupportType: "normal",
        sliceSupportAngle: 50,
        outputRaft: false,
      },
      {
        deviceName: "Ender 3",
        bedWidth: 220,
        bedDepth: 220,
        maxHeight: 250,
        mode: "FDM",
        extruders: [{ extNozzle: 0.4, extFilament: 1.75 }],
      },
    );
    const get = (gid: string, label: string) =>
      snap.groups.find((g) => g.id === gid)?.rows.find((r) => r.label === label)?.value;

    expect(get("layers", "Layer height")).toBe("0.2 mm");
    expect(get("shells", "Shell count")).toBe("3");
    expect(get("fill", "Fill type")).toBe("grid");
    expect(get("fill", "Fill amount")).toBe("25%");
    expect(get("heating", "Nozzle temp")).toBe("205 °C");
    expect(get("heating", "Bed temp")).toBe("60 °C");
    expect(get("output", "Print speed")).toBe("50 mm/s");
    expect(get("support", "Type")).toBe("normal");
    expect(get("support", "Density")).toBe("—"); // unset renders as dash
    expect(get("raft", "Raft")).toBe("Disabled");
    expect(get("device", "Device")).toBe("Ender 3");
    expect(get("device", "Nozzle")).toBe("0.4 mm");
    expect(snap.mode).toBe("FDM");
    expect(snap.deviceName).toBe("Ender 3");
  });

  it("shows support detail rows only when support is enabled", () => {
    const off = snapshotFromKiri({ sliceSupportType: "disabled" }, {});
    expect(off.groups.find((g) => g.id === "support")!.rows).toHaveLength(1);
    const on = snapshotFromKiri({ sliceSupportType: "tree" }, {});
    const sup = on.groups.find((g) => g.id === "support")!;
    expect(sup.rows.length).toBeGreaterThan(3);
  });

  it("survives missing process/device entirely (empty readout, no crash)", () => {
    const snap = snapshotFromKiri(undefined, undefined);
    expect(snap.groups.length).toBeGreaterThan(4);
    expect(snap.groups.every((g) => g.rows.length > 0)).toBe(true);
    expect(snap.deviceName).toBe("—");
  });
});

describe("snapshotToNote", () => {
  it("skips unset/dash rows and includes real values", () => {
    const snap = snapshotFromKiri(
      { sliceHeight: 0.2, sliceShells: 2, outputTemp: 210, sliceSupportType: "disabled" },
      { deviceName: "A1 mini", bedWidth: 180, bedDepth: 180, maxHeight: 250, mode: "FDM" },
    );
    const note = snapshotToNote(snap);
    expect(note).toContain("Layers: layer height 0.2 mm");
    expect(note).toContain("Heating: nozzle temp 210 °C");
    expect(note).not.toContain("—");
    expect(note).not.toContain("Disabled");
  });
});
