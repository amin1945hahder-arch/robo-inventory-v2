import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

/**
 * Pick the printer + spool and enter the sliced numbers (weight g, minutes)
 * from the slicer. Validates remaining spool weight before submitting.
 */
export function ScheduleJobDialog({
  job,
  open,
  onOpenChange,
}: {
  job: Doc<"printJobs"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const printers = useQuery(api.printing.listPrinters) ?? [];
  const filaments = useQuery(api.printing.listFilaments) ?? [];
  const scheduleJob = useMutation(api.printing.scheduleJob);

  const usable = printers.filter((p) => p.status === "idle" || p.status === "printing");
  const [printerId, setPrinterId] = useState<string>("");
  const [filamentId, setFilamentId] = useState<string>("");
  const [weightG, setWeightG] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);

  const spool = filaments.find((f) => f._id === filamentId);
  const overSpool = spool !== undefined && Number(weightG) > Number(spool.remainingG);

  const submit = async () => {
    if (!job || !printerId || !filamentId || !weightG || !minutes) return;
    setBusy(true);
    try {
      await scheduleJob({
        jobId: job._id,
        printerId: printerId as never,
        filamentId: filamentId as never,
        weightG: Number(weightG),
        minutes: Number(minutes),
      });
      toast.success("Job scheduled on the queue.");
      onOpenChange(false);
      setPrinterId("");
      setFilamentId("");
      setWeightG("");
      setMinutes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule the job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule “{job?.name}”</DialogTitle>
          <DialogDescription>
            Enter the numbers from the slicer (G-code) — they drive the queue and the
            overdue watchdog. Filament is deducted when the print starts, not before.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Printer</Label>
            <Select value={printerId} onValueChange={setPrinterId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a printer" />
              </SelectTrigger>
              <SelectContent>
                {usable.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                    {p.status === "printing" ? " (busy — queued after)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Filament spool</Label>
            <Select value={filamentId} onValueChange={setFilamentId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a spool" />
              </SelectTrigger>
              <SelectContent>
                {filaments.map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {f.material} · {f.colorName} — {f.remainingG} g left
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {overSpool && (
              <p className="text-xs text-destructive">
                That spool only has {spool?.remainingG} g — pick another or reduce the job.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="sched-weight">Filament (g)</Label>
              <Input
                id="sched-weight"
                type="number"
                min={1}
                value={weightG}
                onChange={(e) => setWeightG(e.target.value)}
                placeholder="42"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sched-minutes">Duration (min)</Label>
              <Input
                id="sched-minutes"
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="180"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !printerId || !filamentId || !weightG || !minutes || overSpool}
          >
            {busy && <Loader2 className="size-4 animate-spin" />} Add to queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
