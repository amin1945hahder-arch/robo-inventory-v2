// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reported crash: opening the PUBLIC landing page while signed out threw
 *
 *   Uncaught Error: Please sign in first
 *     at requireUser (src/convex/lib.ts:8)
 *     at async handler (src/convex/settings.ts getMyTheme)
 *
 * Root cause: `settings.getMyTheme` is subscribed app-wide by AppThemeProvider
 * (mounted in main.tsx — landing page included), but its handler called
 * requireUser(), which throws for anonymous visitors. Every page a signed-out
 * person can reach (the landing page) crashed with a Convex query error.
 *
 * Fix: the three PER-USER preference READS — getMyTheme / getMyAppearance /
 * getMyFont — are public-safe now: signed-out (or stale-session) callers get
 * the app default instead of an exception. WRITES still require sign-in.
 * These tests pin both halves of that contract.
 */

// ── the auth seam ────────────────────────────────────────────────────────────
// users.getCurrentUser resolves the caller through @convex-dev/auth/server's
// getAuthUserId. Stubbing just that seam keeps everything else real: the real
// lib.requireUser, the real handler bodies, the real registered functions.
vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async (ctx: TestCtx) => (await ctx.auth.getUserIdentity())?.subject ?? null,
}));

// Side chains of users.ts that are irrelevant here — mocked so the module
// graph under test stays small and deterministic.
vi.mock("./sync", () => ({ touchPatch: vi.fn(), recordTombstone: vi.fn() }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn(), telegramDM: vi.fn() }));

// The real query()/mutation() wrap handlers in an opaque Registered object
// whose body isn't reachable; hand the definition straight through instead so
// tests can invoke the handler bodies directly. Runtime only — types still
// come from the real declarations via handlerOf.
vi.mock("./_generated/server", () => ({
  query: (def: unknown) => def,
  mutation: (def: unknown) => def,
  action: (def: unknown) => def,
  internalQuery: (def: unknown) => def,
  internalMutation: (def: unknown) => def,
}));

vi.mock("./_generated/api", () => ({ api: {}, internal: {} }));

const settings = await import("./settings");

/**
 * RegisteredQuery/RegisteredMutation don't expose `handler` in their public
 * types, but the runtime object registered by query()/mutation() carries it.
 * One narrow cast at the boundary; every call site stays fully typed through
 * the returned signature.
 */
function handlerOf<A, R>(fn: unknown): (ctx: TestCtx, args: A) => Promise<R> {
  return (fn as { handler: (ctx: TestCtx, args: A) => Promise<R> }).handler;
}

// ── fake ctx: only what these handlers touch (auth identity + db get/patch) ──

type UserDoc = {
  _id: string;
  themeId?: string;
  appearance?: "dark" | "light" | "system";
  font?: string;
};

const dbGet = vi.fn<(id: string) => Promise<UserDoc | null>>();
const dbPatch = vi.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>();

