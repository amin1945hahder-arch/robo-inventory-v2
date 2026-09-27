import { describe, expect, it } from "vitest";
import {
  containerNamesOf,
  groupsInStorage,
  isContainerLite,
  type GroupLite,
} from "./containment";

let seq = 0;
function g(partial: Partial<GroupLite> & { name: string }): GroupLite {
  seq += 1;
  return {
    _id: `g${seq}`,
    parentGroupId: undefined,
    closetId: undefined,
    measure: undefined,
    quantityTotal: undefined,
    ...partial,
  } as GroupLite;
}

/** Classic club setup: containers live in storage B; children point at A. */
function sample() {
  const storageA = "closetA";
  const storageB = "closetB";
  const box = g({ name: "Big box", closetId: storageB, quantityTotal: 0 }); // container
  const inner = g({ name: "Drawer", closetId: storageB, quantityTotal: 0, parentGroupId: box._id });
  const reel = g({ name: "Reel 3m", closetId: storageA, parentGroupId: inner._id });
  const loose = g({ name: "Loose parts", closetId: storageA });
  const otherStorageGroup = g({ name: "Elsewhere", closetId: storageB });
  return { storageA, storageB, box, inner, reel, loose, otherStorageGroup };
}

describe("groupsInStorage", () => {
  it("includes direct members and anything contained via containers of the storage", () => {
    const s = sample();
    const all = [s.box, s.inner, s.reel, s.loose, s.otherStorageGroup];
    const inA = groupsInStorage(s.storageA, all).map((x) => x._id);
    expect(inA).toContain(s.loose._id); // direct
    expect(inA).toContain(s.reel._id); // sits in containers of storage B!
    expect(inA).not.toContain(s.otherStorageGroup._id);
    expect(inA).not.toContain(s.box._id); // container with children is hidden
    expect(inA).not.toContain(s.inner._id);
  });

  it("shows the childless container itself and the groups it holds", () => {
    const s = sample();
    const emptyBox = g({ name: "Empty box", closetId: s.storageA, quantityTotal: 0 });
    const inA = groupsInStorage(s.storageA, [...[s.box, s.inner, s.reel, s.loose], emptyBox]);
    expect(inA.map((x) => x._id)).toContain(emptyBox._id);
  });

  it("a storage listing includes both direct and chained groups together", () => {
    const s = sample();
    const inB = groupsInStorage(s.storageB, [s.box, s.inner, s.reel, s.loose, s.otherStorageGroup]);
    const ids = inB.map((x) => x._id);
    expect(ids).toContain(s.otherStorageGroup._id); // direct member of B
    // reel's own closetId is A, but its containers live in B — visible from B too.
    expect(ids).toContain(s.reel._id);
  });

  it("does not lose deep-nested groups beyond two levels", () => {
    const s = sample();
    const deep = g({ name: "Tiny bag", closetId: s.storageA, parentGroupId: s.inner._id });
    const inA = groupsInStorage(s.storageA, [s.box, s.inner, s.reel, s.loose, deep]);
    expect(inA.map((x) => x._id)).toContain(deep._id);
  });

  it("groups without any storage reference are in no storage", () => {
    const orphan = g({ name: "Nowhere" });
    expect(groupsInStorage("closetA", [orphan])).toHaveLength(0);
  });
});

describe("containerNamesOf", () => {
  it("spells the container path outermost-first", () => {
    const s = sample();
    expect(containerNamesOf(s.reel, [s.box, s.inner, s.reel])).toEqual([
      "Big box",
      "Drawer",
    ]);
  });

  it("is empty for top-level groups", () => {
    const s = sample();
    expect(containerNamesOf(s.loose, [s.loose])).toEqual([]);
  });
});

describe("isContainerLite", () => {
  it("detects containers (no measure, zero quantity)", () => {
    expect(isContainerLite({ _id: "x", name: "Box", quantityTotal: 0 })).toBe(true);
    expect(isContainerLite({ _id: "x", name: "Reel", quantityTotal: 5 })).toBe(false);
    expect(
      isContainerLite({ _id: "x", name: "Spool", quantityTotal: 0, measure: "weight" }),
    ).toBe(false);
    expect(isContainerLite(null)).toBe(false);
  });
});