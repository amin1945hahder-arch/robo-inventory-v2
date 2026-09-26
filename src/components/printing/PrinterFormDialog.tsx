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
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

/** Admin form to register a printer or edit its machine configuration. */
export function PrinterFormDialog({
  open,
  onOpenChange,
  printer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printer: Doc<"printers"> | null; // null = create
}) {
  const savePrinter = useMutation(api.printing.savePrinter);
  const updatePrinter = useMutation(api.printing.updatePrinter);

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [w, setW] = useState("");
  const [d, setD] = useState("");
  const [h, setH] = useState("");
  const [nozzle, setNozzle] = useState("0.4");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (printer) {
      setName(printer.name);
      setModel(printer.model ?? "");
      setW(printer.buildVolumeCm ? String(printer.buildVolumeCm.w) : "");
      setD(printer.buildVolumeCm ? String(printer.buildVolumeCm.d) : "");
      setH(printer.buildVolumeCm ? String(printer.buildVolumeCm.h) : "");
      setNozzle(printer.nozzleMm !== undefined ? String(printer.nozzleMm) : "0.4");
      setNote(printer.note ?? "");
    } else {
      setName("");
      setModel("");
      setW("");
      setD("");
      setH("");
      setNozzle("0.4");
      setNote("");
    }
  }, [open, printer]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const fields = {
        name: name.trim(),
        model: model.trim() || undefined,
        buildVolumeCm:
          w && d && h ? { w: Number(w), d: Number(d), h: Number(h) } : undefined,
        nozzleMm: nozzle ? Number(nozzle) : undefined,
        note: note.trim() || undefined,
      };
      if (printer) await updatePrinter({ id: printer._id, ...fields });
      else await savePrinter(fields);
      toast.success(printer ? "Printer updated." : "Printer registered.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the printer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{printer ? `Configure ${printer.name}` : "Register printer"}</DialogTitle>
          <DialogDescription>
            Machine configuration — build volume and nozzle are pushed into the embedded
            slicer so members slice against the real machine.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pr-name">Name *</Label>
              <Input
                id="pr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Farm-01 Bambu P1S"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pr-model">Model</Label>
              <Input
                id="pr-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Bambu Lab P1S"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Build volume (cm)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input value={w} onChange={(e) => setW(e.target.value)} type="number" placeholder="W 25.6" />
              <Input value={d} onChange={(e) => setD(e.target.value)} type="number" placeholder="D 25.6" />
              <Input value={h} onChange={(e) => setH(e.target.value)} type="number" placeholder="H 25.6" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pr-nozzle">Nozzle (mm)</Label>
              <Input id="pr-nozzle" value={nozzle} onChange={(e) => setNozzle(e.target.value)} type="number" step="0.1" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pr-note">Notes</Label>
              <Input
                id="pr-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="AMS unit, textured PEI plate…"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <LoadingGifInline size={18} className="size-4" />} {printer ? "Save changes" : "Add printer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
