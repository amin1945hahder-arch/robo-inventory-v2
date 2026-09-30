import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { matchesSearch } from "@/lib/searchText";
import { AppShell } from "@/components/AppShell";
import { GroupCard } from "@/components/GroupCard";
import { BulkGroupDialog } from "@/components/BulkGroupDialog";
import { GroupFormDialog } from "@/components/GroupFormDialog";
import { QrScanDialog } from "@/components/QrScanDialog";
import { InventorySearchDialog } from "@/components/InventorySearchDialog";
import { QrChip } from "@/components/QrChip";
import { LoadingGif } from "@/components/LoadingGif";
import { AppIcon } from "@/components/AppIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { categoryQr, normalizeScan } from "@/lib/qr";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import {
  FolderOpen,
  MoreVertical,
  PackagePlus,
  Pencil,
  Plus,
  ScanLine,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

type SortKey = "name" | "total" | "available" | "broken";

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryFilter = searchParams.get("category") ?? "";
  // Search-button filters live in the URL so they survive navigation and can
  // be deep-linked (?q=&closet=&avail=); the bar controls below edit them too.
  const qFilter = searchParams.get("q") ?? "";
  const closetParam = searchParams.get("closet") ?? "";
  const availParam = searchParams.get("avail") ?? "";

  const categories = useQuery(api.catalog.listCategories, {});
  const closets = useQuery(api.catalog.listClosets, {});
  const stats = useQuery(api.stats.groupStats, {});
  const groups = useQuery(api.catalog.listGroups, {
    search: "",
    categoryId: (categoryFilter || undefined) as any,
  });
  // Master containers show their contained groups on the card (outside =
  // inside), so the grid needs the full group index, not just top-level rows.
  const allGroups = useQuery(api.catalog.childGroupOptions, {});
  // Every unit of the listed groups: the search also matches unit tags and
  // per-unit notes, so "whatever you type" finds the right group.
  const unitRows = useQuery(api.parts.listPartsByGroups, {});
  const [search, setSearch] = useState(qFilter);
  const [closetFilter, setClosetFilter] = useState(closetParam || "all");
  const [availFilter, setAvailFilter] = useState(availParam || "all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [scanOpen, setScanOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Doc<"groups"> | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  // Category edit dialog (null = closed, {id} = edit, {_id: undefined} = new).
  const [editingCat, setEditingCat] = useState<Doc<"categories"> | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatDesc, setEditCatDesc] = useState("");
  const upsertCategory = useMutation(api.catalog.upsertCategory);
  const deleteCategory = useMutation(api.catalog.deleteCategory);
  const deleteGroup = useMutation(api.catalog.deleteGroup);
  // Multi-select mode: tick groups, then edit/delete them all at once.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const toggleGroup = (gid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };
  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected group(s) and all their units?`)) return;
    try {
      const res = await bulkDeleteGroups({ groupIds: [...selected] as any });
      setSelected(new Set());
      if (res.deleted > 0) toast.success(`${res.deleted} group(s) deleted`);
      if (res.skipped.length > 0) toast.warning(`Skipped: ${res.skipped.join(", ")}`);
    } catch (e) {
      toast.error(asMessage(e));
    }
  };
  const bulkDeleteGroups = useMutation(api.catalog.bulkDeleteGroups);

  // Re-sync the bar controls when URL-driven filters change (e.g. from the
  // Search dialog, which navigates with ?q=&closet=&avail=).
  useEffect(() => {
    setSearch(qFilter);
    setClosetFilter(closetParam || "all");
    setAvailFilter(availParam || "all");
  }, [qFilter, closetParam, availParam]);

  // Unit tags/notes per group, pre-joined once — the search filter consults
  // this map instead of re-scanning every unit row on every keystroke.
  const unitsBlobByGroup = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of unitRows ?? []) {
      m.set(p.groupId, [m.get(p.groupId), p.tag, p.note].filter(Boolean).join(" "));
    }
    return m;
  }, [unitRows]);

  const filtered = useMemo(() => {
    let list = (groups ?? []).filter(
      (g) =>
        // Groups inside a master container live on the container's page —
        // the inventory grid shows top-level groups only. The container
        // filter must apply BEFORE the search match (and its fallback).
        !g.parentGroupId &&
        // Units of this group: matching a unit tag or unit note surfaces
        // the group in the results.
        matchesSearch(g, search, unitsBlobByGroup.get(g._id)),
    );
    if (closetFilter !== "all") list = list.filter((g) => g.closetId === closetFilter);
    if (availFilter !== "all") {
      list = list.filter((g) => {
        const st = stats?.[g._id];
        if (!st) return false;
        if (availFilter === "available") return st.available > 0;
        if (availFilter === "out") return st.rented + st.onProject > 0;
        if (availFilter === "broken") return st.broken > 0;
        if (availFilter === "none") return st.available === 0;
        return true;
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      const sa = stats?.[a._id];
      const sb = stats?.[b._id];
      if (sortKey === "total") return (sb?.total ?? 0) - (sa?.total ?? 0);
      if (sortKey === "available") return (sb?.available ?? 0) - (sa?.available ?? 0);
      if (sortKey === "broken") return (sb?.broken ?? 0) - (sa?.broken ?? 0);
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [groups, unitsBlobByGroup, search, qFilter, closetFilter, availFilter, sortKey, stats]);

  const byCategory = useMemo(() => {
    const map = new Map<string, Doc<"groups">[]>();
    for (const g of filtered) {
      const list = map.get(g.categoryId) ?? [];
      list.push(g);
      map.set(g.categoryId, list);
    }
    return map;
  }, [filtered]);

  // parent id -> groups directly inside it (for master container cards).
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Doc<"groups">[]>();
    for (const g of allGroups ?? []) {
      if (!g.parentGroupId) continue;
      const list = map.get(g.parentGroupId) ?? [];
      list.push(g);
      map.set(g.parentGroupId, list);
    }
    return map;
  }, [allGroups]);

  const visibleCategories = (categories ?? []).filter(
    (c) => !categoryFilter || c._id === categoryFilter,
  );

  const handleScan = (text: string) => {
    setScanOpen(false);
    window.location.href = `/qr?p=${encodeURIComponent(normalizeScan(text))}`;
  };

  const resetFilters = () => {
    setSearch("");
    setClosetFilter("all");
    setAvailFilter("all");
    setSortKey("name");
    setSearchParams({});
  };
  const filtersActive =
    Boolean(search) ||
    closetFilter !== "all" ||
    availFilter !== "all" ||
    sortKey !== "name" ||
    Boolean(categoryFilter);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length} of {groups?.length ?? 0} component groups · scan any shelf label to jump straight to it
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSearchOpen(true)}>
              <Search className="size-4" /> Search
            </Button>
            <Button variant="outline" onClick={() => setScanOpen(true)}>
              <ScanLine className="size-4" /> Scan QR
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" onClick={() => setCatDialogOpen(true)}>
                  <Plus className="size-4" /> Category
                </Button>
                <Button
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupFormOpen(true);
                  }}
                >
                  <PackagePlus className="size-4" /> Add group
                </Button>
              </>
            )}
          </div>
        </header>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Select-all: every group currently shown by the filters. */}
            <Checkbox
              checked={filtered.length > 0 && filtered.every((g) => selected.has(g._id))}
              onCheckedChange={() => {
                setSelected((prev) => {
                  if (filtered.length > 0 && filtered.every((g) => prev.has(g._id))) {
                    const next = new Set(prev);
                    for (const g of filtered) next.delete(g._id);
                    return next;
                  }
                  return new Set([...prev, ...filtered.map((g) => g._id)]);
                });
              }}
              aria-label="Select all groups"
              className="ml-1"
            />
            <span className="text-xs text-muted-foreground">
              Select all{selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </span>
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
                  <Pencil className="size-3.5" /> Edit selected
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={bulkDelete}>
                  <Trash2 className="size-3.5" /> Delete selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </>
            )}
          </div>
        )}

        {/* Filter bar — search, category, storage, availability, sort */}
        <div className="flex flex-col gap-2 glass-3d rounded-lg border bg-card/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search parts, brands, models…"
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter || "all"} onValueChange={(v) => setSearchParams(v === "all" ? {} : { category: v })}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={closetFilter} onValueChange={setClosetFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Storage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All storages</SelectItem>
                {(closets ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={availFilter} onValueChange={setAvailFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any availability</SelectItem>
                <SelectItem value="available">Has available units</SelectItem>
                <SelectItem value="none">Nothing available</SelectItem>
                <SelectItem value="out">Any unit out (rented/project)</SelectItem>
                <SelectItem value="broken">Has broken units</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: name A→Z</SelectItem>
                <SelectItem value="total">Sort: most units</SelectItem>
                <SelectItem value="available">Sort: most available</SelectItem>
                <SelectItem value="broken">Sort: most broken</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <SlidersHorizontal className="size-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>

        {categoryFilter && visibleCategories.length === 1 && (
          <div className="flex items-center justify-between glass-3d rounded-lg border px-4 py-3">
            <div className="flex items-center gap-3">
              <QrChip
                payload={categoryQr(visibleCategories[0].name)}
                label={visibleCategories[0].name}
              />
              <div>
                <p className="text-sm font-medium">{visibleCategories[0].name}</p>
                <p className="text-xs text-muted-foreground">
                  {visibleCategories[0].description ?? "Category"}
                </p>
              </div>
            </div>
          </div>
        )}

        {groups === undefined ? (
          <div className="py-16">
            <LoadingGif label="Loading inventory…" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-3d rounded-lg border border-dashed px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing matches these filters. {isAdmin ? "Adjust them or import a CSV." : "Try another search."}
            </p>
            {filtersActive && (
              <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {visibleCategories.map((cat, i) => {
              const catGroups = byCategory.get(cat._id) ?? [];
              if (catGroups.length === 0) return null;
              return (
                <motion.section
                  key={cat._id}
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2">
                    <AppIcon category={cat.name} fallback={FolderOpen} className="size-4 shrink-0 text-primary" />
                    <h2 className="text-sm font-semibold">{cat.name}</h2>
                    <span className="text-xs text-muted-foreground">· {catGroups.length}</span>
                    <div className="ml-1">
                      <QrChip payload={categoryQr(cat.name)} label={cat.name} />
                    </div>
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7">
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingCat(cat);
                              setEditCatName(cat.name);
                              setEditCatDesc(cat.description ?? "");
                            }}
                          >
                            <Pencil className="size-4" /> Edit category
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={async () => {
                              if (!confirm(`Delete category “${cat.name}”? Categories with groups cannot be deleted.`)) return;
                              try {
                                await deleteCategory({ id: cat._id });
                                toast.success("Category deleted");
                              } catch (e) {
                                toast.error(asMessage(e));
                              }
                            }}
                          >
                            <Trash2 className="size-4" /> Delete category
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {catGroups.map((g) => {
                      const contained = childrenByParent.get(g._id);
                      return (
                        <div
                          key={g._id}
                          className={`flex flex-col gap-2 rounded-lg transition-colors${selected.has(g._id) ? " ring-1 ring-primary/60" : ""}`}
                        >
                          {isAdmin && (
                            <label className="ml-1 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={selected.has(g._id)}
                                onCheckedChange={() => toggleGroup(g._id)}
                                aria-label={`Select ${g.name}`}
                              />
                              select
                            </label>
                          )}
                          <GroupCard
                            group={g}
                            stats={stats?.[g._id]}
                            categoryName={cat.name}
                            isAdmin={isAdmin}
                            containedGroups={contained}
                            onEdit={() => {
                              setEditingGroup(g);
                              setGroupFormOpen(true);
                            }}
                            onDelete={async () => {
                              if (!confirm(`Delete ${g.name} and all its units?`)) return;
                              try {
                                await deleteGroup({ id: g._id });
                                toast.success("Group deleted");
                              } catch (e) {
                                toast.error(asMessage(e));
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </motion.section>
              );
            })}
          </div>
        )}
      </div>

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={handleScan} />
      <InventorySearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        categories={categories}
        closets={closets}
      />
      <BulkGroupDialog
        open={bulkEditOpen}
        onOpenChange={(v) => {
          setBulkEditOpen(v);
          if (!v) setSelected(new Set());
        }}
        groupIds={[...selected] as any}
        categories={categories}
        closets={closets}
        allGroups={allGroups}
      />
      <GroupFormDialog
        open={groupFormOpen}
        onOpenChange={setGroupFormOpen}
        group={editingGroup}
        defaults={categoryFilter ? { categoryId: categoryFilter } : undefined}
      />

      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New category</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Boards" />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea value={catDesc} onChange={(e) => setCatDesc(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!catName.trim()) return;
                try {
                  await upsertCategory({ name: catName.trim(), description: catDesc.trim() || undefined });
                  toast.success("Category added");
                  setCatDialogOpen(false);
                  setCatName("");
                  setCatDesc("");
                } catch (e) {
                  toast.error(asMessage(e));
                }
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit-category dialog (from the ⋮ menu on each category heading) */}
      <Dialog open={Boolean(editingCat)} onOpenChange={(v) => !v && setEditingCat(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={editCatName} onChange={(e) => setEditCatName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea value={editCatDesc} onChange={(e) => setEditCatDesc(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCat(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!editingCat || !editCatName.trim()) return;
                try {
                  await upsertCategory({
                    id: editingCat._id,
                    name: editCatName.trim(),
                    description: editCatDesc.trim() || undefined,
                  });
                  toast.success("Category updated");
                  setEditingCat(null);
                } catch (e) {
                  toast.error(asMessage(e));
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
