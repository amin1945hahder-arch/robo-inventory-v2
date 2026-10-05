import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { defaultColors, TOKEN_KEYS, type ThemeMode } from "../lib/themeTokens";
import { requireActionAdmin } from "./authActions";
import { loadTurso, publishTouchedHeads } from "./tursoDb";
import type { BridgeDb } from "../lib/turso-bridge";

/**
 * Global app themes — published by an admin, used by EVERY member.
 *
 * Everything lives in one `settings` row (key "app_themes"):
 *   { themes: AppTheme[], activeId: string | null }
 *
 * `get` is intentionally readable without auth: the published theme is not
 * a secret and the public landing page / offline cache need it too. All
 * writes require an admin.
 */

const KEY = "app_themes";
const MAX_THEMES = 60;
const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const ICON_SLOT_RE = /^(nav|category):[a-z0-9:/-]{1,80}$/;
const ICON_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_ICON_OVERRIDES = 120;

export type AppTheme = {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: Record<string, string>;
  radius: number;
  /** Icon-slot overrides ("nav:/inventory" → "Boxes"). Optional. */
  icons?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
};

/** Auto-applied window (ms epoch): themeId is live from → to. */
export type ThemeSchedule = { themeId: string; from: number; to: number };

type ThemesDoc = {
  themes: AppTheme[];
  activeId: string | null;
  defaultId: string | null;
  schedule: ThemeSchedule | null;
};

function parseSchedule(raw: unknown): ThemeSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ThemeSchedule>;
  if (
    typeof s.themeId === "string" &&
    typeof s.from === "number" &&
    typeof s.to === "number" &&
    Number.isFinite(s.from) &&
    Number.isFinite(s.to) &&
    s.to > s.from
  ) {
    return { themeId: s.themeId, from: s.from, to: s.to };
  }
  return null;
}

function parseThemesDoc(value: string | undefined): ThemesDoc {
  if (!value) return { themes: [], activeId: null, defaultId: null, schedule: null };
  try {
    const parsed = JSON.parse(value) as Partial<ThemesDoc>;
    return {
      themes: Array.isArray(parsed.themes) ? (parsed.themes as AppTheme[]) : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
      defaultId: typeof parsed.defaultId === "string" ? parsed.defaultId : null,
      schedule: parseSchedule(parsed.schedule),
    };
  } catch {
    return { themes: [], activeId: null, defaultId: null, schedule: null };
  }
}

/** Read the app-theme settings row from Turso. */
async function readStateDb(db: BridgeDb): Promise<ThemesDoc> {
  const row = await db
    .query<Doc<"settings">>("settings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
  return parseThemesDoc(row?.value);
}

async function writeState(db: BridgeDb, state: ThemesDoc): Promise<void> {
  const value = JSON.stringify(state);
  const row = await db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
  if (row) await db.patch(row._id, { value });
  else await db.insert("settings", { key: KEY, value });
}

/**
 * The published theme state. Readable by anyone (signed in or not) so the
 * theme can apply instantly on the landing page and while offline.
 */
export const get = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    themes: AppTheme[];
    activeId: string | null;
    defaultId: string | null;
    schedule: ThemeSchedule | null;
  }> => {
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const state = await readStateDb(db);
    return {
      themes: state.themes,
      activeId: state.activeId,
      defaultId: state.defaultId,
      schedule: state.schedule,
    };
  },
});

