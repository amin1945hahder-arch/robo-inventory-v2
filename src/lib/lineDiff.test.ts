import { describe, expect, it } from "vitest";
import {
  defaultDecisions,
  diffLines,
  diffStat,
  mergeLines,
  type RowDecision,
} from "./lineDiff";

describe("diffLines", () => {
  it("returns only same rows for identical text", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.type === "same")).toBe(true);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("returns no rows for two empty texts", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("marks appended lines as add rows", () => {
    const rows = diffLines("a", "a\nb\nc");
    expect(rows.map((r) => r.type)).toEqual(["same", "add", "add"]);
    expect(rows[1].newLine).toBe("b");
    expect(rows[2].newLine).toBe("c");
    expect(rows[1].baseLine).toBeUndefined();
  });

  it("marks removed lines as del rows", () => {
    const rows = diffLines("a\nb\nc", "a\nc");
    expect(rows.map((r) => r.type)).toEqual(["same", "del", "same"]);
    expect(rows[1].baseLine).toBe("b");
    expect(rows[1].newLine).toBeUndefined();
  });

  it("collapses a modified line into a single replace row", () => {
    const rows = diffLines("title\nbody", "title\nnew body");
    expect(rows.map((r) => r.type)).toEqual(["same", "replace"]);
    expect(rows[1].baseLine).toBe("body");
    expect(rows[1].newLine).toBe("new body");
  });

  it("handles a full rewrite", () => {
    const rows = diffLines("old one\nold two", "brand new\nline two\nline three");
    const types = rows.map((r) => r.type);
    expect(types).toContain("replace");
    expect(types).toContain("add");
    expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i));
  });

  it("keeps empty lines diffable", () => {
    const rows = diffLines("a\n\nb", "a\nx\nb");
    expect(rows.map((r) => r.type)).toEqual(["same", "replace", "same"]);
    expect(rows[1].baseLine).toBe("");
    expect(rows[1].newLine).toBe("x");
  });

  it("normalizes CRLF input", () => {
    const rows = diffLines("a\r\nb", "a\r\nb");
    expect(rows).toHaveLength(2);
    expect(rows[0].baseLine).toBe("a");
  });
});

describe("mergeLines", () => {
  const base = "# Doc\nintro\nbody\noutro";
  const proposed = "# Doc\nintro\nEDITED\nbody\nextra\noutro";

  it("applies everything by default (all rows approved)", () => {
    const rows = diffLines(base, proposed);
    const res = mergeLines(base, rows, defaultDecisions(rows));
    expect(res.text).toBe(proposed);
    expect(res.rejected).toHaveLength(0);
    expect(res.applied).toBeGreaterThan(0);
  });

  it("keeps the base line when a replace row is rejected", () => {
    const rows = diffLines("a\nb", "a\nB");
    const decisions: Record<number, RowDecision> = { 1: { approve: false } };
    const res = mergeLines("a\nb", rows, decisions);
    expect(res.text).toBe("a\nb");
    expect(res.rejected).toHaveLength(1);
  });

  it("skips an add row that is rejected", () => {
    const rows = diffLines("a", "a\nnew");
    const res = mergeLines("a", rows, { 1: { approve: false, note: "not needed" } });
    expect(res.text).toBe("a");
    expect(res.rejected[0].note).toBe("not needed");
  });

  it("restores the base line when a del row is rejected", () => {
    const rows = diffLines("a\nb", "a");
    const res = mergeLines("a\nb", rows, { 1: { approve: false, note: "keep it" } });
    expect(res.text).toBe("a\nb");
    expect(res.rejected[0].note).toBe("keep it");
  });

  it("drops the base line when a del row is approved", () => {
    const rows = diffLines("a\nb", "a");
    const res = mergeLines("a\nb", rows, defaultDecisions(rows));
    expect(res.text).toBe("a");
  });

  it("uses reviewer replacement text when provided", () => {
    const rows = diffLines("a\nb", "a\nB");
    const res = mergeLines("a\nb", rows, { 1: { approve: true, replacement: "edited by lead" } });
    expect(res.text).toBe("a\nedited by lead");
    expect(res.applied).toBe(1);
  });

  it("supports a partial approval: some rows applied, some rejected", () => {
    const rows = diffLines("a\nb\nc", "a\nB\nC");
    expect(rows.map((r) => r.type)).toEqual(["same", "replace", "replace"]);
    const res = mergeLines("a\nb\nc", rows, {
      1: { approve: true },
      2: { approve: false, note: "wording is wrong" },
    });
    expect(res.text).toBe("a\nB\nc");
    expect(res.applied).toBe(1);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].note).toBe("wording is wrong");
  });

  it("keeps newlines out of a single-line row replacement", () => {
    const rows = diffLines("a", "a\nb");
    const res = mergeLines("a", rows, { 1: { approve: true, replacement: "multi\nline" } });
    expect(res.text).toBe("a\nmulti line");
  });
});

describe("diffStat", () => {
  it("counts added, removed and changed rows", () => {
    expect(diffStat(diffLines("a\nb", "a\nB"))).toEqual({
      added: 0,
      removed: 0,
      changed: 1,
    });
    expect(diffStat(diffLines("a", "a\nx\ny"))).toEqual({
      added: 2,
      removed: 0,
      changed: 0,
    });
  });

  it("counts a pure deletion", () => {
    const rows = diffLines("a\nb\nc", "a\nc");
    const stat = diffStat(rows);
    expect(stat.removed).toBe(1);
    expect(stat.added).toBe(0);
    expect(stat.changed).toBe(0);
  });
});

describe("defaultDecisions", () => {
  it("only keys non-same rows and approves them", () => {
    const rows = diffLines("a\nb", "a\nB\nc");
    const decisions = defaultDecisions(rows);
    for (const row of rows) {
      if (row.type === "same") expect(decisions[row.index]).toBeUndefined();
      else expect(decisions[row.index]).toEqual({ approve: true });
    }
  });
});
