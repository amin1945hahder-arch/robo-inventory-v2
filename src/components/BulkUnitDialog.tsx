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
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

/**
 * Add a unit to a weight/length group (one at a time — each holds its own
 * amount) or edit an existing unit's remaining amount / minimum. The fields
 * PRE-FILL from the group's base settings (low-stock threshold) so the admin
 * can just confirm and go; everything stays modifiable.
 */
export function BulkUnitDialog({
  open,
  onOpenChange,
  group,
  unit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: Doc<"groups">;
  unit?: Doc<"parts"> | null; // null/undefined = add mode
}) {
  const addPart = useMutation(api.catalog.addPartToGroup);
  const updateUnit = useMutation(api.catalog.updateBulkUnit);

  const [amount, setAmount] = useState("");
  const [lowAt, setLowAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      if (unit) {
        setAmount(unit.amountRemaining ?? "");
        setLowAt(unit.lowAt ?? group.measureLowAt ?? "");
        setNote(unit.note ?? "");
      } else {
        // Group base settings as the starting point — editable before saving.
        setAmount("");
        setLowAt(group.measureLowAt ?? "");
        setNote("");
      }
    }
  }, [open, unit, group]);

  const isEdit = Boolean(unit);
  const unitLabel = group.measureUnit ?? "units";

  const submit = async () => {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error(`Enter the amount this unit holds (in ${unitLabel})`);
      return;
    }
    setBusy(true);
    try {
      if (unit) {
        await updateUnit({
          partId: unit._id,
          amountRemaining: amountNum,
          lowAt: lowAt.trim() === "" ? undefined : Number(lowAt),
          note: note.trim(),
        });
        toast.success("Unit updated — group stock re-summed");
      } else {
        await addPart({
          groupId: group._id,
          amount: amountNum,
          lowAt: lowAt.trim() === "" ? undefined : Number(lowAt),
        });
        toast.success(`Unit added with ${amountNum} ${unitLabel} and a new QR tag`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit unit ${(unit as Doc<"parts">).tag}` : `Add unit to ${group.name}`}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-2">
            <Label>
              Amount on this unit ({unitLabel}) — {isEdit ? "re-measured remaining" : "initial fill"}
            </Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={isEdit ? undefined : `e.g. ${group.measure === "weight" ? "1" : "3"} ${unitLabel}`}
            />
          </div>
          <div className="grid gap-2">
            <Label>
              Minimum kept on the unit ({unitLabel}) — prefilled from the group setting
            </Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={lowAt}
              onChange={(e) => setLowAt(e.target.value)}
              placeholder="Rental cuts may never drop it below this"
            />
          </div>
          {isEdit && (
            <div className="grid gap-2">
              <Label>Note (optional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. partial reel, color batch B…"
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {isEdit
              ? "The group's headline stock is re-summed from all units automatically."
              : "Each unit gets its own QR tag automatically. Rentals can cut across several units while respecting every minimum."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : isEdit ? "Save" : "Add unit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
