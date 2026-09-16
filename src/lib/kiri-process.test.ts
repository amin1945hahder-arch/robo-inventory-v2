import { describe, expect, it } from "vitest";
import {
  parseGcodeStats,
  snapshotFromKiri,
  snapshotToNote,
  type KiriDevice,
  type KiriProcess,
} from "@/lib/kiri-process";

// ---------------------------------------------------------------------------
// G-code stat parsing (Kiri's standard footer comments)
// ---------------------------------------------------------------------------

const KIRI_FOOTER = [
  "; --- header ---",
  "G21",
  "G90",
  "; --- filament used: 1234.5 mm ---",
  "; --- print time: 5400s ---",
  "M104 S0",
].join("\n");

describe("parseGcodeStats", () => {
  it("extracts filament grams and print minutes from the Kiri footer", () => {
    const s = parseGcodeStats(KIRI_FOOTER);
    // 1234.5 mm of 1.75 mm filament ≈ 2.9695 cm³ ≈ 3.68 g of PLA
    expect(s.grams).toBeCloseTo(3.68, 1);
    expect(s.minutes).toBe(90);
    expect(s.lines).toBe(6);
    expect(s.bytes).toBe(KIRI_FOOTER.length);
  });

  it("is case-insensitive and tolerates spacing", () => {
    const s = parseGcodeStats(";  Filament Used:  1000 MM  \n;  Print Time:  600 S");
    expect(s.grams).toBeCloseTo(2.98, 1);
    expect(s.minutes).toBe(10);
  });

  it("returns zeros instead of throwing when the footer is missing", () => {
    const s = parseGcodeStats("G1 X0 Y0\nG1 X10 Y10");
    expect(s.grams).toBe(0);
    expect(s.minutes).toBe(0);
    expect(s.lines).toBe(2);
  });

  it("handles empty input", () => {
    expect(parseGcodeStats("")).toEqual({ grams: 0, minutes: 0, lines: 0, bytes: 0 });
  });

  it("scales with filament diameter and density", () => {
    const pla175 = parseGcodeStats("; --- filament used: 1000 mm ---").grams;
    const pla285 = parseGcodeStats("; --- filament used: 1000 mm ---", 2.85).grams;
    const petg175 = parseGcodeStats("; --- filament used: 1000 mm ---", 1.75, 1.27).grams;
    expect(pla285).toBeGreaterThan(pla175 * 2.5); // cross-section grows ~2.65×
    expect(petg175).toBeGreaterThan(pla175); // denser material
  });

  it("rounds minutes up to at least 1", () => {
    const s = parseGcodeStats("; --- print time: 10s ---");
    expect(s.minutes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Snapshot: Kiri's raw process/device → grouped spec cards
// ---------------------------------------------------------------------------

const FULL_PROCESS: KiriProcess = {
  sliceHeight: 0.2,
  firstSliceHeight: 0.3,
  sliceLayerStart: "last",
  sliceTopLayers: 4,
  sliceBottomLayers: 3,
  sliceAdaptive: false,
  sliceShells: 2,
  sliceShellOrder: "in-out",
  sliceLineWidth: 0.4,
  sliceFillType: "hex",
  sliceFillSparse: 0.25,
  sliceFillAngle: 45,
  sliceFillOverlap: 0.35,
  outputTemp: 205,
  outputBedTemp: 60,
  outputFanLayer: 1,
  sliceSupportType: "linear",
  sliceSupportAngle: 50,
  sliceSupportDensity: 0.15,
  sliceSupportOffset: 1,
  sliceSupportExtra: 0.8,
  sliceSupportOutline: true,
  sliceSupportGap: true,
  sliceSupportTree: false,
  outputFeedrate: 3000,
  outputFinishrate: 2000,
  outputSeekrate: 3500,
  outputBrimCount: 2,
  outputBrimOffset: 2,
  outputDraftShield: false,
  outputRaft: true,
  outputRaftSpacing: 0.2,
  zHopDistance: 0.2,
};

const FULL_DEVICE: KiriDevice = {
  deviceName: "Farm-01 Bambu P1S (club)",
  mode: "FDM",
  bedWidth: 256,
  bedDepth: 256,
  maxHeight: 250,
  extruders: [{ extNozzle: 0.4, extFilament: 1.75 }],
};

function group(snapshot: ReturnType<typeof snapshotFromKiri>, id: string) {
  const g = snapshot.groups.find((x) => x.id === id);
  expect(g, `group ${id} exists`).toBeDefined();
  return g!;
}

function row(g: ReturnType<typeof group>, label: string) {
  const r = g.rows.find((x) => x.label === label);
  expect(r, `row ${label} exists`).toBeDefined();
  return r!;
}

describe("snapshotFromKiri", () => {
  it("maps the Layers section", () => {
    const s = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(row(group(s, "layers"), "Layer height").value).toBe("0.2 mm");
    expect(row(group(s, "layers"), "Start point").value).toBe("last");
    expect(row(group(s, "layers"), "Adaptive height").value).toBe("Off");
  });

  it("maps the Shells and Fill sections", () => {
    const s = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(row(group(s, "shells"), "Shell count").value).toBe("2");
    expect(row(group(s, "shells"), "Shell order").value).toBe("in-out");
    expect(row(group(s, "fill"), "Fill type").value).toBe("hex");
    expect(row(group(s, "fill"), "Fill amount").value).toBe("25%");
  });

  it("maps the Heating section", () => {
    const s = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(row(group(s, "heating"), "Nozzle temp").value).toBe("205 °C");
    expect(row(group(s, "heating"), "Bed temp").value).toBe("60 °C");
  });

  it("expands the Support section when enabled and hides detail when disabled", () => {
    const on = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(group(on, "support").rows.length).toBeGreaterThan(1);
    expect(row(group(on, "support"), "Type").value).toBe("linear");
    expect(row(group(on, "support"), "Density").value).toBe("15%");
    expect(row(group(on, "support"), "Enclosed").value).toBe("Yes");
    expect(row(group(on, "support"), "Tree type").value).toBe("Linear");

    const off = snapshotFromKiri({ ...FULL_PROCESS, sliceSupportType: "disabled" }, FULL_DEVICE);
    expect(group(off, "support").rows).toEqual([{ label: "Type", value: "Disabled" }]);
  });

  it("expands the Raft section only when enabled", () => {
    const on = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(row(group(on, "raft"), "Raft").value).toBe("Enabled");
    expect(row(group(on, "raft"), "Raft gap").value).toBe("0.2 mm");

    const off = snapshotFromKiri({ ...FULL_PROCESS, outputRaft: false }, FULL_DEVICE);
    expect(group(off, "raft").rows).toEqual([{ label: "Raft", value: "Disabled" }]);
  });

  it("maps the Output section including brim", () => {
    const s = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(row(group(s, "output"), "Print speed").value).toBe("3000 mm/s");
    expect(row(group(s, "output"), "Brim").value).toBe("2 lines × 2 mm");
  });

  it("maps the Machine section from the device object", () => {
    const s = snapshotFromKiri(FULL_PROCESS, FULL_DEVICE);
    expect(s.deviceName).toBe("Farm-01 Bambu P1S (club)");
    expect(s.mode).toBe("FDM");
    expect(row(group(s, "device"), "Bed").value).toBe("256 × 256 mm");
    expect(row(group(s, "device"), "Nozzle").value).toBe("0.4 mm");
  });

  it("renders dashes for unset values and never crashes on empty input", () => {
    const s = snapshotFromKiri(undefined, undefined);
    expect(row(group(s, "layers"), "Layer height").value).toBe("—");
    expect(row(group(s, "heating"), "Nozzle temp").value).toBe("—");
    expect(row(group(s, "device"), "Device").value).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// Snapshot → note text (what admins receive with the approval request)
// ---------------------------------------------------------------------------

describe("snapshotToNote", () => {
  it("produces one compact line per group with values set", () => {
    const note = snapshotToNote(snapshotFromKiri(FULL_PROCESS, FULL_DEVICE));
    const lines = note.split("\n");
    expect(lines[0]).toContain("Layers:");
    expect(lines[0]).toContain("layer height 0.2 mm");
    expect(lines.some((l) => l.startsWith("Support:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Raft:")) && lines.some((l) => l.includes("raft gap 0.2 mm"))).toBe(true);
  });

  it("drops groups whose rows are all unset", () => {
    const note = snapshotToNote(snapshotFromKiri({ sliceHeight: 0.2 }, undefined));
    expect(note).toContain("Layers:");
    expect(note).not.toContain("Heating:");
    expect(note).not.toContain("Output:");
  });

  it("respects the maxLines cap", () => {
    const note = snapshotToNote(snapshotFromKiri(FULL_PROCESS, FULL_DEVICE), 3);
    expect(note.split("\n").length).toBeLessThanOrEqual(3);
  });
});
