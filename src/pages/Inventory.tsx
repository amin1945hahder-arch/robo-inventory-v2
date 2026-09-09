import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { GroupCard } from "@/components/GroupCard";
import { GroupFormDialog } from "@/components/GroupFormDialog";
import { QrScanDialog } from "@/components/QrScanDialog";
import { QrChip } from "@/components/QrChip";
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
import { motion } from "framer-motion";
import { categoryQr } from "@/lib/qr";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PackagePlus, Plus, ScanLine, Search } from "lucide-react";

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryFilter = searchParams.get("category") ?? "";

  const categories = useQuery(api.catalog.listCategories, {});
  const stats = useQuery(api.stats.groupStats, {});
  const groups = useQuery(api.catalog.listGroups, {
    search: "",
    categoryId: (categoryFilter || undefined) as any,
  });
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Doc<"groups"> | null>(null);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const upsertCategory = useMutation(api.catalog.upsertCategory);
  const deleteGroup = useMutation(api.catalog.deleteGroup);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (groups ?? []).filter(
      (g) =>
        !s ||
        g.name.toLowerCase().includes(s) ||
        (g.brand ?? "").toLowerCase().includes(s) ||
        (g.model ?? "").toLowerCase().includes(s) ||
        (g.description ?? "").toLowerCase().includes(s),
    );
  }, [groups, search]);

  const byCategory = useMemo(() => {
    const map = new Map<string, Doc<"groups">[]>();
    for (const g of filtered) {
      const list = map.get(g.categoryId) ?? [];
      list.push(g);
      map.set(g.categoryId, list);
    }
    return map;
  }, [filtered]);

  const visibleCategories = (categories ?? []).filter(
    (c) => !categoryFilter || c._id === categoryFilter,
  );

  const handleScan = (text: string) => {
    setScanOpen(false);
    window.location.href = `/qr?p=${encodeURIComponent(text)}`;
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {groups?.length ?? 0} component groups · scan any shelf label to jump straight to it
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
          {categoryFilter && (
            <Button variant="ghost" onClick={() => setSearchParams({})}>
              Clear category filter
            </Button>
          )}
        </div>

        {categoryFilter && visibleCategories.length === 1 && (
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
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
          <p className="py-16 text-center text-sm text-muted-foreground">Loading inventory…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing found. {isAdmin ? "Add your first group or import a CSV." : "Try another search."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {visibleCategories.map((cat, i) => {
              const catGroups = byCategory.get(cat._id) ?? [];
              if (catGroups.length === 0) return null;
              return (
                <motion.section
                  key={cat._id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.06, ease: "easeOut" }}
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{cat.name}</h2>
                    <span className="text-xs text-muted-foreground">· {catGroups.length}</span>
                    <div className="ml-1">
                      <QrChip payload={categoryQr(cat.name)} label={cat.name} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {catGroups.map((g) => (
                      <GroupCard
                        key={g._id}
                        group={g}
                        stats={stats?.[g._id]}
                        categoryName={cat.name}
                        isAdmin={isAdmin}
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
                            toast.error(e instanceof Error ? e.message : "Failed");
                          }
                        }}
                      />
                    ))}
                  </div>
                </motion.section>
              );
            })}
          </div>
        )}
      </div>

      <QrScanDialog open={scanOpen} onOpenChange={setScanOpen} onResult={handleScan} />
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
                await upsertCategory({ name: catName.trim(), description: catDesc.trim() || undefined });
                toast.success("Category added");
                setCatDialogOpen(false);
                setCatName("");
                setCatDesc("");
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}