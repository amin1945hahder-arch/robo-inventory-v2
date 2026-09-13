import { describe, expect, it } from "vitest";
import {
  buildRentCardCaption,
  renderRentCardPdf,
  type RentCardData,
} from "@/lib/rent-card-pdf";
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
    const caption = buildRentCardCaption(card, "↩️ Return requested");
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
    const caption = buildRentCardCaption(card, "↩️ Package return requested (2 units)", [
      "   • Arduino Uno (ARD-UNO-001)",
      "   • Servo MG996R (SRV-001)",
    ]);
    expect(caption).toContain("   • Arduino Uno (ARD-UNO-001)");
    expect(caption).toContain("   • Servo MG996R (SRV-001)");
    const bulletLines = caption.split("\n").filter((l) => l.trim().startsWith("•"));
    expect(bulletLines.length).toBe(2);
  });

  it("omits empty fields instead of printing placeholders", () => {
    const caption = buildRentCardCaption(
      { ...card, conditionReport: undefined, studentId: undefined },
      "↩️ Return requested",
    );
    expect(caption).not.toContain("📝");
    expect(caption).not.toContain(" · undefined");
  });
});

describe("rent card PDF", () => {
  it("produces a valid single-page PDF document", () => {
    const pdf = renderRentCardPdf(card);
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Count 1");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("draws the QR block as vector rects with the caption line under it", () => {
    const pdf = renderRentCardPdf(card);
    const text = Buffer.from(pdf).toString("latin1");
    // QR modules are emitted as filled rectangles; the scan hint sits below.
    expect(text).toContain(" re f");
    expect(text).toContain("(scan to open this rental)");
  });

  it("wraps long condition reports instead of overflowing the page", () => {
    const pdf = renderRentCardPdf({
      ...card,
      conditionReport:
        "The left driver exploded during the qualification match, gears stripped and housing cracked — needs a full rebuild before it can be shelved again.",
    });
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
  });

  it("transliterates Arabic names instead of printing question marks", () => {
    const pdf = renderRentCardPdf({
      ...card,
      holderName: "أمين حيدر",
      groupName: "أردوينو أونو",
    });
    const text = Buffer.from(pdf).toString("latin1");
    // Arabic letters become their Latin transliteration (amyn hydr …);
    // no run of question marks may appear in the drawn text.
    expect(text).toContain("(amyn hydr)");
    expect(text).toContain("(ardwynw awnw)");
    expect(text).not.toContain("(?????");
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
  it("bumps the count when the group is already listed", () => {
    const lines = upsertLine([{ groupId: "g1", count: 2 }], "g1");
    expect(lines).toEqual([{ groupId: "g1", count: 3 }]);
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
    expect(upsertLine([{ groupId: "g1", count: 4 }], "g1", -3)).toEqual([
      { groupId: "g1", count: 5 },
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
