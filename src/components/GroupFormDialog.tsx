import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Box, MapPin, PackagePlus } from "lucide-react";

/**
 * Create or edit a component group (the "card" for a type of part).
 *
 * Duplicate/conflict prompt flows (admin choice, never a hard block):
 *  - name already exists in the SAME storage → "add to existing" or "create new"
 *  - name exists in a DIFFERENT storage → same question, showing where it lives
 * The QR payload is unique per group (`g:<id>`), so same-named groups stay
 * individually scannable — "create new" is always a safe choice.
 */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  defaults,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group?: Doc<"groups"> | null;
  defaults?: { categoryId?: string; closetId?: string; parentGroupId?: string };
}) {
  const categories = useQuery(api.catalog.listCategories, open ? {} : "skip");
  const closets = useQuery(api.catalog.listClosets, open ? {} : "skip");
  const allGroups = useQuery(api.catalog.childGroupOptions, open ? {} : "skip");
  const upsert = useMutation(api.catalog.upsertGroup);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [closetId, setClosetId] = useState("");
  const [parentGroupId, setParentGroupId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [datasheetUrl, setDatasheetUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [quantityTotal, setQuantityTotal] = useState("1");
  // Counting mode: discrete units, packs, or bulk stock (weight/length).
  const [measure, setMeasure] = useState<"count" | "weight" | "length" | "pack">("count");
  const [packSize, setPackSize] = useState("40");
  const [measureUnit, setMeasureUnit] = useState("kg");
  const [measureStock, setMeasureStock] = useState("0");
  const [measureLowAt, setMeasureLowAt] = useState("");
  const [busy, setBusy] = useState(false);

  // Duplicate/conflict prompt state.
  const [conflict, setConflict] = useState<{
    kind: "same-storage" | "other-storage";
    existing: Doc<"groups">;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setCategoryId(group?.categoryId ?? defaults?.categoryId ?? "");
      setClosetId(group?.closetId ?? defaults?.closetId ?? "");
      setParentGroupId(group?.parentGroupId ?? defaults?.parentGroupId ?? "");
      setBrand(group?.brand ?? "");
      setModel(group?.model ?? "");
      setDescription(group?.description ?? "");
      setDatasheetUrl(group?.datasheetUrl ?? "");
      setImageUrl(group?.imageUrl ?? "");
      setQuantityTotal(String(group?.quantityTotal ?? 1));
      setMeasure(group?.measure ?? "count");
      setPackSize(group?.packSize ? String(group.packSize) : "40");
      setMeasureUnit(group?.measureUnit ?? "kg");
      setMeasureStock(group?.measureStock ?? "0");
      setMeasureLowAt(group?.measureLowAt ?? "");
      setConflict(null);
    }
  }, [open, group, defaults]);

  /** Descendants of a group (for cycle-safe container filtering). */
  const descendantIds = (rootId: string): string[] => {
    const out: string[] = [];
    const walk = (pid: string) => {
      for (const g of allGroups ?? []) {
        if (g.parentGroupId === pid) {
          out.push(g._id);
          walk(g._id);
        }
      }
    };
    walk(rootId);
    return out;
  };

  const submit = async (forceNew = false) => {
    if (!name.trim() || !categoryId || !closetId) {
      toast.error("Name, category and storage are required");
      return;
    }
    setBusy(true);
    try {
      const clean = name.trim();
      const norm = (s: string) => s.trim().toLowerCase();
      // Duplicate/conflict detection — only when creating, or when the admin
      // renamed/moved an existing group onto a colliding name.
      if (!conflict && !forceNew) {
        const others = (allGroups ?? []).filter((g) => g._id !== group?._id);
        const sameStorage = others.find(
          (g) => norm(g.name) === norm(clean) && g.closetId === closetId,
        );
        if (sameStorage) {
          setConflict({ kind: "same-storage", existing: sameStorage });
          setBusy(false);
          return;
        }
        const otherStorage = others.find(
          (g) => norm(g.name) === norm(clean) && g.closetId !== closetId,
        );
        if (otherStorage) {
          setConflict({ kind: "other-storage", existing: otherStorage });
          setBusy(false);
          return;
        }
      }
      const id = await upsert({
        id: group?._id,
        name: clean,
        categoryId: categoryId as any,
        closetId: closetId as any,
        parentGroupId: (parentGroupId || null) as any,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        description: description.trim() || undefined,
        datasheetUrl: datasheetUrl.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        quantityTotal: Math.max(1, parseInt(quantityTotal, 10) || 1),
        measure,
        packSize: measure === "pack" ? Math.max(1, parseInt(packSize, 10) || 1) : undefined,
        measureUnit: measure !== "count" ? measureUnit : undefined,
        measureStock: measure !== "count" ? measureStock : undefined,
        measureLowAt: measure !== "count" ? measureLowAt.trim() || undefined : undefined,
      });
      toast.success(group ? "Group updated" : "Group created");
      onOpenChange(false);
      setConflict(null);
      if (!group) window.location.href = `/group/${id}`;
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const closetName = (id: string) => (closets ?? []).find((c) => c._id === id)?.name ?? "a storage";

  // Container options: every group except this one and its own subtree.
  // Weight/length (bulk) groups hold material, not groups — never containers.
  const blocked = new Set(group ? [group._id, ...descendantIds(group._id)] : []);
  const parentOptions = (allGroups ?? []).filter(
    (g) => !blocked.has(g._id) && (!g.measure || g.measure === "count"),
  );
  const parentValue = parentGroupId || "none";
  const chosenParent = (allGroups ?? []).find((g) => g._id === parentGroupId);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) setConflict(null); onOpenChange(v); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arduino Uno" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Storage</Label>
                <Select value={closetId} onValueChange={setClosetId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(closets ?? []).map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Group-of-groups: place this group inside a container group. */}
            <div className="grid gap-2 glass-3d rounded-lg border border-dashed p-3">
              <Label className="flex items-center gap-1.5">
                <Box className="size-3.5" /> Place inside another group (optional)
              </Label>
              <Select
                value={parentValue}
                onValueChange={(v) => setParentGroupId(v === "none" ? "" : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not inside anything (top level)</SelectItem>
                  {parentOptions.map((g) => (
                    <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chosenParent ? (
                <p className="text-xs text-muted-foreground">
                  Will appear inside “{chosenParent.name}” — e.g. groups that live together in one
                  box. The box becomes a master container: it shows the groups inside it, and no
                  units can be added to the box itself.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Group groups that exist together (a box of mixed components) under one container.
                </p>
              )}
            </div>
            {conflict && (
              <div className="glass-3d rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                {conflict.kind === "same-storage" ? (
                  <p className="font-medium">
                    A group named “{conflict.existing.name}” already exists in{" "}
                    {closetName(conflict.existing.closetId)}.
                  </p>
                ) : (
                  <p className="font-medium">
                    A group named “{conflict.existing.name}” already exists in{" "}
                    {closetName(conflict.existing.closetId)} — different from the storage you picked.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Every group gets its own unique QR code, so creating another one is safe.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setConflict(null);
                      window.location.href = `/group/${conflict.existing._id}`;
                    }}
                  >
                    <MapPin className="size-3.5" /> Open the existing one
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConflict(null);
                      void submit(true);
                    }}
                    disabled={busy}
                  >
                    <PackagePlus className="size-3.5" />
                    {conflict.kind === "same-storage" ? "Create a new group anyway" : "Create new (separate group)"}
                  </Button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Brand</Label>
                <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Arduino" />
              </div>
              <div className="grid gap-2">
                <Label>Model</Label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="A000066" />
              </div>
            </div>
            {/* Counting mode */}
            <div className="grid gap-2">
              <Label>How is this counted?</Label>
              <Select
                value={measure}
                onValueChange={(v) => {
                  const next = v as "count" | "weight" | "length" | "pack";
                  setMeasure(next);
                  if (!group) setMeasureUnit(next === "weight" ? "kg" : "m");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">🔢 Count (discrete units, each with a QR tag)</SelectItem>
                  <SelectItem value="pack">📦 Pack (whole packs, e.g. jumper wires — pieces per pack)</SelectItem>
                  <SelectItem value="weight">⚖️ Weight (filament, resin… by kg/g)</SelectItem>
                  <SelectItem value="length">📏 Length (wires, tubes… by m/cm/mm)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {measure === "pack" && (
              <div className="grid gap-3 glass-3d rounded-lg border border-dashed p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Pieces inside each pack</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={packSize}
                      onChange={(e) => setPackSize(e.target.value)}
                      disabled={Boolean(group)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>How many packs</Label>
                    {group ? (
                      <Input value={quantityTotal} disabled />
                    ) : (
                      <Input
                        type="number"
                        min={1}
                        value={quantityTotal}
                        onChange={(e) => setQuantityTotal(e.target.value)}
                      />
                    )}
                  </div>
                </div>
                {group ? (
                  <p className="text-xs text-muted-foreground">
                    Locked — every pack holds {packSize || "…"} pieces. Add/remove whole packs below the
                    group header instead.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Every pack gets its own QR tag (JUM-001, JUM-002…) and counts as ONE pack — the
                    {Number(packSize) > 1 ? ` ${Number(packSize)}` : ""} pieces inside travel with it.
                    Members request packs, not single pieces.
                  </p>
                )}
              </div>
            )}
            {measure === "count" ? (
              !group && (
                <div className="grid gap-2">
                  <Label>How many units</Label>
                  <Input
                    type="number"
                    min={1}
                    value={quantityTotal}
                    onChange={(e) => setQuantityTotal(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Each unit gets its own QR tag automatically (ARD-001, ARD-002, …).
                  </p>
                </div>
              )
            ) : (
              <div className="grid gap-3 glass-3d rounded-lg border border-dashed p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Unit</Label>
                    {group ? (
                      <Input value={measureUnit} disabled />
                    ) : (
                      <Select value={measureUnit} onValueChange={setMeasureUnit}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(measure === "weight" ? ["kg", "g"] : ["m", "cm", "mm"]).map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {group && (
                      <p className="text-xs text-muted-foreground">
                        Locked — every unit's stock is ledgered in {measureUnit}.
                      </p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label>Stock on hand</Label>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={measureStock}
                      onChange={(e) => setMeasureStock(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Low-stock warning at (optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={measureLowAt}
                    onChange={(e) => setMeasureLowAt(e.target.value)}
                    placeholder="e.g. 0.5 — flagged when stock drops below"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Bulk groups keep stock per unit (reel, spool, tube…) — each unit gets its own QR
                  tag and amount. Members request an amount; the system splits it across units
                  without ever cutting a unit below its minimum.
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Short description for the card"
              />
            </div>
            <div className="grid gap-2">
              <Label>Datasheet URL</Label>
              <Input
                value={datasheetUrl}
                onChange={(e) => setDatasheetUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="grid gap-2">
              <Label>Image URL</Label>
              <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => submit()} disabled={busy}>
              {busy ? "Saving…" : group ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
