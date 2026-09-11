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

/** Guests (anonymous sessions) can browse everything but never interact.
 *  Brand-new members are treated like guests too: until they fill their
 *  profile AND an admin approves it, every interaction is blocked.
 *  Legacy/seeded members (data present, no approval flag yet) are grandfathered. */
export async function requireNonGuest(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.isAnonymous) {
    throw new Error("Guests are view-only — sign in to interact");
  }
  if (user.role !== "admin") {
    const hasData = Boolean(user.name && (user.studentId || user.phone));
    const allowed =
      user.profileApproved === true ||
      (user.profileApproved === undefined && hasData);
    if (!allowed) {
      throw new Error(
        user.name || user.studentId || user.phone
          ? "Your profile is awaiting admin approval — you can browse but not interact yet"
          : "Complete your profile first — it must be approved by an admin before you can interact",
      );
    }
  }
  return user;
}

export function isGuest(user: { isAnonymous?: boolean } | null) {
  return Boolean(user?.isAnonymous);
}
