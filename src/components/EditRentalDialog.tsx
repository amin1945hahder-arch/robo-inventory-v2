import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
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
 *
 * Editing rules that keep records sane:
 * - A date the admin explicitly cleared (was set, now blank) is sent as null
 *   to remove it; a field that was always blank is left untouched.
 * - The status is only sent when it actually changed — re-sending "returned"
 *   on an old record must never release a unit that was re-rented since.
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

/** Record statuses whose unit is (or was) actually held by this record. */
const HOLDING = new Set(["pending", "approved", "active", "on_project"]);

const pad = (x: number) => String(x).padStart(2, "0");

/** ms timestamp → value for <input type="datetime-local"> (local time).
 *  Exported for the other admin record editors. */
export const toLocalInput = (n?: number | null) => {
  if (!n) return "";
  const d = new Date(n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** datetime-local value → ms timestamp (null clears the field). */
const fromLocalInput = (s: string): number | null =>
  s ? new Date(s).getTime() : null;

const FIELDS: { key: string; label: string }[] = [
  { key: "requestedAt", label: "Requested at" },
  { key: "decidedAt", label: "Decided at" },
  { key: "pickedUpAt", label: "Picked up at" },
  { key: "returnedAt", label: "Returned at" },
  { key: "dueAt", label: "Due back at" },
  { key: "pickupAt", label: "Scheduled pickup" },
];

/** Server error → human message: strips the "[CONVEX M(fn)] …/Called by
 *  client" decoration and unwraps ConvexError data payloads. Exported for the
 *  other admin record editors (package editing shows the same errors). */
export const asMessage = (e: unknown): string => {
  if (e instanceof ConvexError) {
    const d = e.data as any;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && typeof d.message === "string") return d.message;
  }
  const raw = e instanceof Error ? e.message : "Something went wrong";
  return raw
    .replace(/^\[CONVEX [A-Z]+\([^)]*\)\]\s*/, "")
    .replace(/\s+Called by client\s*$/, "")
    .trim() || raw;
};

/** True when the delete guard refused because the record still holds a unit. */
const releaseNeeded = (e: unknown): boolean => {
  if (e instanceof ConvexError && (e.data as any)?.code === "RENTAL_HOLDING_UNIT") {
    return true;
  }
  return asMessage(e).includes("holds the unit");
};

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
  const [originalStatus, setOriginalStatus] = useState<string>("pending");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [pristineDates, setPristineDates] = useState<Record<string, string>>({});
  const [condition, setCondition] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [alsoFree, setAlsoFree] = useState(false);
  const [deleteHint, setDeleteHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && rental) {
      const next = {
        requestedAt: toLocalInput(rental.requestedAt),
        decidedAt: toLocalInput(rental.decidedAt),
        pickedUpAt: toLocalInput(rental.pickedUpAt),
        returnedAt: toLocalInput(rental.returnedAt),
        dueAt: toLocalInput(rental.dueAt),
        pickupAt: toLocalInput(rental.pickupAt),
      };
      setStatus(rental.status ?? "pending");
      setOriginalStatus(rental.status ?? "pending");
      setDates(next);
      setPristineDates(next);
      setCondition(rental.conditionReport ?? "");
      setConfirmDelete(false);
      setAlsoFree(false);
      setDeleteHint(null);
    }
  }, [open, rental]);

  // undefined = untouched (not sent), number = changed value, null = cleared.
  const changedDate = (key: string): number | null | undefined => {
    if ((dates[key] ?? "") === (pristineDates[key] ?? "")) return undefined;
    return fromLocalInput(dates[key] ?? "");
  };

  const save = async () => {
    if (!rental) return;
    setBusy(true);
    try {
      await update({
        rentalId: rental._id,
        // Only send the status when it changed — re-sending "returned" on an
        // old record would release a unit that may have been re-rented since.
        ...(status !== originalStatus ? { status: status as any } : {}),
        requestedAt: changedDate("requestedAt"),
        decidedAt: changedDate("decidedAt"),
        pickedUpAt: changedDate("pickedUpAt"),
        returnedAt: changedDate("returnedAt"),
        dueAt: changedDate("dueAt"),
        pickupAt: changedDate("pickupAt"),
        conditionReport: condition,
      });
      toast.success("Rental record updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!rental) return;
    setBusy(true);
    try {
      await remove({ rentalId: rental._id, alsoFreePart: alsoFree || undefined });
      toast.success(
        alsoFree
          ? "Record deleted — unit released back to the shelf"
          : "Rental record deleted",
      );
      onOpenChange(false);
    } catch (e) {
      if (releaseNeeded(e)) {
        // The guard refused: the record still holds its unit. Pre-tick the
        // release option so the retry is one click instead of a dead end.
        setAlsoFree(true);
        setDeleteHint(
          "The unit is still marked rented / on project / pending in inventory. “Also release the unit” is now ticked — press Delete again to free it.",
        );
      } else {
        toast.error(asMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const holdsUnit = rental && HOLDING.has(rental.status);
  // Moving a live record to returned/canceled releases the held unit on save.
  const releasingOnSave =
    originalStatus !== status &&
    (originalStatus === "active" || originalStatus === "on_project") &&
    (status === "returned" || status === "canceled");

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
            {releasingOnSave && (
              <p className="text-xs font-medium text-amber-500">
                Saving this also releases the unit back to the shelf.
              </p>
            )}
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
              Clear a date to remove it; fields you never touch stay untouched.
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
            <div className="glass-3d rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
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
              {deleteHint && (
                <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500">
                  {deleteHint}
                </p>
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
