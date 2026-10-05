"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireActionNonStudent } from "./authActions";
import { loadTurso } from "./tursoDb";

// Resolve a QR payload to a destination route.
// Supported payloads:
//   g:<group id>           — group card (unique per group, even same-named ones)
//   inv:<group name>       — legacy name-based group label (still resolves;
//                            a storage with that name wins — group "Closet 1"
//                            opens the storage, not the group)
//   unit:<PART-TAG>        — individual part
//   cat:<name>             — category view
//   closet:<id>            — closet view
//   proj:<id>              — project view
//   rental:<rentalId>      — printed rent card: opens the unit + that rental
//
// Converted to read TURSO (kept current by the live mirror). Id-based reads go
// through the bridge, which resolves a prefix-less Convex id via the `_idmap`
// the mirror maintains for every row it writes.
export const resolve = action({
  args: { payload: v.string() },
  handler: async (ctx, { payload }) => {
    await requireActionNonStudent(ctx);
    const { db, problem } = loadTurso();
    if (!db) throw new Error(problem ?? "Turso is not configured");

    const raw = payload.trim();
    const [scheme, value] = raw.split(":");

    const byTag = async () => {
      const part = (await db
        .query("parts")
        .withIndex("by_tag", (q) => q.eq("tag", raw.toUpperCase()))
        .first()) as any;
      if (part) return { type: "unit" as const, id: part._id, groupId: part.groupId, url: `/part/${part._id}` };
      return null;
    };

    if (scheme === "unit" || scheme === "part") {
      const part = (await db
        .query("parts")
        .withIndex("by_tag", (q) => q.eq("tag", value?.toUpperCase() ?? ""))
        .first()) as any;
      if (part) return { type: "unit" as const, id: part._id, groupId: part.groupId, url: `/part/${part._id}` };
      const alt = await byTag();
      if (alt) return alt;
      return null;
    }

    if (scheme === "cat") {
      const cats = (await db.query("categories").collect()) as any[];
      const cat = cats.find((c) => c.name.toLowerCase() === (value ?? "").toLowerCase() || c._id === value);
      if (cat) return { type: "category" as const, id: cat._id, url: `/inventory?category=${cat._id}` };
      return null;
    }

    if (scheme === "closet") {
      const closet = (await db.get(value as string)) as any;
      if (closet) return { type: "closet" as const, id: closet._id, url: `/closets/${closet._id}` };
      return null;
    }

    if (scheme === "proj") {
      const project = (await db.get(value as string)) as any;
      if (project) return { type: "project" as const, id: project._id, url: `/projects/${project._id}` };
      return null;
    }

    // Person QR labels: scanning opens the member's profile card. Guests are
    // not people (they are not stored), so they never resolve.
    if (scheme === "person") {
      const person = (await db.get(value as string)) as any;
      if (person && !person.isAnonymous && (person.name || person.email)) {
        return { type: "person" as const, id: person._id, url: `/person/${person._id}` };
      }
      return null;
    }

    if (scheme === "rental") {
      const rental = (await db
        .query("rentals")
        .filter((q) => q.eq(q.field("_id"), value))
        .first()) as any;
      if (!rental) return null;
      // Admins can open any rent card; members only their own.
      const me = await requireActionNonStudent(ctx);
      const isAdmin = me.role === "admin";
      if (!isAdmin && rental.userId !== me._id) return null;
      const part = (await db.get(rental.partId as string)) as any;
      if (!part) return null;
      return {
        type: "unit" as const,
        id: part._id,
        url: `/part/${part._id}?rental=${rental._id}`,
      };
    }

    // Unique per-group payload: `g:<id>`.
    if (scheme === "g") {
      const group = (await db.get(value as string)) as any;
      if (group && !group.deleted) {
        return { type: "group" as const, id: group._id, url: `/group/${group._id}` };
      }
      return null;
    }

    if (scheme === "inv") {
      // A group named exactly like a storage is a storage alias: its printed
      // QR must open the STORAGE, not the group (that group cannot be lent).
      const closetByName = (await db
        .query("closets")
        .withIndex("by_name", (q) => q.eq("name", value ?? ""))
        .first()) as any;
      if (closetByName) {
        return {
          type: "closet" as const,
          id: closetByName._id,
          url: `/closets/${closetByName._id}`,
        };
      }
      const groups = (await db
        .query("groups")
        .filter((q) => q.eq(q.field("name"), value ?? ""))
        .collect()) as any[];
      if (groups.length > 0) {
        return { type: "group" as const, id: groups[0]._id, url: `/group/${groups[0]._id}` };
      }
    }

    // fallback: treat raw as a part tag, then group name
    // (a bare Convex id can also be a person QR scanned without its prefix)
    const personById =
      value && /^[0-9a-f]{32}$/i.test(value) ? ((await db.get(value)) as any) : null;
    if (personById && !personById.isAnonymous) {
      return { type: "person" as const, id: personById._id, url: `/person/${personById._id}` };
    }
    const alt = await byTag();
    if (alt) return alt;
    // Bare-name fallbacks: a storage name always beats a same-named group
    // (group "Closet 1" must never shadow the storage's QR when someone
    // types or scans the bare name).
    const closetsFirst = (await db.query("closets").collect()) as any[];
    const closetAlias = closetsFirst.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (closetAlias) return { type: "closet" as const, id: closetAlias._id, url: `/closets/${closetAlias._id}` };
    const groups = (await db
      .query("groups")
      .filter((q) => q.eq(q.field("name"), raw))
      .collect()) as any[];
    if (groups.length > 0) return { type: "group" as const, id: groups[0]._id, url: `/group/${groups[0]._id}` };
    const closets = (await db.query("closets").collect()) as any[];
    const closet = closets.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (closet) return { type: "closet" as const, id: closet._id, url: `/closets/${closet._id}` };
    const cats = (await db.query("categories").collect()) as any[];
    const cat = cats.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (cat) return { type: "category" as const, id: cat._id, url: `/inventory?category=${cat._id}` };
    const projects = (await db.query("projects").collect()) as any[];
    const project = projects.find((p) => p.name.toLowerCase() === raw.toLowerCase());
    if (project) return { type: "project" as const, id: project._id, url: `/projects/${project._id}` };
    return null;
  },
});
