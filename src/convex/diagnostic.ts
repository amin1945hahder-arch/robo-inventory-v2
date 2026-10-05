// ⚠️ TEMPORARY DIAGNOSTIC — DELETE AFTER USE ⚠️
//
// Reads the TURSO replica (where the app data lives now), not Convex: after
// the data cutover this is the only copy a probe is meaningful against.
import { v } from "convex/values";
import { action } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { loadTurso } from "./tursoDb";
import type { BridgeDb } from "../lib/turso-bridge";

function docCache() {
  const cache = new Map<string, Promise<any>>();
  return {
    async get(db: BridgeDb, id: string | undefined): Promise<any> {
      if (!id) return null;
      const existing = cache.get(id);
      if (existing) return existing;
      const promise: Promise<any> = db.get(id);
      cache.set(id, promise);
      return promise;
    },
  };
}

export const probe = action({
  args: { which: v.string() },
  handler: async (_ctx, { which }) => {
    try {
      const { db, problem } = loadTurso();
      if (!db) throw new Error(problem ?? "Turso is not configured");

      if (which === "allPartsDetail") {
        // Full getPartWithRental body across EVERY part — catches malformed
        // references (missing groupId/categoryId/closetId) on any unit.
        const parts = await db.query<Doc<"parts">>("parts").collect();
        const cache = docCache();
        const failures: any[] = [];
        let checked = 0;
        for (const partRaw of parts) {
          const part = partRaw as any;
          try {
            if (!part.groupId) throw new Error("part has no groupId");
            const group = await cache.get(db, part.groupId);
            if (!group) throw new Error(`group ${part.groupId} missing`);
            if (!group.categoryId) throw new Error("group has no categoryId");
            if (!group.closetId) throw new Error("group has no closetId");
            await cache.get(db, group.categoryId);
            await cache.get(db, group.closetId);
            const rentals = await db
              .query<Doc<"rentals">>("rentals")
              .withIndex("by_part", (q) => q.eq("partId", part._id))
              .collect();
            for (const r of rentals) {
              if (typeof (r as any).requestedAt !== "number") throw new Error("rental missing requestedAt");
              await cache.get(db, (r as any).userId);
              if ((r as any).projectId) await cache.get(db, (r as any).projectId);
            }
            checked += 1;
          } catch (e) {
            failures.push({ tag: part.tag, id: String(part._id), error: e instanceof Error ? e.message : String(e) });
            if (failures.length >= 10) break;
          }
        }
        return { ok: true, total: parts.length, checked, failures };
      }

      if (which === "settingsRows") {
        // Duplicate setting keys break .unique() callers (useSound etc.)
        const rows = await db.query<Doc<"settings">>("settings").collect();
        const counts: Record<string, number> = {};
        for (const r of rows as any[]) {
          const k = String(r.key);
          counts[k] = (counts[k] ?? 0) + 1;
        }
        const dupes = Object.entries(counts).filter(([, n]) => n > 1);
        return { ok: true, total: rows.length, dupes, keys: Object.keys(counts).slice(0, 30) };
      }

      if (which === "listAllRentalsExact") {
        // Exact production body incl. projection (admin path on PartDetail).
        const rows = await db.query<Doc<"rentals">>("rentals").collect();
        const cache = docCache();
        const out = [];
        for (const r of (rows as any[]).sort((a, b) => b.requestedAt - a.requestedAt)) {
          const part = await cache.get(db, r.partId);
          const group = part ? await cache.get(db, part.groupId) : null;
          const student = await cache.get(db, r.userId);
          out.push({
            rental: r,
            part,
            group,
            student: student
              ? { _id: student._id, name: student.name, email: student.email, studentId: student.studentId, image: typeof student.image === "string" && student.image.length <= 60_000 ? student.image : undefined }
              : null,
          });
        }
        return { ok: true, rows: out.length, bytes: JSON.stringify(out).length };
      }

      return { ok: false, error: `unknown mode: ${which}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  },
});