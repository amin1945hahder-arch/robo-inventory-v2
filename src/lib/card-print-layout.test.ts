import { describe, expect, it } from "vitest";
import {
  injectCardPrintCss,
  pageCssSize,
  pageMm,
  placedCardMm,
} from "./card-print-layout";
import { DEFAULT_CARD_LAYOUT } from "@/convex/settings";

const l = (over: Partial<typeof DEFAULT_CARD_LAYOUT> = {}) => ({
  ...DEFAULT_CARD_LAYOUT,
  ...over,
});

describe("pageMm", () => {
  it("resolves A4", () => {
    expect(pageMm(l({ pageSize: "A4" }))).toEqual({ w: 210, h: 297 });
  });
  it("resolves Letter", () => {
    expect(pageMm(l({ pageSize: "Letter" }))).toEqual({ w: 215.9, h: 279.4 });
  });
  it("uses custom size", () => {
    expect(pageMm(l({ pageSize: "custom", pageWidthMm: 100, pageHeightMm: 150 }))).toEqual({
      w: 100,
      h: 150,
    });
  });
  it("thermal mode: page = card size", () => {
    expect(pageMm(l({ printMode: "thermal", cardWidthMm: 80, cardHeightMm: 60 }))).toEqual({
      w: 80,
      h: 60,
    });
  });
});

describe("pageCssSize", () => {
  it("maps presets to CSS keywords", () => {
    expect(pageCssSize(l({ pageSize: "A5" }))).toBe("A5");
    expect(pageCssSize(l({ pageSize: "Letter" }))).toBe("letter");
    expect(pageCssSize(l({ pageSize: "custom", pageWidthMm: 90, pageHeightMm: 120 }))).toBe(
      "90mm 120mm",
    );
  });
  it("thermal uses the card size", () => {
    expect(pageCssSize(l({ printMode: "thermal", cardWidthMm: 80, cardHeightMm: 60 }))).toBe(
      "80mm 60mm",
    );
  });
});

describe("placedCardMm", () => {
  it("keeps the configured size when the card fits", () => {
    // 360×~518px card ≈ 95×137mm at 96dpi… pass explicit px: 360x360 → mm.
    const p = placedCardMm(l(), 360, 360);
    // box 95×70 → fit scale = 70/95.25 ≈ 0.735 → placed ≈ 70×70mm centred in box
    expect(p.w).toBeCloseTo(70, 0);
    expect(p.h).toBeCloseTo(70, 0);
    expect(p.x).toBeCloseTo(15 + (95 - 70) / 2, 0);
    expect(p.y).toBeCloseTo(15, 0);
  });
  it("letterboxes a wide card inside the box (no stretch)", () => {
    const p = placedCardMm(l({ cardWidthMm: 100, cardHeightMm: 50, offsetXmm: 10, offsetYmm: 20 }), 400, 100);
    // box = 100×50mm; card ratio 4:1 → fit by width: 100×25mm
    expect(p.w).toBeCloseTo(100, 0);
    expect(p.h).toBeCloseTo(25, 0);
    expect(p.x).toBeCloseTo(10, 0);
    expect(p.y).toBeCloseTo(20 + (50 - 25) / 2, 0);
  });
  it("clamps the box to the page at the given offset", () => {
    const p = placedCardMm(l({ cardWidthMm: 300, cardHeightMm: 300, offsetXmm: 150, offsetYmm: 0 }), 100, 100);
    // boxW = min(300, 210-150=60) = 60; boxH = min(300, 297) = 297 → fit: 60×60
    expect(p.w).toBeCloseTo(60, 0);
    expect(p.h).toBeCloseTo(60, 0);
    expect(p.x).toBeCloseTo(150, 0);
    expect(p.y).toBeCloseTo((297 - 60) / 2, 0);
  });
  it("thermal mode: card fills the whole page", () => {
    const p = placedCardMm(l({ printMode: "thermal", cardWidthMm: 80, cardHeightMm: 60 }), 360, 270);
    expect(p.x).toBeCloseTo(0, 0);
    expect(p.y).toBeCloseTo(0, 0);
    expect(p.w).toBeCloseTo(80, 0);
    expect(p.h).toBeCloseTo(60, 0);
  });
});

describe("injectCardPrintCss", () => {
  it("injects and replaces a single style tag", () => {
    document.head.innerHTML = "";
    injectCardPrintCss(l());
    injectCardPrintCss(l({ pageSize: "A5" }));
    const styles = document.head.querySelectorAll("#card-print-layout");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain("size: A5");
    document.head.innerHTML = "";
  });
});
