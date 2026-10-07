import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthUserSync,
  publishAuthUser,
  readCachedUser,
  subscribeAuthUser,
  type CachedUser,
} from "./use-auth";

/** `_id` is an Id<"users">, which the tests don't need to model faithfully. */
const asUser = (id: string): CachedUser => ({ _id: id } as unknown as CachedUser);

const seed = (user: CachedUser | null) =>
  localStorage.setItem(
    "rc.authUser.v1",
    user ? JSON.stringify(user) : "null",
  );

describe("persisted identity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(readCachedUser()).toBeNull();
  });

  it("reads back a stored identity", () => {
    seed({ ...asUser("u1"), name: "Ada" });
    expect(readCachedUser()).toMatchObject({ _id: "u1", name: "Ada" });
  });

  it("rejects a stored blob without an _id", () => {
    seed({ name: "no id" } as unknown as CachedUser);
    expect(readCachedUser()).toBeNull();
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem("rc.authUser.v1", "{not json");
    expect(readCachedUser()).toBeNull();
  });
});

describe("shared auth user store", () => {
  beforeEach(() => {
    publishAuthUser(null);
    localStorage.clear();
  });

  it("publishes an identity that is then readable synchronously", () => {
    publishAuthUser({ ...asUser("u7"), name: "Ada" });
    expect(getAuthUserSync()?._id).toBe("u7");
  });

  it("notifies subscribers when the identity changes", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeAuthUser((user) => seen.push(user?._id ?? null));
    publishAuthUser(asUser("u1"));
    publishAuthUser(asUser("u2"));
    publishAuthUser(null);
    unsubscribe();
    expect(seen).toEqual(["u1", "u2", null]);
  });

  it("stops notifying after unsubscribe (sign-out re-scopes once, then quiet)", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeAuthUser((user) => seen.push(user?._id ?? null));
    publishAuthUser(asUser("u1"));
    unsubscribe();
    publishAuthUser(asUser("u2"));
    expect(seen).toEqual(["u1"]);
  });

  it("does not re-notify for the same member (no churn per render)", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeAuthUser((user) => seen.push(user?._id ?? null));
    publishAuthUser({ ...asUser("u1"), name: "Ada" });
    publishAuthUser({ ...asUser("u1"), name: "Ada Lovelace" });
    unsubscribe();
    expect(seen).toEqual(["u1"]);
  });

  it("a throwing subscriber never breaks the others", () => {
    const seen: (string | null)[] = [];
    const bad = subscribeAuthUser(() => {
      throw new Error("boom");
    });
    const good = subscribeAuthUser((user) => seen.push(user?._id ?? null));
    expect(() => publishAuthUser(asUser("u3"))).not.toThrow();
    bad();
    good();
    expect(seen).toEqual(["u3"]);
  });
});