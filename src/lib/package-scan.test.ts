import { describe, expect, it } from "vitest";
import { buildCardCaption, type RentCardData } from "@/lib/rent-card-caption";
import { groupAllowedByFilter, scanOutcome, upsertLine } from "@/lib/package-scan";

// ---------------------------------------------------------------------------
// Rent-card caption: one message, one field per line
// ---------------------------------------------------------------------------

const card: RentCardData = {
  rentalId: "j57abcd1234",
  groupName: "Arduino Uno",
  tag: "ARD-UNO-003",
  holderName: "Amin Haydar",
  studentId: "STU-0002",
  statusLabel: "active · return requested",
  requestedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  conditionReport: "Missing cable",
};

describe("rent card caption", () => {
  it("renders every data field on its own line, never one long row", () => {
    const caption = buildCardCaption(card, "↩️ Return requested");
    const lines = caption.split("\n");
    expect(lines[0]).toBe("↩️ Return requested");
    expect(lines[1]).toBe("");
    expect(caption).toContain("🏷 Item: Arduino Uno (ARD-UNO-003)");
    expect(caption).toContain("👤 Student: Amin Haydar · STU-0002");
    expect(caption).toContain("📌 Status: active · return requested");
    expect(caption).toContain("📅 Requested: 02/01/2026, 03:04");
    expect(caption).toContain("📝 Condition: Missing cable");
    // each data field is on its own line
    expect(lines.filter((l) => l.startsWith("🏷")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("👤")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("📝")).length).toBe(1);
  });

  it("lists every package unit as its own bullet line", () => {
    const caption = buildCardCaption(
      {
        ...card,
        extraUnits: [
          { tag: "ARD-UNO-001", groupName: "Arduino Uno" },
          { tag: "SRV-001", groupName: "Servo MG996R" },
        ],
      },
      "↩️ Package return requested (2 units)",
    );
    expect(caption).toContain("   • Arduino Uno (ARD-UNO-001)");
    expect(caption).toContain("   • Servo MG996R (SRV-001)");
    const bulletLines = caption.split("\n").filter((l) => l.trim().startsWith("•"));
    expect(bulletLines.length).toBe(2);
  });

  it("omits empty fields instead of printing placeholders", () => {
    const caption = buildCardCaption(
      { ...card, conditionReport: undefined, studentId: undefined },
      "↩️ Return requested",
    );
    expect(caption).not.toContain("📝");
    expect(caption).not.toContain(" · undefined");
  });
});

// ---------------------------------------------------------------------------
// Package-builder scan mapping
// ---------------------------------------------------------------------------

describe("package scan outcome", () => {
  it("adds a line for a scanned unit (using its group)", () => {
    const out = scanOutcome({ type: "unit", id: "p1", groupId: "g1" });
    expect(out).toEqual({ action: "add-line", groupId: "g1" });
  });

  it("adds a line for a scanned group", () => {
    expect(scanOutcome({ type: "group", id: "g2" })).toEqual({ action: "add-line", groupId: "g2" });
  });

  it("narrows the dropdown for a scanned category", () => {
    expect(scanOutcome({ type: "category", id: "c1" })).toEqual({
      action: "set-filter",
      filter: { type: "category", id: "c1" },
    });
  });

  it("narrows the dropdown for a scanned closet", () => {
    expect(scanOutcome({ type: "closet", id: "cl1" })).toEqual({
      action: "set-filter",
      filter: { type: "closet", id: "cl1" },
    });
  });

  it("ignores projects, rent cards and unknown labels", () => {
    expect(scanOutcome({ type: "project", id: "pr1" }).action).toBe("ignored");
    expect(scanOutcome({ type: "rental", id: "r1" }).action).toBe("ignored");
    expect(scanOutcome(null).action).toBe("ignored");
  });
});

describe("package line upsert", () => {
  it("never duplicates a group that is already listed (dedupe on scan)", () => {
    const lines = upsertLine([{ groupId: "g1", count: 2 }], "g1");
    expect(lines).toEqual([{ groupId: "g1", count: 2 }]);
  });

  it("appends a new line for an unseen group", () => {
    const lines = upsertLine([{ groupId: "g1", count: 1 }], "g2");
    expect(lines).toEqual([
      { groupId: "g1", count: 1 },
      { groupId: "g2", count: 1 },
    ]);
  });

  it("never produces zero/negative counts", () => {
    expect(upsertLine([], "g1", 0)).toEqual([{ groupId: "g1", count: 1 }]);
    expect(upsertLine([], "g1", -3)).toEqual([{ groupId: "g1", count: 1 }]);
  });

  it("repeats never mutate an existing line (count adjusted by hand)", () => {
    expect(upsertLine([{ groupId: "g1", count: 4 }], "g1", 2)).toEqual([
      { groupId: "g1", count: 4 },
    ]);
    expect(upsertLine([{ groupId: "g1", count: 4 }], "g1", -3)).toEqual([
      { groupId: "g1", count: 4 },
    ]);
  });
});

describe("scan filter", () => {
  it("passes every group through when no filter is active", () => {
    const g = { categoryId: "c1", closetId: "cl1" };
    expect(groupAllowedByFilter(g, null)).toBe(true);
  });

  it("keeps only groups of the scanned category", () => {
    expect(groupAllowedByFilter({ categoryId: "c1", closetId: "cl9" }, { type: "category", id: "c1" })).toBe(true);
    expect(groupAllowedByFilter({ categoryId: "c2", closetId: "cl1" }, { type: "category", id: "c1" })).toBe(false);
  });

  it("keeps only groups of the scanned closet", () => {
    expect(groupAllowedByFilter({ categoryId: "c9", closetId: "cl1" }, { type: "closet", id: "cl1" })).toBe(true);
    expect(groupAllowedByFilter({ categoryId: "c1", closetId: "cl2" }, { type: "closet", id: "cl1" })).toBe(false);
  });
});
