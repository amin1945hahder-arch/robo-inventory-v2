import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireNonStudent } from "./lib";

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
//   package:<packageId>    — package card: opens the bundle at its exact
//                            current status (Packages / Pick-up tab)
export const resolve = query({
  args: { payload: v.string() },
  handler: async (ctx, { payload }) => {
    await requireNonStudent(ctx);
    const raw = payload.trim();
    const [scheme, value] = raw.split(":");

    const byTag = async () => {
      const part = await ctx.db
        .query("parts")
        .withIndex("by_tag", (q) => q.eq("tag", raw.toUpperCase()))
        .first();
      if (part) return { type: "unit" as const, id: part._id, groupId: part.groupId, url: `/part/${part._id}` };
      return null;
    };

    if (scheme === "unit" || scheme === "part") {
      const part = await ctx.db
        .query("parts")
        .withIndex("by_tag", (q) => q.eq("tag", value?.toUpperCase() ?? ""))
        .first();
      if (part) return { type: "unit" as const, id: part._id, groupId: part.groupId, url: `/part/${part._id}` };
      const alt = await byTag();
      if (alt) return alt;
      return null;
    }

    if (scheme === "cat") {
      const cats = await ctx.db.query("categories").collect();
      const cat = cats.find((c) => c.name.toLowerCase() === (value ?? "").toLowerCase() || c._id === value);
      if (cat) return { type: "category" as const, id: cat._id, url: `/inventory?category=${cat._id}` };
      return null;
    }

    if (scheme === "closet") {
      const closet = await ctx.db.get(value as any);
      if (closet) return { type: "closet" as const, id: closet._id, url: `/closets/${closet._id}` };
      return null;
    }

    if (scheme === "proj") {
      const project = await ctx.db.get(value as any);
      if (project) return { type: "project" as const, id: project._id, url: `/projects/${project._id}` };
      return null;
    }

    // Person QR labels: scanning opens the member's profile card. Guests are
    // not people (they are not stored), so they never resolve.
    if (scheme === "person") {
      const person = (await ctx.db.get(value as any)) as any;
      if (person && !person.isAnonymous && (person.name || person.email)) {
        return { type: "person" as const, id: person._id, url: `/person/${person._id}` };
      }
      return null;
    }

    if (scheme === "rental") {
      const rental = (await ctx.db
        .query("rentals")
        .filter((q) => q.eq(q.field("_id"), value))
        .first()) as any;
      if (!rental) return null;
      // Admins can open any rent card; members only their own.
      const me = await requireNonStudent(ctx);
      const isAdmin = me.role === "admin";
      if (!isAdmin && rental.userId !== me._id) return null;
      const part = await ctx.db.get(rental.partId);
      // Land on the tab that actually holds this record AT ITS CURRENT STATUS:
      // pending → Pending, approved → Pick-up, active → Active, on-project →
      // Projects, closed → History. Members land on their own rentals page
      // (Active for live records, History for closed ones).
      const status = String(rental.status ?? "pending");
      const adminTab =
        status === "pending"
          ? "pending"
          : status === "approved"
            ? "pickup"
            : status === "on_project"
              ? "projects"
              : status === "active"
                ? "active"
                : "history";
      const closed = status === "returned" || status === "denied" || status === "canceled";
      return {
        type: "unit" as const,
        id: part?._id ?? rental.partId,
        status,
        url: isAdmin
          ? `/admin/requests?tab=${adminTab}&rental=${rental._id}`
          : `/rentals?tab=${closed ? "history" : "active"}&rental=${rental._id}`,
      };
    }

    // Package card QR: `package:<id>` — opens the bundle at its EXACT current
    // status: pending/active/returned in the Packages tab, approved (awaiting
    // pick-up) in the Pick-up tab. Admins land in the console; a member lands
    // on their own package on the My rentals page.
    if (scheme === "package") {
      const pkg = (await ctx.db.get(value as any)) as any;
      if (!pkg) return null;
      const me = await requireNonStudent(ctx);
      const isAdmin = me.role === "admin";
      if (!isAdmin && pkg.userId !== me._id) return null;
      const lines = await ctx.db
        .query("rentals")
        .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
        .collect();
      const activeUnits = lines.filter(
        (r: any) => r.status === "active" || r.status === "on_project",
      ).length;
      const approvedUnits = lines.filter((r: any) => r.status === "approved").length;
      const status =
        pkg.status === "pending"
          ? "pending"
          : activeUnits > 0
            ? "active"
            : approvedUnits > 0
              ? "approved"
              : "returned";
      // Approved bundles live in the Pick-up tab; everything else in Packages.
      const tab = status === "approved" ? "pickup" : "packages";
      return {
        type: "package" as const,
        id: pkg._id,
        status,
        url: isAdmin
          ? `/admin/requests?tab=${tab}&package=${pkg._id}`
          : `/rentals?tab=packages&package=${pkg._id}`,
      };
    }

    // Unique per-group payload: `g:<id>`.
    if (scheme === "g") {
      const group = (await ctx.db.get(value as any)) as any;
      if (group && !group.deleted) {
        return { type: "group" as const, id: group._id, url: `/group/${group._id}` };
      }
      return null;
    }

    if (scheme === "inv") {
      // A group named exactly like a storage is a storage alias: its printed
      // QR must open the STORAGE, not the group (that group cannot be lent).
      const closetByName = await ctx.db
        .query("closets")
        .withIndex("by_name", (q) => q.eq("name", value ?? ""))
        .first();
      if (closetByName) {
        return {
          type: "closet" as const,
          id: closetByName._id,
          url: `/closets/${closetByName._id}`,
        };
      }
      const groups = await ctx.db
        .query("groups")
        .filter((q) => q.eq(q.field("name"), value ?? ""))
        .collect();
      if (groups.length > 0) {
        return { type: "group" as const, id: groups[0]._id, url: `/group/${groups[0]._id}` };
      }
    }

    // fallback: treat raw as a part tag, then group name
    // (a bare Convex id can also be a person QR scanned without its prefix)
    const personById =
      value && /^[0-9a-f]{32}$/i.test(value) ? ((await ctx.db.get(value as any)) as any) : null;
    if (personById && !personById.isAnonymous) {
      return { type: "person" as const, id: personById._id, url: `/person/${personById._id}` };
    }
    const alt = await byTag();
    if (alt) return alt;
    // Bare-name fallbacks: a storage name always beats a same-named group
    // (group "Closet 1" must never shadow the storage's QR when someone
    // types or scans the bare name).
    const closetsFirst = await ctx.db.query("closets").collect();
    const closetAlias = closetsFirst.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (closetAlias) return { type: "closet" as const, id: closetAlias._id, url: `/closets/${closetAlias._id}` };
    const groups = await ctx.db
      .query("groups")
      .filter((q) => q.eq(q.field("name"), raw))
      .collect();
    if (groups.length > 0) return { type: "group" as const, id: groups[0]._id, url: `/group/${groups[0]._id}` };
    const closets = await ctx.db.query("closets").collect();
    const closet = closets.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (closet) return { type: "closet" as const, id: closet._id, url: `/closets/${closet._id}` };
    const cats = await ctx.db.query("categories").collect();
    const cat = cats.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    if (cat) return { type: "category" as const, id: cat._id, url: `/inventory?category=${cat._id}` };
    const projects = await ctx.db.query("projects").collect();
    const project = projects.find((p) => p.name.toLowerCase() === raw.toLowerCase());
    if (project) return { type: "project" as const, id: project._id, url: `/projects/${project._id}` };
    return null;
  },
});
