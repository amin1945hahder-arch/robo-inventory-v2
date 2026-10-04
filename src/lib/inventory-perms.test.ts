import { describe, expect, it } from "vitest";
import {
  ALL_INVENTORY_PERMS,
  INVENTORY_PERMS,
  hasInventoryPrivilege,
  inventoryPermsLabel,
  inventoryPermsOf,
} from "./inventory-perms";

const none = { edit: false, add: false, delete: false };

describe("inventory manager privilege (client rule)", () => {
  it("mirrors the server rule: admins hold it implicitly", () => {
    expect(hasInventoryPrivilege({ role: "admin" })).toBe(true);
    expect(hasInventoryPrivilege({ role: "admin", inventoryRole: false })).toBe(true);
  });

  it("members and students need the explicit grant", () => {
    expect(hasInventoryPrivilege({ role: "member" })).toBe(false);
    expect(hasInventoryPrivilege({ role: "member", inventoryRole: true })).toBe(true);
    expect(hasInventoryPrivilege({ role: "student", inventoryRole: true })).toBe(true);
    expect(hasInventoryPrivilege({ role: "student" })).toBe(false);
  });

  it("handles null and flag-less users", () => {
    expect(hasInventoryPrivilege(null)).toBe(false);
    expect(hasInventoryPrivilege(undefined)).toBe(false);
    expect(hasInventoryPrivilege({})).toBe(false);
  });

  it("grants every sub-permission to admins", () => {
    expect(inventoryPermsOf({ role: "admin" })).toEqual(ALL_INVENTORY_PERMS);
    expect(inventoryPermsOf({ role: "admin", inventoryPerms: none })).toEqual(ALL_INVENTORY_PERMS);
  });

  it("gives a non-manager nothing, even if perms are stored", () => {
    expect(inventoryPermsOf({ role: "member" })).toEqual(none);
    expect(inventoryPermsOf({ role: "member", inventoryPerms: ALL_INVENTORY_PERMS })).toEqual(none);
    expect(inventoryPermsOf(null)).toEqual(none);
  });

  it("defaults a granted manager with no stored perms to full access", () => {
    // Same default as the printer privilege: granting must not silently
    // downgrade somebody who was already doing everything.
    expect(inventoryPermsOf({ role: "member", inventoryRole: true })).toEqual(ALL_INVENTORY_PERMS);
    expect(
      inventoryPermsOf({ role: "member", inventoryRole: true, inventoryPerms: null }),
    ).toEqual(ALL_INVENTORY_PERMS);
  });

  it("honours an explicit narrowed subset", () => {
    expect(
      inventoryPermsOf({
        role: "member",
        inventoryRole: true,
        inventoryPerms: { edit: true, add: true, delete: false },
      }),
    ).toEqual({ edit: true, add: true, delete: false });
    expect(
      inventoryPermsOf({
        role: "member",
        inventoryRole: true,
        inventoryPerms: { edit: false, add: false, delete: false },
      }),
    ).toEqual(none);
  });

  it("labels the privilege for the People row chip and dialog", () => {
    expect(inventoryPermsLabel({ role: "admin", inventoryRole: true })).toBe("full (implicit)");
    expect(inventoryPermsLabel({ role: "member", inventoryRole: true })).toBe("full");
    expect(
      inventoryPermsLabel({
        role: "member",
        inventoryRole: true,
        inventoryPerms: { edit: true, add: false, delete: false },
      }),
    ).toBe("edit");
    expect(
      inventoryPermsLabel({
        role: "member",
        inventoryRole: true,
        inventoryPerms: { edit: false, add: true, delete: true },
      }),
    ).toBe("add, delete");
    expect(
      inventoryPermsLabel({ role: "member", inventoryRole: true, inventoryPerms: none }),
    ).toBe("read-only");
    expect(inventoryPermsLabel({ role: "member" })).toBe("not granted");
  });

  it("exposes the three sub-permissions the editor toggles", () => {
    expect(INVENTORY_PERMS.map((p) => p.key)).toEqual(["edit", "add", "delete"]);
    for (const perm of INVENTORY_PERMS) expect(perm.hint.length).toBeGreaterThan(0);
  });
});
