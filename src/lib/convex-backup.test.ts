import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  CONVEX_BACKUP_TABLES,
  buildConvexBackupZip,
  convexBackupCounts,
  convexBackupFileName,
} from "./convex-backup";

describe("convexBackupFileName", () => {
  it("uses the requested timestamp, zero-padded", () => {
    // 2026-02-03 04:05 local
    const t = new Date(2026, 1, 3, 4, 5).getTime();
    expect(convexBackupFileName(t)).toBe("rc-convex-2026-02-03_04-05.zip");
  });
});

describe("convexBackupCounts", () => {
  it("joins non-empty tables only", () => {
    expect(
      convexBackupCounts({ users: [{ _id: "u1" }], parts: [], rentals: [{ _id: "r1" }] }),
    ).toBe("users: 1, rentals: 1");
  });
});

describe("buildConvexBackupZip", () => {
  const tables = {
    users: [
      { _id: "u1", _creationTime: 111, name: "Adm", soundSettings: null },
      { _id: "u2", _creationTime: 222, name: "Mem" },
    ],
    parts: [{ _id: "p1", _creationTime: 333, tag: "A-01", holderId: "u2" }],
    rentals: [],
  };

  it("produces one <table>.json per table with a top-level array, ids kept, _creationTime stripped", async () => {
    const b64 = await buildConvexBackupZip(tables, 1234567890);
    const zip = await JSZip.loadAsync(b64, { base64: true });
    const users = JSON.parse(await zip.file("users.json")!.async("string"));
    expect(Array.isArray(users)).toBe(true);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ _id: "u1", name: "Adm", soundSettings: null });
    expect(users[0]._creationTime).toBeUndefined();
    expect(users[0]._id).toBe("u1");
  });

  it("omits empty tables but keeps the meta file", async () => {
    const b64 = await buildConvexBackupZip(tables, 1234567890);
    const zip = await JSZip.loadAsync(b64, { base64: true });
    expect(zip.file("rentals.json")).toBeNull();
    const meta = JSON.parse(await zip.file("_convex_backup_meta.json")!.async("string"));
    expect(meta.kind).toBe("convex-import");
    expect(meta.tables).toEqual(["parts", "rentals", "users"]);
    expect(meta.note).toContain("convex import");
  });

  it("keeps referenced ids verbatim so internal references resolve on import", async () => {
    const b64 = await buildConvexBackupZip(tables, 1234567890);
    const zip = await JSZip.loadAsync(b64, { base64: true });
    const parts = JSON.parse(await zip.file("parts.json")!.async("string"));
    expect(parts[0].holderId).toBe("u2");
  });

  it("covers the tables the app exports", () => {
    expect(CONVEX_BACKUP_TABLES).toContain("users");
    expect(CONVEX_BACKUP_TABLES).toContain("rentals");
    expect(CONVEX_BACKUP_TABLES).toContain("pushSubscriptions");
  });
});
