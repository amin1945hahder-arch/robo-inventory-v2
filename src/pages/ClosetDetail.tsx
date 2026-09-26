import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { NavArrows } from "@/components/NavArrows";
import { GroupCard } from "@/components/GroupCard";
import { GroupFormDialog } from "@/components/GroupFormDialog";
import { QrChip } from "@/components/QrChip";
import { Button } from "@/components/ui/button";
import { closetQr } from "@/lib/qr";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { ArrowLeft, Plus, Warehouse } from "lucide-react";
import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel";

export default function ClosetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const closet = useQuery(api.catalog.getCloset, id ? { id: id as any } : "skip");
  const groups = useQuery(api.catalog.listGroups, id ? { closetId: id as any } : "skip");
  // Sibling storages for the ← → arrows (alphabetical, same as the list page).
  const allClosets = useQuery(api.catalog.listClosets, {});
  const stats = useQuery(api.stats.groupStats, {});
  // Full group index so master-container cards can show their contents
  // (outside view = inside view, exactly like the Inventory grid).
  const allGroups = useQuery(api.catalog.childGroupOptions, {});
  const categories = useQuery(api.catalog.listCategories, {});
  const deleteGroup = useMutation(api.catalog.deleteGroup);
  const [addOpen, setAddOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Doc<"groups"> | null>(null);

  // Only top-level groups appear here — groups inside containers live on the
  // container's page, same as the inventory grid.
  const topGroups = useMemo(
    () => (groups ?? []).filter((g) => !g.parentGroupId),
    [groups],
  );

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

  // Category sections in the same order as the Inventory page.
  const sections = useMemo(() => {
    const map = new Map<string, Doc<"groups">[]>();
    for (const g of topGroups) {
      const list = map.get(g.categoryId) ?? [];
      list.push(g);
      map.set(g.categoryId, list);
    }
    return (categories ?? [])
      .map((cat) => ({ cat, groups: map.get(cat._id) ?? [] }))
      .filter((s) => s.groups.length > 0);
  }, [topGroups, categories]);

  return (
    <AppShell>
      <NavArrows
        items={[...(allClosets ?? [])]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => c._id)}
        currentId={closet?._id}
        onNavigate={(nid) => navigate(`/closets/${nid}`)}
      />
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/closets")}>
            <ArrowLeft className="size-4" /> Storages
          </Button>
        </div>

        {closet === undefined ? (
          <LoadingGif size={48} label={null} />
        ) : closet === null ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Storage not found.</p>
        ) : (
          <>
            <header className="flex flex-wrap items-start gap-3 border-b pb-6">
              {closet.imageUrl && (
                <img
                  src={closet.imageUrl}
                  alt={closet.name}
                  className="h-24 w-40 rounded-lg border object-cover"
                />
              )}
              <QrChip payload={closetQr(closet._id)} label={closet.name} />
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold tracking-tight">{closet.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {closet.location ?? "Lab storage"}
                  {closet.note ? ` · ${closet.note}` : ""}
                </p>
              </div>
              {isAdmin && (
                <Button
                  className="gap-2"
                  onClick={() => {
                    setEditingGroup(null);
                    setAddOpen(true);
                  }}
                >
                  <Plus className="size-4" /> Add unit here
                </Button>
              )}
            </header>

            {groups === undefined ? (
              <p className="text-sm text-muted-foreground">Loading groups…</p>
            ) : topGroups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
                <Warehouse className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No component groups in this storage yet.
                </p>
                {isAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Use “Add unit here” to create the first one.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {sections.map(({ cat, groups: catGroups }, i) => (
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
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {catGroups.map((g) => {
                        const contained = childrenByParent.get(g._id);
                        return (
                          <GroupCard
                            key={g._id}
                            group={g}
                            stats={stats?.[g._id]}
                            categoryName={cat.name}
                            isAdmin={isAdmin}
                            containedGroups={contained}
                            onEdit={() => {
                              setEditingGroup(g);
                              setAddOpen(true);
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
                        );
                      })}
                    </div>
                  </motion.section>
                ))}
              </div>
            )}

            {/* New groups created here are inserted into this closet automatically
                and their physical units (individual QR tags) go to the inventory. */}
            <GroupFormDialog
              open={addOpen}
              onOpenChange={setAddOpen}
              group={editingGroup}
              defaults={{ closetId: closet._id }}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
