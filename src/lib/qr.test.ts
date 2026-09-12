import { describe, expect, it } from "vitest";
import {
  categoryQr,
  closetQr,
  groupQr,
  normalizeScan,
  projectQr,
  qrUrl,
  unitQr,
} from "@/lib/qr";

describe("QR payloads", () => {
  it("builds a distinct payload for every entity kind", () => {
    expect(groupQr("Arduino Uno")).toBe("inv:Arduino Uno");
    expect(unitQr("ARD-001")).toBe("unit:ARD-001");
    expect(categoryQr("Boards")).toBe("cat:Boards");
    expect(closetQr("closet123")).toBe("closet:closet123");
    expect(projectQr("proj456")).toBe("proj:proj456");
  });

  it("keeps every payload unique per entity kind (unit vs group vs category)", () => {
    const payloads = new Set([
      groupQr("Arduino Uno"),
      unitQr("ARD-001"),
      categoryQr("Boards"),
      closetQr("c1"),
      projectQr("p1"),
    ]);
    expect(payloads.size).toBe(5);
  });

  it("builds a scan URL with the payload as the p query param", () => {
    // Printed labels carry an absolute URL so any phone camera can open the app.
    expect(qrUrl("unit:ARD-001")).toMatch(/\/qr\?p=unit%3AARD-001$/);
  });

  describe("normalizeScan", () => {
    it("passes raw payloads through", () => {
      expect(normalizeScan("unit:ARD-001")).toBe("unit:ARD-001");
    });

    it("trims whitespace", () => {
      expect(normalizeScan("  inv:Arduino Uno  ")).toBe("inv:Arduino Uno");
    });

    it("extracts the payload from a full printed label URL", () => {
      const url = `https://roboshelf.example.com/qr?p=${encodeURIComponent("closet:c9")}`;
      expect(normalizeScan(url)).toBe("closet:c9");
    });

    it("falls back to the raw text when the URL has no p param", () => {
      expect(normalizeScan("https://roboshelf.example.com/other")).toBe(
        "https://roboshelf.example.com/other",
      );
    });
  });
});
