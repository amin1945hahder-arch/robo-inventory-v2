import { QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";

export async function requireUser(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Please sign in first");
  }
  return user;
}

export async function requireAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return user;
}

/** Guests (anonymous sessions) can browse everything but never interact. */
export async function requireNonGuest(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.isAnonymous) {
    throw new Error("Guests are view-only — sign in to interact");
  }
  return user;
}

export function isGuest(user: { isAnonymous?: boolean } | null) {
  return Boolean(user?.isAnonymous);
}