/** Admin creates or updates a theme. Validates every color + key. */
export const save = action({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    mode: v.union(v.literal("dark"), v.literal("light")),
    colors: v.record(v.string(), v.string()),
    radius: v.number(),
    icons: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args): Promise<AppTheme> => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const result = await db.transaction(async () => {
      const { id, name, mode, colors, radius, icons } = args;
      const cleanName = name.trim().slice(0, 40);
      if (!cleanName) throw new ConvexError("A theme name is required");

      const merged: Record<string, string> = { ...defaultColors(mode) };
      for (const [key, value] of Object.entries(colors)) {
        if (!(TOKEN_KEYS as readonly string[]).includes(key)) {
          throw new ConvexError(`Unknown theme token: ${key}`);
        }
        if (!HEX_RE.test(value)) {
          throw new ConvexError(`Invalid color for ${key}: ${value}`);
        }
        merged[key] = value.toLowerCase();
      }

      // Icon overrides: slot keys ("nav:/inventory" / "category:arduino") →
      // catalog icon names. Empty → undefined (slot keeps its current icon).
      let cleanIcons: Record<string, string> | undefined;
      if (icons && Object.keys(icons).length > 0) {
        if (Object.keys(icons).length > MAX_ICON_OVERRIDES) {
          throw new ConvexError(`Too many icon overrides (max ${MAX_ICON_OVERRIDES})`);
        }
        cleanIcons = {};
        for (const [slot, name] of Object.entries(icons)) {
          if (!ICON_SLOT_RE.test(slot)) throw new ConvexError(`Invalid icon slot: ${slot}`);
          if (!ICON_NAME_RE.test(name)) {
            throw new ConvexError(`Invalid icon name for ${slot}: ${name}`);
          }
          cleanIcons[slot] = name;
        }
      }

      const cleanRadius = Math.min(4, Math.max(0, Number.isFinite(radius) ? radius : 0.625));
      const state = await readStateDb(db);
      const now = Date.now();

      const existingIndex = id ? state.themes.findIndex((t) => t.id === id) : -1;
      if (existingIndex >= 0) {
        const prev = state.themes[existingIndex];
        const next: AppTheme = {
          ...prev,
          name: cleanName,
          mode,
          colors: merged,
          radius: cleanRadius,
          icons: cleanIcons,
          updatedAt: now,
        };
        state.themes = state.themes.map((t, i) => (i === existingIndex ? next : t));
        await writeState(db, state);
        return next;
      }

      if (state.themes.length >= MAX_THEMES) {
        throw new ConvexError(`Theme limit reached (${MAX_THEMES})`);
      }
      const newTheme: AppTheme = {
        id: `theme_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: cleanName,
        mode,
        colors: merged,
        radius: cleanRadius,
        icons: cleanIcons,
        createdAt: now,
        updatedAt: now,
      };
      state.themes = [...state.themes, newTheme];
      await writeState(db, state);
      return newTheme;
    });

    await publishTouchedHeads(ctx, db);
    return result;
  },
});

/** Admin deletes a custom theme (built-ins are client-side constants). */
export const remove = action({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const result = await db.transaction(async () => {
      const state = await readStateDb(db);
      const next = state.themes.filter((t) => t.id !== id);
      if (next.length === state.themes.length) return { ok: true };
      await writeState(db, {
        themes: next,
        activeId: state.activeId === id ? null : state.activeId,
        defaultId: state.defaultId === id ? null : state.defaultId,
        schedule: state.schedule?.themeId === id ? null : state.schedule,
      });
      return { ok: true };
    });
    await publishTouchedHeads(ctx, db);
    return result;
  },
});

/**
 * Publish a theme to every member. `id` may be:
 *   - a stored custom theme id
 *   - a built-in preset id ("preset-…") — validated client-side
 *   - null → back to the shipped app default
 */
export const setActive = action({
  args: { id: v.union(v.string(), v.null()) },
  handler: async (ctx, { id }) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const result = await db.transaction(async () => {
      const state = await readStateDb(db);
      assertThemeExists(state, id);
      await writeState(db, { ...state, activeId: id });
      return { ok: true };
    });
    await publishTouchedHeads(ctx, db);
    return result;
  },
});

function assertThemeExists(state: ThemesDoc, id: string | null): void {
  if (id !== null && !id.startsWith("preset-")) {
    if (!state.themes.some((t) => t.id === id)) {
      throw new ConvexError("That theme no longer exists");
    }
  }
}

/**
 * The club's DEFAULT theme: applied whenever no theme is explicitly
 * published (activeId null) and no schedule window is running.
 * `id` = null → back to the shipped app default.
 */
export const setDefault = action({
  args: { id: v.union(v.string(), v.null()) },
  handler: async (ctx, { id }) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const result = await db.transaction(async () => {
      const state = await readStateDb(db);
      assertThemeExists(state, id);
      await writeState(db, { ...state, defaultId: id });
      return { ok: true };
    });
    await publishTouchedHeads(ctx, db);
    return result;
  },
});

/**
 * Schedule a theme to auto-apply between two timestamps (ms epoch), e.g.
 * Christmas theme Dec 15 → Jan 6. Inside the window it wins over activeId /
 * defaultId; when it ends the previous theme returns automatically (each
 * client flips itself at the boundary — no re-publish needed).
 * `themeId` = null → clear the schedule.
 */
export const setSchedule = action({
  args: {
    themeId: v.union(v.string(), v.null()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, { themeId, from, to }) => {
    await requireActionAdmin(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");
    const result = await db.transaction(async () => {
      const state = await readStateDb(db);
      if (themeId === null) {
        await writeState(db, { ...state, schedule: null });
        return { ok: true };
      }
      assertThemeExists(state, themeId);
      if (
        typeof from !== "number" ||
        typeof to !== "number" ||
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        to <= from
      ) {
        throw new ConvexError("Schedule needs an end time after its start time");
      }
      await writeState(db, { ...state, schedule: { themeId, from, to } });
      return { ok: true };
    });
    await publishTouchedHeads(ctx, db);
    return result;
  },
});
