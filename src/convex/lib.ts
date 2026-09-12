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

/** Member interactions that touch the inventory (rent, return, packages).
 *  Students are blocked (restricted role) and the usual guest/approval rules
 *  still apply to everyone else. */
export async function requireInteractingMember(ctx: QueryCtx) {
  const user = await requireNonStudent(ctx);
  // Re-run the guest/approval checks from requireNonGuest against the
  // non-student user we already have.
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

/**
 * Student role gate. Students are blocked from the inventory modules and
 * administrative settings — they keep access to Chat, Courses (when shipped),
 * Profile and Dashboard. Every backend function in a protected module calls
 * this, so even a hand-crafted API call from a student account is rejected.
 */
export async function requireNonStudent(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.role === "student") {
    throw new Error("Your account has student-level access — this area is restricted");
  }
  return user;
}

/**
 * Guard for profile pictures in list/query projections.
 *
 * Avatars are base64 data URLs on user docs. A single oversized legacy image
 * (hundreds of KB) repeated once per rental row inflates a query response
 * beyond Convex's 16 MB per-execution budget and crashes the page. Properly
 * compressed uploads are 10–30 KB, so anything larger is stripped here —
 * the UI falls back to the initial-letter avatar.
 */
export function safeImage(image: string | undefined | null): string | undefined {
  return typeof image === "string" && image.length > 0 && image.length <= 60_000
    ? image
    : undefined;
}

export function isGuest(user: { isAnonymous?: boolean } | null) {
  return Boolean(user?.isAnonymous);
}
