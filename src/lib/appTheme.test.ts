import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeState,
  applyThemeToDom,
  beginThemePreview,
  BUILTIN_THEMES,
  createThemeFrom,
  defaultColors,
  effectiveThemeId,
  endThemePreview,
  initThemeFromCache,
  isThemeActive,
  resolveTheme,
  setThemeAwareUserMode,
  type AppTheme,
  type ThemeState,
} from "./appTheme";
import { getThemeIconOverrides } from "./custom-icons";

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
  document.body.classList.remove("dark");
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

describe("scheduled + default themes", () => {
  it("prefers the schedule window, then activeId, then defaultId", () => {
    const a = theme({ id: "a" });
    const b = theme({ id: "b" });
    const base = { themes: [a, b] };
    const now = Date.now();

    // Published wins over the default; default fills an empty publish slot.
    expect(effectiveThemeId({ ...base, activeId: "a", defaultId: "b" })).toBe("a");
    expect(effectiveThemeId({ ...base, activeId: null, defaultId: "b" })).toBe("b");
    expect(effectiveThemeId({ ...base, activeId: null, defaultId: null })).toBeNull();

    // Inside the window the scheduled theme wins over the published one…
    expect(
      effectiveThemeId({
        ...base,
        activeId: "a",
        defaultId: "b",
        schedule: { themeId: "b", from: now - 1_000, to: now + 60_000 },
      }),
    ).toBe("b");
    // …before and after it, the published theme stays live.
    expect(
      effectiveThemeId({
        ...base,
        activeId: "a",
        schedule: { themeId: "b", from: now + 1_000, to: now + 60_000 },
      }),
    ).toBe("a");
    expect(
      effectiveThemeId({
        ...base,
        activeId: "a",
        schedule: { themeId: "b", from: now - 60_000, to: now - 1_000 },
      }),
    ).toBe("a");
  });

  it("resolveTheme follows the same order", () => {
    const a = theme({ id: "a" });
    const b = theme({ id: "b" });
    const now = Date.now();
    const state: ThemeState = {
      themes: [a, b],
      activeId: "a",
      defaultId: "b",
      schedule: { themeId: "b", from: now - 1_000, to: now + 60_000 },
    };
    expect(resolveTheme(state)?.id).toBe("b");
    expect(resolveTheme({ ...state, schedule: null })?.id).toBe("a");
    expect(resolveTheme({ ...state, activeId: null, schedule: null })?.id).toBe("b");
  });

  it("auto-flips at the schedule window boundaries", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const a = theme({ id: "a", colors: { ...defaultColors("dark"), primary: "#aaaaaa" } });
      const x = theme({ id: "x", colors: { ...defaultColors("dark"), primary: "#ff00ff" } });

      applyThemeState({
        themes: [a, x],
        activeId: "a",
        schedule: { themeId: "x", from: 1_000_000 + 1_000, to: 1_000_000 + 60_000 },
      });
      // Window not open yet → the published theme is live.
      expect(root().style.getPropertyValue("--primary")).toBe("#aaaaaa");

      // Crossing the start boundary applies the scheduled theme…
      vi.advanceTimersByTime(1_300);
      expect(root().style.getPropertyValue("--primary")).toBe("#ff00ff");

      // …and crossing the end boundary reverts to the published theme.
      vi.advanceTimersByTime(60_000);
      expect(root().style.getPropertyValue("--primary")).toBe("#aaaaaa");
    } finally {
      vi.useRealTimers();
      applyThemeState({ themes: [], activeId: null });
    }
  });
});

