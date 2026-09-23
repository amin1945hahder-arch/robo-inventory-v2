import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { closetQr } from "@/lib/qr";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Warehouse } from "lucide-react";
type Stats = { total: number; available: number; rented: number; onProject: number; broken: number; pending: number };

export default function Closets() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const closets = useQuery(api.catalog.listClosets, {});
  const groups = useQuery(api.catalog.listGroups, {});
  const stats = useQuery(api.stats.groupStats, {});
  const remove = useMutation(api.catalog.deleteCloset);
  const upsertCloset = useMutation(api.catalog.upsertCloset);

  // Add/edit dialog: editing === null → closed; {id?} → open for add or edit.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"closets"> | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setName("");
    setLocation("");
    setNote("");
    setOpen(true);
  };

  const openEdit = (c: Doc<"closets">) => {
    setEditing(c);
    setName(c.name);
    setLocation(c.location ?? "");
    setNote(c.note ?? "");
    setOpen(true);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await upsertCloset({
        id: editing?._id,
        name: name.trim(),
        location: location.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success(editing ? "Storage updated" : "Storage added");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (c: Doc<"closets">) => {
    if (!confirm(`Delete storage “${c.name}”? Storages with component groups cannot be deleted.`)) return;
    try {
      await remove({ id: c._id });
      toast.success(`Storage “${c.name}” deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Storages</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Storage locations — each has a QR you can print and stick on the door.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={openAdd}>
              <Plus className="size-4" /> Add storage
            </Button>
          )}
        </header>

        {closets === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : closets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
            <Warehouse className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No storages yet.</p>
          </div>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {closets.map((c) => {
              const closetGroups = (groups ?? []).filter((g) => g.closetId === c._id);
              const agg: Stats = { total: 0, available: 0, rented: 0, onProject: 0, broken: 0, pending: 0 };
              for (const g of closetGroups) {
                const s = stats?.[g._id];
                if (!s) continue;
                agg.total += s.total;
                agg.available += s.available;
                agg.rented += s.rented;
                agg.onProject += s.onProject;
                agg.broken += s.broken;
                agg.pending += s.pending;
              }
              return (
                <Card key={c._id} className="group relative overflow-hidden border-border/80 shadow-none transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/closets/${c._id}`} className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold">{c.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {c.location ?? "Lab storage"}
                        </p>
                      </Link>
                      <div className="flex items-center gap-1">
                        <QrChip payload={closetQr(c._id)} label={c.name} />
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            title="Edit storage"
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            title="Delete storage"
                            onClick={() => doDelete(c)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span><b className="text-foreground">{agg.available}</b> available</span>
                      <span><b className="text-foreground">{agg.rented}</b> rented</span>
                      <span><b className="text-foreground">{agg.onProject}</b> on projects</span>
                      <span><b className="text-foreground">{agg.broken}</b> broken</span>
                      <span className="ml-auto font-medium text-foreground">{agg.total} units</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {closetGroups.slice(0, 3).map((g) => (
                        <Link
                          key={g._id}
                          to={`/group/${g._id}`}
                          className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {g.name}
                        </Link>
                      ))}
                      {closetGroups.length > 3 && (
                        <span className="text-[11px] text-muted-foreground">+{closetGroups.length - 3}</span>
                      )}
                    </div>
                    {isAdmin && agg.pending > 0 && (
                      <div className="flex items-center gap-2">
                        <StatusBadge status="pending" />
                        <Link to="/admin/requests" className="text-xs underline">
                          {agg.pending} pending request{agg.pending === 1 ? "" : "s"}
                        </Link>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit storage" : "Add storage"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Storage 3" />
            </div>
            <div className="grid gap-2">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lab B — Cabinet" />
            </div>
            <div className="grid gap-2">
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
