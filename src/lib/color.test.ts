import { describe, expect, it } from "vitest";
import { cssToHex, isHex, oklchToHex, parseHex, rgbaToHex } from "./color";
import { defaultColors, TOKEN_KEYS } from "./themeTokens";

describe("oklch → hex", () => {
  it("converts the anchors exactly", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    // Mid-lightness neutral gray (0.125 linear → gamma → 99/255).
    expect(oklchToHex(0.5, 0, 0)).toBe("#636363");
  });

  it("keeps alpha as a hex8 channel", () => {
    expect(oklchToHex(1, 0, 0, 0.1)).toBe("#ffffff1a"); // 10% → 26 → 0x1a
  });
});

describe("cssToHex", () => {
  it("parses the oklch tokens used in index.css", () => {
    expect(cssToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(cssToHex("oklch(1 0 0 / 10%)")).toBe("#ffffff1a");
    expect(cssToHex("oklch(1 0 0 / 14%)")).toBe("#ffffff24"); // 14% → 35.7 → 36
    expect(cssToHex("oklch(0.16 0.024 250)")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("parses hex and rgb() forms", () => {
    expect(cssToHex("#abc")).toBe("#aabbcc");
    expect(cssToHex("#AABBCC")).toBe("#aabbcc");
    expect(cssToHex("rgb(255, 0, 10)")).toBe("#ff000a");
    expect(cssToHex("rgba(255, 0, 10, 0.5)")).toBe("#ff000a80");
  });

  it("rejects nonsense", () => {
    expect(cssToHex("var(--nope)")).toBeNull();
    expect(cssToHex("definitely-not-a-color")).toBeNull();
  });
});

describe("hex parse / round-trip", () => {
  it("understands 3, 4, 6 and 8 digit hex", () => {
    expect(parseHex("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    // 4-digit hex expands per channel: #1234 → #11223344
    expect(parseHex("1234")).toEqual({ r: 17, g: 34, b: 51, a: 68 / 255 });
    expect(parseHex("#123456")).toEqual({ r: 18, g: 52, b: 86, a: 1 });
    const withAlpha = parseHex("#12345680");
    expect(withAlpha?.r).toBe(18);
    expect(withAlpha?.a).toBeCloseTo(0.502, 3);
  });

  it("round-trips rgba → hex → rgba", () => {
    const hex = rgbaToHex({ r: 18, g: 52, b: 86, a: 0.5 });
    expect(hex).toBe("#12345680");
    const back = parseHex(hex);
    expect(back).toEqual({ r: 18, g: 52, b: 86, a: 128 / 255 });
  });

  it("drops the alpha pair when fully opaque", () => {
    expect(rgbaToHex({ r: 1, g: 2, b: 3, a: 1 })).toBe("#010203");
  });

  it("validates", () => {
    expect(isHex("#abcdef")).toBe(true);
    expect(isHex("#abcdef12")).toBe(true);
    expect(isHex("#abcde")).toBe(false);
    expect(isHex("blue")).toBe(false);
  });
});

describe("theme default tokens", () => {
  it("covers every token in both modes, as valid hex", () => {
    for (const mode of ["dark", "light"] as const) {
      const colors = defaultColors(mode);
      for (const key of TOKEN_KEYS) {
        expect(colors[key], `${mode}.${key}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    }
  });

  it("dark and light defaults actually differ", () => {
    const dark = defaultColors("dark");
    const light = defaultColors("light");
    expect(dark.background).not.toBe(light.background);
    expect(dark.primary).not.toBe(light.primary);
    // The dark border is 10% white in index.css — it must keep its alpha
    // after the oklch → hex conversion (light's border is opaque).
    expect(dark.border).toHaveLength(9);
    expect(light.border).toHaveLength(7);
  });
});
