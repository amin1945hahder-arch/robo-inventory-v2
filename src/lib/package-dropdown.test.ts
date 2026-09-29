import { describe, expect, it } from "vitest";
import {
  brandModelLine,
  buildPackageDropdown,
  containerPathOf,
  isContainerRow,
  type DropdownGroup,
} from "./package-dropdown";

const groups: DropdownGroup[] = [
  { _id: "g1", name: "Uno", categoryId: "c1", parentGroupId: "boxB", brand: "Arduino", model: "R3", quantityTotal: 5 },
  { _id: "g2", name: "Mega", categoryId: "c1", brand: "Arduino", quantityTotal: 2 },
  { _id: "g3", name: "Servo", categoryId: "c2", parentGroupId: "boxA", quantityTotal: 9 },
  { _id: "g4", name: "Crimper", categoryId: "c2", quantityTotal: 1 },
  // Containers: must never appear as selectable rows.
  { _id: "boxA", name: "Box A", categoryId: "c2", quantityTotal: 0 },
  { _id: "boxB", name: "Shelf 1", categoryId: "c1", quantityTotal: 0, measure: null },
  // A container that itself sits in another container.
  { _id: "g5", name: "Jumper wires", categoryId: "c1", parentGroupId: "boxA", quantityTotal: 4 },
];

const byId = new Map(groups.map((g) => [g._id, g]));
const categories = [
  { _id: "c2", name: "Tools" },
  { _id: "c1", name: "Boards" },
];

describe("containerPathOf", () => {
  it("joins outermost-first", () => {
    expect(containerPathOf(byId.get("g1"), byId)).toBe("Shelf 1");
    expect(containerPathOf({ parentGroupId: "g5" }, byId)).toBe("Box A › Jumper wires");
  });
  it("returns '' for loose groups", () => {
    expect(containerPathOf(byId.get("g2"), byId)).toBe("");
    expect(containerPathOf(null, byId)).toBe("");
  });
});

describe("isContainerRow", () => {
  it("flags quantityTotal===0 without measure as a container", () => {
    expect(isContainerRow({ quantityTotal: 0 })).toBe(true);
    expect(isContainerRow({ quantityTotal: 0, measure: "weight" })).toBe(false);
    expect(isContainerRow({ quantityTotal: 5 })).toBe(false);
    expect(isContainerRow(null)).toBe(false);
  });
});

describe("brandModelLine", () => {
  it("joins brand and model in one line", () => {
    expect(brandModelLine({ brand: "Arduino", model: "R3" })).toBe("Arduino R3");
    expect(brandModelLine({ brand: "Arduino" })).toBe("Arduino");
    expect(brandModelLine({})).toBe("");
  });
});

describe("buildPackageDropdown", () => {
  const sections = buildPackageDropdown(groups, categories);

  it("excludes containers from every section", () => {
    const ids = sections.flatMap((s) => s.items.map((i) => i._id));
    expect(ids).not.toContain("boxA");
    expect(ids).not.toContain("boxB");
  });

  it("creates one section per category, sorted by category name", () => {
    expect(sections.map((s) => s.categoryName)).toEqual(["Boards", "Tools"]);
  });

  it("sorts items by container path, then name", () => {
    const boards = sections[0].items.map((i) => i._id);
    // "Box A › …" paths sort before loose groups; g1 (Shelf 1) before g5 (Box A)? No —
    // "Box A" < "Shelf 1", so g5 (Box A) comes before g1 (Shelf 1), loose last.
    expect(boards).toEqual(["g5", "g1", "g2"]);
    expect(sections[1].items.map((i) => i._id)).toEqual(["g3", "g4"]);
  });

  it("attaches the resolved container path to each row", () => {
    const g3 = sections[1].items.find((i) => i._id === "g3")!;
    expect(g3.containerPath).toBe("Box A");
  });

  it("falls back to 'Other' when a group has no category", () => {
    const orphan = buildPackageDropdown(
      [{ _id: "x", name: "Mystery", quantityTotal: 1 }],
      categories,
    );
    expect(orphan).toHaveLength(1);
    expect(orphan[0].categoryName).toBe("Other");
  });
});
