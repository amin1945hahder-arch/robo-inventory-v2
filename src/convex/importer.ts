import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireAdmin } from "./lib";

// ===== CSV import =====
// Accepts a CSV string with columns:
//   group, category, closet, quantity, brand, model, description
// Creates missing categories/closets/groups and physical parts with tags.

export const importCsv = mutation({
  args: { csv: v.string() },
  handler: async (ctx, { csv }) => {
    await requireAdmin(ctx);

    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) throw new Error("The file is empty");

    // detect header
    const first = lines[0].toLowerCase();
    const hasHeader = first.includes("group") || first.includes("part") || first.includes("category");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const parseLine = (line: string) => {
      const cells: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if ((ch === "," || ch === ";") && !inQuotes) {
          cells.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    };

    const catCache = new Map<string, any>();
    const closetCache = new Map<string, any>();
    const groupCache = new Map<string, any>();
    let groupsCreated = 0;
    let partsCreated = 0;

    const getOrCreateCategory = async (name: string) => {
      const key = name.toLowerCase();
      if (catCache.has(key)) return catCache.get(key);
      const all = await ctx.db.query("categories").collect();
      const found = all.find((c) => c.name.toLowerCase() === key);
      if (found) {
        catCache.set(key, found._id);
        return found._id;
      }
      const id = await ctx.db.insert("categories", { name });
      catCache.set(key, id);
      return id;
    };

    const getOrCreateCloset = async (name: string) => {
      const key = name.toLowerCase();
      if (closetCache.has(key)) return closetCache.get(key);
      const all = await ctx.db.query("closets").collect();
      const found = all.find((c) => c.name.toLowerCase() === key);
      if (found) {
        closetCache.set(key, found._id);
        return found._id;
      }
      const id = await ctx.db.insert("closets", { name });
      closetCache.set(key, id);
      return id;
    };

    for (const line of dataLines) {
      const cells = parseLine(line);
      const [group, category, closet, qtyStr, brand, model, description] = cells;
      if (!group) continue;
      const qty = Math.max(1, Math.min(parseInt(qtyStr || "1", 10) || 1, 200));
      const catId = await getOrCreateCategory(category || "Uncategorized");
      const closetId = await getOrCreateCloset(closet || "Main Closet");

      const gkey = group.toLowerCase();
      let groupId = groupCache.get(gkey);
      if (!groupId) {
        const existing = await ctx.db
          .query("groups")
          .filter((q) => q.eq(q.field("name"), group))
          .filter((q) => q.neq(q.field("deleted"), true))
          .first();
        if (existing) {
          groupId = existing._id;
        } else {
          groupId = await ctx.db.insert("groups", {
            name: group,
            categoryId: catId,
            closetId,
            brand: brand || undefined,
            model: model || undefined,
            description: description || undefined,
            quantityTotal: 0,
          });
          groupsCreated += 1;
        }
        groupCache.set(gkey, groupId);
      }

      // add parts
      const groupRow = await ctx.db.get(groupId);
      const existingParts = await ctx.db
        .query("parts")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      const prefix = group
        .replace(/[^A-Za-z0-9 ]/g, "")
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 3)
        .padEnd(3, "X");
      let num = existingParts.length + 1;
      for (let i = 0; i < qty; i++) {
        let tag = `${prefix}-${String(num).padStart(3, "0")}`;
        while (await ctx.db.query("parts").withIndex("by_tag", (q) => q.eq("tag", tag)).first()) {
          num += 1;
          tag = `${prefix}-${String(num).padStart(3, "0")}`;
        }
        await ctx.db.insert("parts", { groupId, tag, status: "available" });
        partsCreated += 1;
        num += 1;
      }
      if (groupRow) {
        await ctx.db.patch(groupId, {
          quantityTotal: existingParts.length + qty,
          brand: (groupRow as any).brand ?? brand ?? undefined,
          model: (groupRow as any).model ?? model ?? undefined,
          description: (groupRow as any).description ?? description ?? undefined,
        });
      }
    }

    return { groupsCreated, partsCreated };
  },
});
