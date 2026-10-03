import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { defaultColors, TOKEN_KEYS, type ThemeMode } from "../lib/themeTokens";
import { requireAdmin } from "./lib";

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

export type AppTheme = {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: Record<string, string>;
  radius: number;
  createdAt: number;
  updatedAt: number;
};

type ThemesDoc = { themes: AppTheme[]; activeId: string | null };

async function readState(ctx: QueryCtx): Promise<ThemesDoc> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
  if (!row?.value) return { themes: [], activeId: null };
  try {
    const parsed = JSON.parse(row.value) as Partial<ThemesDoc>;
    return {
      themes: Array.isArray(parsed.themes) ? (parsed.themes as AppTheme[]) : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return { themes: [], activeId: null };
  }
}

async function writeState(ctx: MutationCtx, state: ThemesDoc): Promise<void> {
  const value = JSON.stringify(state);
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("settings", { key: KEY, value });
}

/**
 * The published theme state. Readable by anyone (signed in or not) so the
 * theme can apply instantly on the landing page and while offline.
 */
export const get = query({
  args: {},
  handler: async (ctx): Promise<{ themes: AppTheme[]; activeId: string | null }> => {
    const state = await readState(ctx);
    return { themes: state.themes, activeId: state.activeId };
  },
});

/** Admin creates or updates a theme. Validates every color + key. */
export const save = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    mode: v.union(v.literal("dark"), v.literal("light")),
    colors: v.record(v.string(), v.string()),
    radius: v.number(),
  },
  handler: async (ctx, { id, name, mode, colors, radius }): Promise<AppTheme> => {
    await requireAdmin(ctx);
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

    const cleanRadius = Math.min(4, Math.max(0, Number.isFinite(radius) ? radius : 0.625));
    const state = await readState(ctx);
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
        updatedAt: now,
      };
      state.themes = state.themes.map((t, i) => (i === existingIndex ? next : t));
      await writeState(ctx, state);
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
      createdAt: now,
      updatedAt: now,
    };
    state.themes = [...state.themes, newTheme];
    await writeState(ctx, state);
    return newTheme;
  },
});

/** Admin deletes a custom theme (built-ins are client-side constants). */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const state = await readState(ctx);
    const next = state.themes.filter((t) => t.id !== id);
    if (next.length === state.themes.length) return { ok: true };
    await writeState(ctx, {
      themes: next,
      activeId: state.activeId === id ? null : state.activeId,
    });
    return { ok: true };
  },
});

/**
 * Publish a theme to every member. `id` may be:
 *   - a stored custom theme id
 *   - a built-in preset id ("preset-…") — validated client-side
 *   - null → back to the shipped app default
 */
export const setActive = mutation({
  args: { id: v.union(v.string(), v.null()) },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const state = await readState(ctx);
    if (id !== null && !id.startsWith("preset-")) {
      if (!state.themes.some((t) => t.id === id)) {
        throw new ConvexError("That theme no longer exists");
      }
    }
    await writeState(ctx, { themes: state.themes, activeId: id });
    return { ok: true };
  },
});
