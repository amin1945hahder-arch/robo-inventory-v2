import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

/**
 * Admin editor for a single rental RECORD — fix dates (requested / decided /
 * picked up / returned / due / scheduled pickup), the status or the condition
 * note, or delete a mistaken/duplicate record entirely. Deleting a record
 * that still holds its unit requires the explicit "also release the unit"
 * option so live rentals can't vanish silently.
 */

const STATUSES = [
  "pending",
  "approved",
  "active",
  "on_project",
  "returned",
  "denied",
  "canceled",
] as const;

const pad = (x: number) => String(x).padStart(2, "0");

/** ms timestamp → value for <input type="datetime-local"> (local time). */
const toLocalInput = (n?: number | null) => {
  if (!n) return "";
  const d = new Date(n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** datetime-local value → ms timestamp (null clears the field). */
const fromLocalInput = (s: string): number | null => (s ? new Date(s).getTime() : null);

const FIELDS: { key: string; label: string }[] = [
  { key: "requestedAt", label: "Requested at" },
  { key: "decidedAt", label: "Decided at" },
  { key: "pickedUpAt", label: "Picked up at" },
  { key: "returnedAt", label: "Returned at" },
  { key: "dueAt", label: "Due back at" },
  { key: "pickupAt", label: "Scheduled pickup" },
];

export function EditRentalDialog({
  open,
  onOpenChange,
  rental,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rental: any;
}) {
  const update = useMutation(api.parts.updateRentalRecord);
  const remove = useMutation(api.parts.deleteRentalRecord);

  const [status, setStatus] = useState<string>("pending");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [condition, setCondition] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [alsoFree, setAlsoFree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && rental) {
      setStatus(rental.status ?? "pending");
      setDates({
        requestedAt: toLocalInput(rental.requestedAt),
        decidedAt: toLocalInput(rental.decidedAt),
        pickedUpAt: toLocalInput(rental.pickedUpAt),
        returnedAt: toLocalInput(rental.returnedAt),
        dueAt: toLocalInput(rental.dueAt),
        pickupAt: toLocalInput(rental.pickupAt),
      });
      setCondition(rental.conditionReport ?? "");
      setConfirmDelete(false);
      setAlsoFree(false);
    }
  }, [open, rental]);

  const save = async () => {
    if (!rental) return;
    setBusy(true);
    try {
      await update({
        rentalId: rental._id,
        status: status as any,
        requestedAt: fromLocalInput(dates.requestedAt ?? ""),
        decidedAt: fromLocalInput(dates.decidedAt ?? ""),
        pickedUpAt: fromLocalInput(dates.pickedUpAt ?? ""),
        returnedAt: fromLocalInput(dates.returnedAt ?? ""),
        dueAt: fromLocalInput(dates.dueAt ?? ""),
        pickupAt: fromLocalInput(dates.pickupAt ?? ""),
        conditionReport: condition,
      });
      toast.success("Rental record updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!rental) return;
    setBusy(true);
    try {
      await remove({ rentalId: rental._id, alsoFreePart: alsoFree || undefined });
      toast.success("Rental record deleted");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setAlsoFree(true);
    } finally {
      setBusy(false);
    }
  };

  const holdsUnit = rental && (rental.status === "active" || rental.status === "pending" || rental.status === "approved");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit rental record</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Changing a live "active" record to returned/canceled also frees the unit.
            </p>
          </div>

          <div className="grid gap-3">
            <Label>Dates</Label>
            {FIELDS.map(({ key, label }) => (
              <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-2">
                <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
                <Input
                  type="datetime-local"
                  step={60}
                  value={dates[key] ?? ""}
                  onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
                  className="h-8 w-56 text-xs"
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Clear a date to remove it; saving keeps everything else untouched.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Condition note</Label>
            <Input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. returned with a missing cable"
            />
          </div>

          {confirmDelete && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Delete this rental record?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This removes the record from the ledger permanently — for duplicates or mistakes.
              </p>
              {holdsUnit && (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <Checkbox checked={alsoFree} onCheckedChange={(v) => setAlsoFree(Boolean(v))} />
                  Also release the unit (mark it available)
                </label>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
                <Button size="sm" variant="destructive" onClick={doDelete} disabled={busy}>
                  <Trash2 className="size-3.5" /> Delete record
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {!confirmDelete ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
