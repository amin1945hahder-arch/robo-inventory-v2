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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, LifeBuoy } from "lucide-react";

/** Submit a new print request. "I need help slicing" flags it for an admin. */
export function NewJobDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createJob = useMutation(api.printing.createJob);
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [fileName, setFileName] = useState("");
  const [estWeightG, setEstWeightG] = useState<number>(30);
  const [estHours, setEstHours] = useState<number>(2);
  const [needSlicing, setNeedSlicing] = useState(false);
  const [slicingNote, setSlicingNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createJob({
        name: name.trim(),
        details: details.trim() || undefined,
        fileName: fileName.trim() || undefined,
        estWeightG: estWeightG || undefined,
        estMinutes: estHours ? Math.round(estHours * 60) : undefined,
        needSlicing,
        slicingNote: needSlicing && slicingNote.trim() ? slicingNote.trim() : undefined,
      });
      toast.success("Print request submitted — the team has been notified.");
      onOpenChange(false);
      setName("");
      setDetails("");
      setFileName("");
      setSlicingNote("");
      setNeedSlicing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New print request</DialogTitle>
          <DialogDescription>
            Describe the part you want printed. An admin reviews, slices and schedules it on a
            printer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="job-name">Part name *</Label>
            <Input
              id="job-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Robot chassis plate"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="job-details">Details</Label>
            <Textarea
              id="job-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Dimensions, color, infill, anything important…"
              rows={2}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="job-file">Model file name / link</Label>
            <Input
              id="job-file"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="chassis-v2.stl (club drive)"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>
                Estimated filament: <span className="text-primary">{estWeightG} g</span>
              </Label>
              <Slider
                min={1}
                max={500}
                step={1}
                value={[estWeightG]}
                onValueChange={([v]) => setEstWeightG(v)}
              />
            </div>
            <div className="grid gap-2">
              <Label>
                Estimated print time: <span className="text-primary">{estHours} h</span>
              </Label>
              <Slider
                min={1}
                max={24}
                step={1}
                value={[estHours]}
                onValueChange={([v]) => setEstHours(v)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-dashed p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox checked={needSlicing} onCheckedChange={(v) => setNeedSlicing(v === true)} />
              <div className="flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <LifeBuoy className="size-4 text-primary" /> I need help slicing this
                </p>
                <p className="text-xs text-muted-foreground">
                  Don't know how to slice it or don't have the software? Ask and a team member will
                  prepare it for you.
                </p>
              </div>
            </label>
            {needSlicing && (
              <Textarea
                className="mt-2"
                value={slicingNote}
                onChange={(e) => setSlicingNote(e.target.value)}
                placeholder="What do you need help with? (material, orientation, supports…)"
                rows={2}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />} Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
