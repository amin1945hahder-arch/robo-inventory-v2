import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { brandModelLine, type DropdownSection } from "@/lib/package-dropdown";
import { describePackSize, isPackGroup } from "@/lib/group-measure";

type Row = DropdownSection["items"][number] & { available?: number };

/**
 * Shared content of the package item dropdown (member builder + admin editor).
 *
 * - A search box pinned to the top of the OPEN dropdown (replaces the old
 *   separate text input next to "Add item") filters every section live and
 *   is focused automatically when the dropdown opens.
 * - Sections are one per CATEGORY, headed by a fixed, NON-selectable label
 *   (SelectLabel) — sorted by category name.
 * - Items sort container path → group name → brand → model; containers
 *   themselves are never listed (they can't be lent).
 * - Each row: "Container › Sub   Group name   Brand Model" with the free
 *   count on the right.
 */
export function PackageItemSelectContent({
  sections,
  availability,
  value,
}: {
  sections: DropdownSection[];
  availability: Record<string, { available: number }> | undefined;
  /** Current selection (excluded from filtering so a picked item stays visible). */
  value?: string;
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((g) => {
          if (g._id === value) return true; // keep the active selection visible
          const hay = [
            g.containerPath,
            g.name,
            g.brand,
            g.model,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, q, value]);

  return (
    <div>
      {/* Search lives INSIDE the dropdown — one control, always at hand.
          Key events stop here so Radix's typeahead doesn't hijack typing. */}
      <div
        className="relative px-2 pt-2 pb-1"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-[calc(50%-8px)] text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items…"
          className="h-8 pl-8"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No items match “{query}”.
        </p>
      ) : (
        filtered.map((s) => (
          <SelectGroup key={s.categoryId || "other"}>
            {/* Fixed, non-selectable section header — the category. */}
            <SelectLabel className="border-b text-[11px] font-semibold uppercase tracking-wider">
              {s.categoryName}
            </SelectLabel>
            {s.items.map((g) => {
              const a = availability?.[g._id]?.available;
              const bm = brandModelLine(g);
              return (
                <SelectItem key={g._id} value={g._id} className="py-1.5">
                  <span className="flex w-full min-w-0 flex-col gap-0.5">
                    {/* Line 1: container (dim) + group name (strong). */}
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      {g.containerPath && (
                        <span className="max-w-[45%] truncate text-[11px] text-muted-foreground">
                          {g.containerPath}
                        </span>
                      )}
                      <span className="truncate font-medium">
                        {g.name}
                        {isPackGroup(g as any) ? ` (${describePackSize(g as any)})` : ""}
                      </span>
                    </span>
                    {/* Line 2: brand + model in one line, plus the free count. */}
                    <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{bm || "\u00A0"}</span>
                      <span className="shrink-0 tabular-nums">
                        {a === undefined ? "…" : `${a} free`}
                      </span>
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))
      )}
    </div>
  );
}
