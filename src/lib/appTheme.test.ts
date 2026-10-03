import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeState,
  applyThemeToDom,
  beginThemePreview,
  BUILTIN_THEMES,
  createThemeFrom,
  defaultColors,
  endThemePreview,
  isThemeActive,
  resolveTheme,
  setThemeAwareUserMode,
  type AppTheme,
  type ThemeState,
} from "./appTheme";

const root = () => document.documentElement;

function theme(overrides: Partial<AppTheme> = {}): AppTheme {
  return {
    id: "t1",
    name: "Test",
    mode: "dark",
    radius: 0.5,
    colors: { ...defaultColors("dark"), primary: "#123456" },
    ...overrides,
  };
}

beforeEach(() => {
  // Reset module state between tests: clear theme, restore default mode.
  setThemeAwareUserMode("dark");
  applyThemeToDom(null);
  root().classList.remove("dark");
});

describe("resolveTheme", () => {
  it("resolves presets, custom themes and missing ids", () => {
    const custom = theme({ id: "custom-1" });
    const state: ThemeState = { themes: [custom], activeId: null };
    expect(resolveTheme(state)).toBeNull();
    expect(resolveTheme({ ...state, activeId: "preset-neon-cyan" })?.name).toBe("Neon Cyan");
    expect(resolveTheme({ ...state, activeId: "custom-1" })?.id).toBe("custom-1");
    expect(resolveTheme({ ...state, activeId: "ghost" })).toBeNull();
    expect(resolveTheme(null)).toBeNull();
  });
});

describe("applyThemeToDom", () => {
  it("writes tokens + radius inline and marks the theme active", () => {
    const t = theme();
    applyThemeToDom(t);
    expect(isThemeActive()).toBe(true);
    expect(root().style.getPropertyValue("--primary")).toBe("#123456");
    expect(root().style.getPropertyValue("--background")).toBe(
      defaultColors("dark").background,
    );
    expect(root().style.getPropertyValue("--radius")).toBe("0.5rem");
    // Dark-mode theme forces the dark class + color scheme.
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("honours the theme's base mode", () => {
    applyThemeToDom(theme({ mode: "light", colors: defaultColors("light") }));
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("clears everything when switched off and restores the member's mode", () => {
    applyThemeToDom(theme());
    setThemeAwareUserMode("light");
    applyThemeToDom(null);
    expect(isThemeActive()).toBe(false);
    expect(root().style.getPropertyValue("--primary")).toBe("");
    expect(root().style.getPropertyValue("--radius")).toBe("");
    expect(root().classList.contains("dark")).toBe(false); // back to light
  });

  it("drops tokens the new theme no longer defines", () => {
    applyThemeToDom(theme());
    applyThemeToDom(theme({ colors: { primary: "#654321" } }));
    expect(root().style.getPropertyValue("--primary")).toBe("#654321");
    expect(root().style.getPropertyValue("--background")).toBe("");
  });
});

describe("published-state + preview protocol", () => {
  it("applies server state, previews drafts live, then restores", () => {
    const a = theme({ id: "a", colors: { ...defaultColors("dark"), primary: "#aaaaaa" } });
    const b = theme({ id: "b", colors: { ...defaultColors("dark"), primary: "#bbbbbb" } });
    const c = theme({ id: "c", colors: { ...defaultColors("dark"), primary: "#cccccc" } });

    applyThemeState({ themes: [a, c], activeId: "a" });
    expect(root().style.getPropertyValue("--primary")).toBe("#aaaaaa");

    // Editing theme B previews it across the app…
    beginThemePreview(b);
    expect(root().style.getPropertyValue("--primary")).toBe("#bbbbbb");

    // …even if someone publishes C while the editor is open.
    applyThemeState({ themes: [a, c], activeId: "c" });
    expect(root().style.getPropertyValue("--primary")).toBe("#bbbbbb");

    // Closing the editor lands on the published theme.
    endThemePreview();
    expect(root().style.getPropertyValue("--primary")).toBe("#cccccc");

    // Publish back to the default: inline vars are removed entirely.
    applyThemeState({ themes: [], activeId: null });
    expect(isThemeActive()).toBe(false);
    expect(root().style.getPropertyValue("--primary")).toBe("");
  });

  it("caches the latest server state for boot-time rehydration", () => {
    const t = theme({ id: "cached-1" });
    applyThemeState({ themes: [t], activeId: "cached-1" });
    const raw = localStorage.getItem("roboShelf.appTheme.v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as ThemeState;
    expect(parsed.activeId).toBe("cached-1");
    expect(parsed.themes[0].colors.primary).toBe("#123456");
  });
});

describe("helpers", () => {
  it("seeds new themes from a base or from mode defaults", () => {
    const seeded = createThemeFrom(theme({ mode: "light", radius: 0.9 }), "Copy");
    expect(seeded.mode).toBe("light");
    expect(seeded.radius).toBe(0.9);
    expect(seeded.colors.primary).toBe("#123456");
    expect(seeded.name).toBe("Copy");
    expect(seeded.id).not.toBe("t1");

    const fresh = createThemeFrom(null, "Fresh");
    expect(fresh.colors).toEqual(defaultColors("dark"));
    expect(fresh.radius).toBe(0.625);
  });

  it("ships presets with complete, valid palettes", () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(5);
    for (const preset of BUILTIN_THEMES) {
      for (const key of Object.keys(defaultColors(preset.mode))) {
        expect(preset.colors[key], `${preset.id}.${key}`).toMatch(
          /^#[0-9a-f]{6}([0-9a-f]{2})?$/,
        );
      }
    }
  });
});
