import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

const MATERIALS = ["PLA", "PLA+", "PETG", "ABS", "ASA", "TPU", "Other"] as const;

/** Register a filament spool, or edit stock/alerts on an existing one. */
export function FilamentFormDialog({
  open,
  onOpenChange,
  spool,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spool: Doc<"filaments"> | null; // null = create
}) {
  const addFilament = useMutation(api.printing.addFilament);
  const updateFilament = useMutation(api.printing.updateFilament);
  const groups = useQuery(api.catalog.listGroups, {}) ?? [];

  const [brand, setBrand] = useState("");
  const [material, setMaterial] = useState<string>("PLA");
  const [colorName, setColorName] = useState("");
  const [colorHex, setColorHex] = useState("#22d3ee");
  const [weightG, setWeightG] = useState("1000");
  const [remainingG, setRemainingG] = useState("");
  const [lowAtG, setLowAtG] = useState("150");
  const [inventoryGroupId, setInventoryGroupId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (spool) {
      setBrand(spool.brand ?? "");
      setMaterial(spool.material);
      setColorName(spool.colorName);
      setColorHex(spool.colorHex ?? "#22d3ee");
      setWeightG(String(spool.weightG));
      setRemainingG(spool.remainingG);
      setLowAtG(spool.lowAtG !== undefined ? String(spool.lowAtG) : "");
      setInventoryGroupId(spool.inventoryGroupId ?? "");
    } else {
      setBrand("");
      setMaterial("PLA");
      setColorName("");
      setColorHex("#22d3ee");
      setWeightG("1000");
      setRemainingG("");
      setLowAtG("150");
      setInventoryGroupId("");
    }
  }, [open, spool]);

  const submit = async () => {
    if (!colorName.trim()) return;
    setBusy(true);
    try {
      if (spool) {
        await updateFilament({
          id: spool._id,
          colorName: colorName.trim(),
          colorHex: colorHex || undefined,
          lowAtG: lowAtG ? Number(lowAtG) : undefined,
          remainingG: remainingG || undefined,
          inventoryGroupId: (inventoryGroupId || undefined) as never,
        });
      } else {
        await addFilament({
          brand: brand.trim() || undefined,
          material: material as (typeof MATERIALS)[number],
          colorName: colorName.trim(),
          colorHex: colorHex || undefined,
          weightG: Number(weightG) || 1000,
          lowAtG: lowAtG ? Number(lowAtG) : undefined,
          inventoryGroupId: (inventoryGroupId || undefined) as never,
        });
      }
      toast.success(spool ? "Spool updated." : "Spool added to the shelf.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the spool");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{spool ? "Edit spool" : "New filament spool"}</DialogTitle>
          <DialogDescription>
            Track material, color and remaining weight — the farm deducts grams as jobs complete
            and warns you below the low-stock threshold.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="fl-brand">Brand</Label>
              <Input id="fl-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Sunlu / Bambu…" />
            </div>
            <div className="grid gap-2">
              <Label>Material</Label>
              <Select value={material} onValueChange={setMaterial} disabled={Boolean(spool)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIALS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="fl-color">Color name *</Label>
              <Input
                id="fl-color"
                value={colorName}
                onChange={(e) => setColorName(e.target.value)}
                placeholder="Cyan"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fl-hex">Swatch</Label>
              <input
                id="fl-hex"
                type="color"
                value={colorHex}
                onChange={(e) => setColorHex(e.target.value)}
                className="size-9 cursor-pointer rounded-md border bg-transparent"
              />
            </div>
          </div>
          {spool ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="fl-remaining">Remaining (g)</Label>
                <Input id="fl-remaining" value={remainingG} onChange={(e) => setRemainingG(e.target.value)} type="number" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fl-low">Low alert at (g)</Label>
                <Input id="fl-low" value={lowAtG} onChange={(e) => setLowAtG(e.target.value)} type="number" />
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="fl-weight">Spool weight (g of plastic)</Label>
              <Input id="fl-weight" value={weightG} onChange={(e) => setWeightG(e.target.value)} type="number" />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Inventory link (optional)</Label>
            <Select value={inventoryGroupId || "none"} onValueChange={(v) => setInventoryGroupId(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {groups
                  .filter((g) => !g.deleted && g.measure && g.measure !== "count")
                  .map((g) => (
                    <SelectItem key={g._id} value={g._id}>
                      {g.name} {g.measureStock ? `— ${g.measureStock} ${g.measureUnit ?? ""}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !colorName.trim()}>
            {busy && <LoadingGifInline size={18} className="size-4" />} {spool ? "Save" : "Add spool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
