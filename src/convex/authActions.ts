/**
 * ActionCtx auth gates — the action-side twins of `lib.ts`.
 *
 * Convex platform rule: an ACTION's `ctx` has no `ctx.db`, and identity
 * (`users`/`sessions`/…) stays in the Convex database forever. So an action
 * cannot call `requireUser(ctx)`; it must read the current user through an
 * internal QUERY (`ctx.runQuery(internal.users.currentInternalUser, {})`).
 *
 * These helpers exist so the query→action conversion is mechanical and safe:
 * a converted function changes `requireAdmin(ctx)` to `requireActionAdmin(ctx)`
 * and keeps every downstream rule (guest/approval, student block, printer and
 * inventory privileges) byte-for-byte identical, because they all delegate to
 * the SAME pure predicates exported from `lib.ts`.
 */
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  assertInteractionAllowed,
  hasInventoryPrivilege,
  hasPrinterPrivilege,
  inventoryPermsOf,
  type InventoryPerm,
} from "./lib";

export type AuthUserDoc = Doc<"users">;

/** The signed-in user, read from Convex. `null` when signed out. */
export async function actionCurrentUser(ctx: ActionCtx): Promise<AuthUserDoc | null> {
  return (await ctx.runQuery(internal.users.currentInternalUser, {})) as AuthUserDoc | null;
}

export async function requireActionUser(ctx: ActionCtx): Promise<AuthUserDoc> {
  const user = await actionCurrentUser(ctx);
  if (!user) throw new Error("Please sign in first");
  return user;
}

export async function requireActionAdmin(ctx: ActionCtx): Promise<AuthUserDoc> {
  const user = await requireActionUser(ctx);
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

export async function requireActionNonGuest(ctx: ActionCtx): Promise<AuthUserDoc> {
  const user = await requireActionUser(ctx);
  assertInteractionAllowed(user);
  return user;
}

export async function requireActionNonStudent(ctx: ActionCtx): Promise<AuthUserDoc> {
  const user = await requireActionUser(ctx);
  if (user.role === "student") {
    throw new Error("Your account has student-level access — this area is restricted");
  }
  return user;
}

export async function requireActionInteractingMember(ctx: ActionCtx): Promise<AuthUserDoc> {
  const user = await requireActionNonStudent(ctx);
  assertInteractionAllowed(user);
  return user;
}

export async function requireActionPrinter(ctx: ActionCtx): Promise<AuthUserDoc> {
  const user = await requireActionNonStudent(ctx);
  if (!hasPrinterPrivilege(user)) {
    throw new Error("Printer access required — request the printer role from your profile");
  }
  return user;
}

export async function requireActionInventory(
  ctx: ActionCtx,
  perm: InventoryPerm | readonly InventoryPerm[],
): Promise<AuthUserDoc> {
  const user = await requireActionNonStudent(ctx);
  if (!hasInventoryPrivilege(user)) {
    throw new Error("Inventory manager access required — request it from your profile");
  }
  const perms = inventoryPermsOf(user);
  const wanted: readonly InventoryPerm[] = typeof perm === "string" ? [perm] : perm;
  if (!wanted.some((p) => perms[p])) {
    throw new Error(
      `Your inventory manager access does not include the "${wanted.join('" or "')}" permission`,
    );
  }
  return user;
}

/** Action-side `listAdmins` — resolves admins via the internal `by_role` query. */
export async function listAdminsForAction(ctx: ActionCtx): Promise<AuthUserDoc[]> {
  return (await ctx.runQuery(internal.users.listAdminsInternal, {})) as AuthUserDoc[];
}
