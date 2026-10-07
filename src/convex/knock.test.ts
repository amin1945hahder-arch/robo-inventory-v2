// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Knock integration contract (src/convex/knock.ts + src/convex/knockSend.ts):
 *
 *  - The channel is fire-and-forget: mutation helpers only SCHEDULE the node
 *    action (internal.knockSend.trigger) — they never touch the network and
 *    can never block the mutation that asked for the notification.
 *  - trigger returns { ok: false, reason } instead of throwing when
 *    KNOCK_API_KEY is not set — same no-op contract as the Telegram/WhatsApp
 *    channels, so the app works before the keys exist.
 *  - inboxToken only issues a feed token for the CALLER, and only when
 *    KNOCK_SIGNING_KEY is configured.
 *
 * Harness mirrors settings.test.ts: the registered wrappers are opaque, so the
 * definitions are handed straight through and handlers are invoked directly.
 */

vi.mock("./_generated/server", () => ({
  query: (def: unknown) => def,
  mutation: (def: unknown) => def,
  action: (def: unknown) => def,
  internalAction: (def: unknown) => def,
  internalQuery: (def: unknown) => def,
  internalMutation: (def: unknown) => def,
}));

// The scheduling helpers pass these refs through untouched — assert on them.
const TRIGGER_REF = "internal.knockSend.trigger";
const CURRENT_USER_REF = "internal.users.currentInternalUser";
vi.mock("./_generated/api", () => ({
  api: {},
  internal: {
    knockSend: { trigger: TRIGGER_REF },
    users: { currentInternalUser: CURRENT_USER_REF },
  },
}));

// Auth seam (users.ts → lib.ts chain), same narrow stub as settings.test.ts.
vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async (ctx: {
    auth?: { getUserIdentity?: () => Promise<{ subject?: string } | null> };
  }) => (await ctx.auth?.getUserIdentity?.())?.subject ?? null,
}));

const knockSend = await import("./knockSend");
const knock = await import("./knock");

type AnyCtx = Record<string, unknown>;

function handlerOf<A, R>(fn: unknown): (ctx: AnyCtx, args: A) => Promise<R> {
  return (fn as { handler: (ctx: AnyCtx, args: A) => Promise<R> }).handler;
}

// ── env hygiene: save/restore around every test ──────────────────────────────
const savedApi = process.env.KNOCK_API_KEY;
const savedSigning = process.env.KNOCK_SIGNING_KEY;

beforeEach(() => {
  delete process.env.KNOCK_API_KEY;
  delete process.env.KNOCK_SIGNING_KEY;
});

function restoreEnv() {
  if (savedApi === undefined) delete process.env.KNOCK_API_KEY;
  else process.env.KNOCK_API_KEY = savedApi;
  if (savedSigning === undefined) delete process.env.KNOCK_SIGNING_KEY;
  else process.env.KNOCK_SIGNING_KEY = savedSigning;
}

// ── trigger: configured gate, never throws ───────────────────────────────────

describe("knockSend.trigger", () => {
  it("is a no-op result until KNOCK_API_KEY is set", async () => {
    try {
      const trigger = handlerOf<{ workflow: string }, { ok: boolean; reason: string }>(
        knockSend.trigger,
      );
      await expect(
        trigger({}, { workflow: "rental-request" }),
      ).resolves.toEqual({ ok: false, reason: "KNOCK_API_KEY not set" });
    } finally {
      restoreEnv();
    }
  });

  it("returns early on empty recipients without touching the SDK", async () => {
    try {
      process.env.KNOCK_API_KEY = "sk_test_dummy";
      const trigger = handlerOf<{ recipients: unknown[] }, { ok: boolean; reason: string }>(
        knockSend.trigger,
      );
      // No network call is attempted: the guard fires before the SDK import.
      await expect(
        trigger({}, { recipients: [] }),
      ).resolves.toEqual({ ok: false, reason: "no recipients" });
    } finally {
      restoreEnv();
    }
  });
});

// ── inboxToken: caller-scoped, key-gated ─────────────────────────────────────

describe("knockSend.inboxToken", () => {
  it("reports unconfigured when KNOCK_SIGNING_KEY is missing", async () => {
    try {
      const inboxToken = handlerOf<{}, { token: null; configured: boolean; signedIn: boolean }>(
        knockSend.inboxToken,
      );
      await expect(inboxToken({}, {})).resolves.toEqual({
        token: null,
        configured: false,
        signedIn: false,
      });
    } finally {
      restoreEnv();
    }
  });

  it("issues no token for a signed-out caller", async () => {
    try {
      process.env.KNOCK_SIGNING_KEY = "test_signing_key";
      const inboxToken = handlerOf<{}, { token: null; configured: boolean; signedIn: boolean }>(
        knockSend.inboxToken,
      );
      const ctx = { runQuery: vi.fn().mockResolvedValue(null) };
      await expect(inboxToken(ctx, {})).resolves.toEqual({
        token: null,
        configured: true,
        signedIn: false,
      });
      // Resolves the caller through the internal query, never a raw arg.
      expect(ctx.runQuery).toHaveBeenCalledWith(CURRENT_USER_REF, {});
    } finally {
      restoreEnv();
    }
  });
});

// ── mutation helpers: schedule, never send ───────────────────────────────────

describe("knock scheduling helpers", () => {
  let runAfter: ReturnType<typeof vi.fn>;

  const userRow = (id: string, name?: string, email?: string) => ({
    _id: id,
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  });

  function ctxWith(admins: unknown[] = []): AnyCtx {
    return {
      scheduler: { runAfter },
      db: {
        query: () => ({ withIndex: () => ({ collect: async () => admins }) }),
      },
    };
  }

  beforeEach(() => {
    runAfter = vi.fn().mockResolvedValue(undefined);
  });

  it("knockTrigger schedules internal.knockSend.trigger with the payload", async () => {
    await knock.knockTrigger(ctxWith() as never, {
      workflow: "rental-request",
      recipients: [{ id: "u1", name: "Sam" }],
      actor: { id: "u2", name: "Ada" },
      data: { student: "Sam" },
    });
    expect(runAfter).toHaveBeenCalledWith(0, TRIGGER_REF, {
      workflow: "rental-request",
      recipients: [{ id: "u1", name: "Sam" }],
      actor: { id: "u2", name: "Ada" },
      data: { student: "Sam" },
    });
  });

  it("knockToAdmins fans out to admins only, inline-identifying each", async () => {
    await knock.knockToAdmins(
      ctxWith([userRow("a1", "Ann", "ann@club.dev"), userRow("a2")]) as never,
      { workflow: "rental-request", data: { student: "Sam" } },
    );
    expect(runAfter).toHaveBeenCalledWith(0, TRIGGER_REF, {
      workflow: "rental-request",
      recipients: [
        { id: "a1", name: "Ann", email: "ann@club.dev" },
        { id: "a2" },
      ],
      data: { student: "Sam" },
    });
  });

  it("knockToAdmins schedules nothing when there are no admins", async () => {
    await knock.knockToAdmins(ctxWith([]) as never, { workflow: "rental-request" });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("knockToUser targets exactly that member with name/email", async () => {
    await knock.knockToUser(
      ctxWith() as never,
      { _id: "u9", name: "Mo", email: "mo@club.dev" },
      { workflow: "rental-decision", data: { approved: true } },
    );
    expect(runAfter).toHaveBeenCalledWith(0, TRIGGER_REF, {
      workflow: "rental-decision",
      recipients: [{ id: "u9", name: "Mo", email: "mo@club.dev" }],
      data: { approved: true },
    });
  });
});
