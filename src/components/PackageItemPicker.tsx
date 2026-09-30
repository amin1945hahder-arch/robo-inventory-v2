import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { brandModelLine, type DropdownSection } from "@/lib/package-dropdown";
import { describePackSize, isPackGroup } from "@/lib/group-measure";
import { cn } from "@/lib/utils";

type Row = DropdownSection["items"][number] & { available?: number; closetName?: string };

/**
 * Package item picker — a custom popover, not Radix Select, because:
 *  - the search input must KEEP focus while typing (Radix Select closes the
 *    popover on outside interaction — the on-screen keyboard steals it);
 *  - the list must NOT shift while typing (Select re-anchors on content
 *    resize); the popover here is anchored to the trigger only;
 *  - already-selected items must disappear from the list entirely (even when
 *    searched).
 *
 * Rows: "Storage · Container › Sub   Group name (pack)" then
 * "Brand Model" + free count. Sections headed by a fixed category label.
 */
export function PackageItemPicker({
  sections,
  availability,
  closetNames,
  selectedIds,
  onPick,
  onClear,
  value,
}: {
  sections: DropdownSection[];
  availability: Record<string, { available: number }> | undefined;
  /** groupId → closet (storage) display name. */
  closetNames: Map<string, string>;
  /** Every group already used by another line — hidden from the list. */
  selectedIds: Set<string>;
  onPick: (groupId: string) => void;
  /** Clear the line's current selection (back to "Choose an item"). */
  onClear?: () => void;
  /** Currently chosen group of THIS line. */
  value?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Close on any outside click (the input keeps focus for taps inside).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Close on Escape (and stop it from closing the whole form).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((g) => {
          // Already selected on ANOTHER line → not pickable, not visible.
          if (selectedIds.has(g._id) && g._id !== value) return false;
          if (!q) return true;
          const hay = [closetNameOf(g, closetNames), g.containerPath, g.name, g.brand, g.model]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, q, selectedIds, value, closetNames]);

  const chosenRow = value
    ? sections.flatMap((s) => s.items).find((g) => g._id === value)
    : undefined;

  const rowLabel = (g: Row) => {
    const storage = closetNameOf(g, closetNames);
    return [storage, g.containerPath].filter(Boolean).join(" · ");
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      {/* Trigger */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          if (!open) setTimeout(() => searchRef.current?.focus(), 30);
        }}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm",
          "hover:bg-accent/40",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {chosenRow ? (
            <>
              <span className="text-muted-foreground">{rowLabel(chosenRow) ? `${rowLabel(chosenRow)} · ` : ""}</span>
              <span className="font-medium">{chosenRow.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Choose an item</span>
          )}
        </span>
        {chosenRow && onClear && (
          <span
            role="button"
            tabIndex={-1}
            className="rounded p-0.5 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            title="Clear selection"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Popover — fixed relative to THIS row, never re-anchors while typing. */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search storage, container, item, brand…"
                className="h-8 pl-8"
                // Keep the keyboard open: no blur-on-tap, no autofocus juggling.
                enterKeyHint="search"
              />
            </div>
          </div>
          <div className="max-h-[45vh] overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {q ? `Nothing matches “${query}”.` : "No lendable items."}
              </p>
            ) : (
              filtered.map((s) => (
                <div key={s.categoryId || "other"}>
                  <p className="sticky top-0 z-10 border-b bg-popover/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {s.categoryName}
                  </p>
                  {s.items.map((g) => {
                    const a = availability?.[g._id]?.available;
                    const bm = brandModelLine(g);
                    return (
                      <button
                        key={g._id}
                        type="button"
                        className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/60"
                        onClick={() => {
                          onPick(g._id);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                            {rowLabel(g) && (
                              <span className="text-[11px] text-muted-foreground">{rowLabel(g)}</span>
                            )}
                            <span className="truncate font-medium">
                              {g.name}
                              {isPackGroup(g as any) ? ` (${describePackSize(g as any)})` : ""}
                            </span>
                          </span>
                          <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate">{bm || "\u00A0"}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {a === undefined ? "…" : `${a} free`}
                          {g._id === value && <Check className="size-3.5 text-primary" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="border-t p-1.5">
            <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function closetNameOf(
  g: { _id: string; closetId?: string },
  closetNames: Map<string, string>,
): string {
  return g.closetId ? (closetNames.get(g.closetId) ?? "") : "";
}