describe("corner radius persistence (publish regression)", () => {
  it("keeps the edited radius through preview → save & publish → editor close", () => {
    const colors = { ...defaultColors("dark"), primary: "#abcdef" };
    const saved = theme({ id: "saved-1", radius: 1.5, colors });

    // Editing: the draft previews live across the whole app.
    beginThemePreview(saved);
    expect(root().style.getPropertyValue("--radius")).toBe("1.5rem");

    // Save & publish happens WHILE the editor is open (previewDepth > 0).
    applyThemeState({ themes: [saved], activeId: "saved-1" });

    // Editor closes → rollback must restore the SAVED theme, radius included.
    endThemePreview();
    expect(root().style.getPropertyValue("--radius")).toBe("1.5rem");
    expect(root().style.getPropertyValue("--primary")).toBe("#abcdef");
  });

  it("keeps the radius through the boot cache (save → reload → apply)", () => {
    applyThemeState({
      themes: [theme({ id: "cached-radius", radius: 1.25 })],
      activeId: "cached-radius",
    });
    const parsed = JSON.parse(localStorage.getItem("roboShelf.appTheme.v1") as string) as ThemeState;
    expect(parsed.themes[0].radius).toBe(1.25);
    // Simulate a fresh boot: scrub the DOM, re-apply from the cache.
    applyThemeToDom(null);
    expect(root().style.getPropertyValue("--radius")).toBe("");
    initThemeFromCache();
    expect(root().style.getPropertyValue("--radius")).toBe("1.25rem");
    applyThemeState({ themes: [], activeId: null });
  });
});

describe("per-theme icon overrides", () => {
  it("applies icons with the theme and clears them when it is switched off", () => {
    expect(getThemeIconOverrides()).toBeNull();
    applyThemeToDom(theme({ icons: { "nav:/inventory": "Gift", "category:arduino": "Cpu" } }));
    expect(getThemeIconOverrides()).toEqual({
      "nav:/inventory": "Gift",
      "category:arduino": "Cpu",
    });
    applyThemeToDom(theme()); // theme without icons → slots keep their current icon
    expect(getThemeIconOverrides()).toBeNull();
    applyThemeToDom(null);
    expect(getThemeIconOverrides()).toBeNull();
  });

  it("round-trips icons, defaultId and schedule through the boot cache", () => {
    const t = theme({ id: "cached-icons", icons: { "nav:/settings": "Wrench" } });
    const now = Date.now();
    applyThemeState({
      themes: [t],
      activeId: "cached-icons",
      defaultId: "preset-christmas-eve",
      schedule: { themeId: "preset-ramadan-crescent", from: now, to: now + 5_000 },
    });
    const parsed = JSON.parse(localStorage.getItem("roboShelf.appTheme.v1") as string) as ThemeState;
    expect(parsed.defaultId).toBe("preset-christmas-eve");
    expect(parsed.schedule).toEqual({
      themeId: "preset-ramadan-crescent",
      from: now,
      to: now + 5_000,
    });
    expect(parsed.themes[0].icons).toEqual({ "nav:/settings": "Wrench" });
  });
});

describe("dark-class placement (theme shadowing regression)", () => {
  // A `.dark` class on <body> re-declares every --* token on the body
  // element. Custom properties resolve to the NEAREST declaration, so body's
  // .dark block would win over the theme's inline vars inherited from <html>
  // and the published theme would appear "not applied" inside the app.
  // index.html shipped <body class="dark"> for years — the engine must scrub
  // it every time it manages the mode.
  it("scrubs .dark from <body> when a theme is applied", () => {
    document.body.classList.add("dark");
    applyThemeToDom(theme());
    expect(document.body.classList.contains("dark")).toBe(false);
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.getPropertyValue("--primary")).toBe("#123456");
  });

  it("scrubs .dark from <body> when the theme is switched off", () => {
    document.body.classList.add("dark");
    applyThemeToDom(null);
    expect(document.body.classList.contains("dark")).toBe(false);
  });

  it("keeps <body> clean during previews and light-mode themes", () => {
    document.body.classList.add("dark");
    beginThemePreview(theme({ mode: "light", colors: defaultColors("light") }));
    expect(document.body.classList.contains("dark")).toBe(false);
    expect(root().classList.contains("dark")).toBe(false);
    endThemePreview();
    expect(document.body.classList.contains("dark")).toBe(false);
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
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(15);
    for (const id of [
      "preset-christmas-eve",
      "preset-ramadan-crescent",
      "preset-halloween-night",
      "preset-diwali-glow",
      "preset-valentines-blush",
      "preset-northern-lights",
      "preset-cyber-neon",
    ]) {
      expect(BUILTIN_THEMES.some((t) => t.id === id), id).toBe(true);
    }
    for (const preset of BUILTIN_THEMES) {
      for (const key of Object.keys(defaultColors(preset.mode))) {
        expect(preset.colors[key], `${preset.id}.${key}`).toMatch(
          /^#[0-9a-f]{6}([0-9a-f]{2})?$/,
        );
      }
    }
  });
});