type TestCtx = {
  db: { get: typeof dbGet; patch: typeof dbPatch };
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

function makeCtx(userId: string | null): TestCtx {
  return {
    db: { get: dbGet, patch: dbPatch },
    auth: { getUserIdentity: async () => (userId ? { subject: userId } : null) },
  };
}

beforeEach(() => {
  dbGet.mockReset();
  dbGet.mockResolvedValue(null);
  dbPatch.mockReset();
  dbPatch.mockResolvedValue(undefined);
});

// ── reads: public-safe ───────────────────────────────────────────────────────

describe("per-user preference reads are public-safe (landing page fix)", () => {
  it("getMyTheme returns '' instead of throwing when signed out", async () => {
    await expect(handlerOf<{}, string>(settings.getMyTheme)(makeCtx(null), {})).resolves.toBe("");
  });

  it("getMyAppearance falls back to the dark default when signed out", async () => {
    await expect(
      handlerOf<{}, "dark" | "light" | "system">(settings.getMyAppearance)(makeCtx(null), {}),
    ).resolves.toBe("dark");
  });

  it("getMyFont returns '' when signed out", async () => {
    await expect(handlerOf<{}, string>(settings.getMyFont)(makeCtx(null), {})).resolves.toBe("");
  });

  it("a stale session (deleted user doc) also resolves to defaults, not a crash", async () => {
    // getAuthUserId finds an id, but ctx.db.get returns null (doc gone).
    await expect(handlerOf<{}, string>(settings.getMyTheme)(makeCtx("ghost"), {})).resolves.toBe(
      "",
    );
    await expect(
      handlerOf<{}, "dark" | "light" | "system">(settings.getMyAppearance)(makeCtx("ghost"), {}),
    ).resolves.toBe("dark");
    await expect(handlerOf<{}, string>(settings.getMyFont)(makeCtx("ghost"), {})).resolves.toBe("");
  });

  it("signed-in members still get their own saved values", async () => {
    dbGet.mockImplementation(async (id: string) =>
      id === "u1"
        ? { _id: "u1", themeId: "preset-midnight", appearance: "light", font: "inter" }
        : null,
    );
    await expect(handlerOf<{}, string>(settings.getMyTheme)(makeCtx("u1"), {})).resolves.toBe(
      "preset-midnight",
    );
    await expect(
      handlerOf<{}, "dark" | "light" | "system">(settings.getMyAppearance)(makeCtx("u1"), {}),
    ).resolves.toBe("light");
    await expect(handlerOf<{}, string>(settings.getMyFont)(makeCtx("u1"), {})).resolves.toBe(
      "inter",
    );
  });

  it("a member with no explicit preference gets defaults (never undefined)", async () => {
    dbGet.mockResolvedValue({ _id: "u2" });
    await expect(handlerOf<{}, string>(settings.getMyTheme)(makeCtx("u2"), {})).resolves.toBe("");
    await expect(
      handlerOf<{}, "dark" | "light" | "system">(settings.getMyAppearance)(makeCtx("u2"), {}),
    ).resolves.toBe("dark");
    await expect(handlerOf<{}, string>(settings.getMyFont)(makeCtx("u2"), {})).resolves.toBe("");
  });
});

// ── writes: still sign-in only ───────────────────────────────────────────────

describe("preference WRITES still require a signed-in user", () => {
  it("setMyTheme rejects anonymous callers with the sign-in error", async () => {
    await expect(
      handlerOf<{ id: string | null }, { ok: boolean }>(settings.setMyTheme)(makeCtx(null), {
        id: "preset-midnight",
      }),
    ).rejects.toThrow("Please sign in first");
    expect(dbPatch).not.toHaveBeenCalled();
  });

  it("setMyFont rejects anonymous callers", async () => {
    await expect(
      handlerOf<{ font: string }, { ok: boolean }>(settings.setMyFont)(makeCtx(null), {
        font: "inter",
      }),
    ).rejects.toThrow("Please sign in first");
    expect(dbPatch).not.toHaveBeenCalled();
  });

  it("setMyAppearance rejects anonymous callers", async () => {
    await expect(
      handlerOf<{ value: "dark" | "light" | "system" }, { ok: boolean }>(settings.setMyAppearance)(
        makeCtx(null),
        { value: "light" },
      ),
    ).rejects.toThrow("Please sign in first");
    expect(dbPatch).not.toHaveBeenCalled();
  });

  it("a signed-in member can save and clear their theme (trimmed, null clears)", async () => {
    dbGet.mockResolvedValue({ _id: "u1" });
    const setMyTheme = handlerOf<{ id: string | null }, { ok: boolean }>(settings.setMyTheme);

    await setMyTheme(makeCtx("u1"), { id: "  preset-midnight  " });
    expect(dbPatch).toHaveBeenLastCalledWith("u1", { themeId: "preset-midnight" });

    await setMyTheme(makeCtx("u1"), { id: null });
    expect(dbPatch).toHaveBeenLastCalledWith("u1", { themeId: undefined });
  });

  it("setMyFont validates the font id slug", async () => {
    dbGet.mockResolvedValue({ _id: "u1" });
    const setMyFont = handlerOf<{ font: string }, { ok: boolean }>(settings.setMyFont);

    await expect(
      setMyFont(makeCtx("u1"), { font: "not a font id!" }),
    ).rejects.toThrow("Unknown font id");
    expect(dbPatch).not.toHaveBeenCalled();
  });
});
