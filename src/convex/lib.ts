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

/**
 * Shared guest/approval rule. Guests (anonymous sessions) can browse
 * everything but never interact. Brand-new members are treated like guests
 * too: until they fill their profile AND an admin approves it, every
 * interaction is blocked. Legacy/seeded members (data present, no approval
 * flag yet) are grandfathered.
 *
 * Pure (no ctx) so the SAME rule backs both the Convex query/mutation gates
 * below and the action gates in `authActions.ts` — one rule, two entry points.
 */
export function assertInteractionAllowed(user: {
  isAnonymous?: boolean;
  role?: string;
  name?: string;
  studentId?: string;
  phone?: string;
  profileApproved?: boolean;
}): void {
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
}

export async function requireNonGuest(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  assertInteractionAllowed(user);
  return user;
}

/** Member interactions that touch the inventory (rent, return, packages).
 *  Students are blocked (restricted role) and the usual guest/approval rules
 *  still apply to everyone else. */
export async function requireInteractingMember(ctx: QueryCtx) {
  const user = await requireNonStudent(ctx);
  // Re-run the guest/approval checks from requireNonGuest against the
  // non-student user we already have.
  assertInteractionAllowed(user);
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
 * "printer" privilege gate for the print farm. The privilege stacks on top of
 * any role (member + printer, student + printer); admins hold it implicitly.
 * Anyone can VIEW the farm; submitting sliced jobs, scheduling and running
 * prints requires the privilege.
 */
export async function requirePrinter(ctx: QueryCtx) {
  const user = await requireNonStudent(ctx);
  if (!hasPrinterPrivilege(user)) {
    throw new Error(
      "Printer access required — request the printer role from your profile",
    );
  }
  return user;
}

/** Shared rule: admins implicitly hold the printer privilege. */
export function hasPrinterPrivilege(
  user:
    | {
        role?: string;
        printerRole?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!user) return false;
  return user.role === "admin" || user.printerRole === true;
}

// ===== Inventory manager privilege =========================================
// Exactly like the printer privilege: stacks on any role, requestable by the
// member, grantable by an admin — plus three sub-permissions (edit / add /
// delete) that the admin picks when granting it. Admins hold all three.

export type InventoryPerm = "edit" | "add" | "delete";

export type InventoryPerms = Record<InventoryPerm, boolean>;

/** Shared rule: admins implicitly hold every inventory permission. */
export function hasInventoryPrivilege(
  user:
    | {
        role?: string;
        inventoryRole?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!user) return false;
  return user.role === "admin" || user.inventoryRole === true;
}

/** The effective inventory sub-permissions for a user. */
export function inventoryPermsOf(
  user:
    | {
        role?: string;
        inventoryRole?: boolean;
        inventoryPerms?: { edit: boolean; add: boolean; delete: boolean } | null;
      }
    | null
    | undefined,
): InventoryPerms {
  if (!user) return { edit: false, add: false, delete: false };
  if (user.role === "admin") return { edit: true, add: true, delete: true };
  if (user.inventoryRole !== true) return { edit: false, add: false, delete: false };
  // A granted privilege without explicit sub-permissions defaults to full
  // access (same as the printer privilege); the admin can narrow it later.
  return {
    edit: user.inventoryPerms?.edit ?? true,
    add: user.inventoryPerms?.add ?? true,
    delete: user.inventoryPerms?.delete ?? true,
  };
}

/**
 * Gate for inventory WRITE operations. Students are blocked (restricted
 * role); admins pass with every permission; inventory managers need the
 * specific sub-permission the mutation performs.
 */
export async function requireInventory(
  ctx: QueryCtx,
  perm: InventoryPerm | readonly InventoryPerm[],
) {
  const user = await requireNonStudent(ctx);
  if (!hasInventoryPrivilege(user)) {
    throw new Error(
      "Inventory manager access required — request it from your profile",
    );
  }
  const perms = inventoryPermsOf(user);
  // Pass an array for operations that satisfy either permission (e.g. an
  // upsert counts as "add" when creating and "edit" when updating).
  const wanted: readonly InventoryPerm[] =
    typeof perm === "string" ? [perm] : perm;
  if (!wanted.some((p) => perms[p])) {
    throw new Error(
      `Your inventory manager access does not include the "${wanted.join('" or "')}" permission`,
    );
  }
  return user;
}

/** Admins of the club, read through the `by_role` index (1 read) instead of
 *  scanning every user document. Used by every request/return notification. */
export async function listAdmins(ctx: QueryCtx) {
  return await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .collect();
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
