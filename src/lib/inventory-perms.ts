/**
 * Shared client-side rules for the inventory-manager privilege.
 *
 * Mirrors `hasInventoryPrivilege` / `inventoryPermsOf` in src/convex/lib.ts so
 * the People editor, the row chips and the Inventory screens can never drift
 * from the server gate: the privilege stacks on ANY role (member, student) and
 * admins hold all three sub-permissions implicitly.
 */

export type InventoryPermKey = "edit" | "add" | "delete";
export type InventoryPerms = Record<InventoryPermKey, boolean>;

export const INVENTORY_PERMS: readonly {
  key: InventoryPermKey;
  label: string;
  hint: string;
}[] = [
  { key: "edit", label: "Edit", hint: "Rename, re-categorise, edit descriptions" },
  { key: "add", label: "Add", hint: "Create parts, groups, storages" },
  { key: "delete", label: "Delete", hint: "Remove parts and groups for good" },
] as const;

export const ALL_INVENTORY_PERMS: InventoryPerms = {
  edit: true,
  add: true,
  delete: true,
};

type PermUser = {
  role?: string;
  inventoryRole?: boolean;
  inventoryPerms?: { edit: boolean; add: boolean; delete: boolean } | null;
} | null | undefined;

/** Admins hold it implicitly; everyone else needs the granted flag. */
export function hasInventoryPrivilege(user: PermUser): boolean {
  if (!user) return false;
  return user.role === "admin" || user.inventoryRole === true;
}

/**
 * Effective sub-permissions. A manager with nothing stored keeps full access
 * (same default as the printer privilege) so granting never silently
 * downgrades somebody who had been doing everything.
 */
export function inventoryPermsOf(user: PermUser): InventoryPerms {
  if (!user) return { edit: false, add: false, delete: false };
  if (user.role === "admin") return ALL_INVENTORY_PERMS;
  if (user.inventoryRole !== true) return { edit: false, add: false, delete: false };
  return {
    edit: user.inventoryPerms?.edit ?? true,
    add: user.inventoryPerms?.add ?? true,
    delete: user.inventoryPerms?.delete ?? true,
  };
}

/** "full" | the granted subset | "read-only" — for the row chip and dialog. */
export function inventoryPermsLabel(user: PermUser): string {
  if (!hasInventoryPrivilege(user)) return "not granted";
  if (user?.role === "admin") return "full (implicit)";
  const perms = inventoryPermsOf(user);
  const on = INVENTORY_PERMS.filter((p) => perms[p.key]).map((p) => p.label.toLowerCase());
  if (on.length === INVENTORY_PERMS.length) return "full";
  return on.length ? on.join(", ") : "read-only";
}