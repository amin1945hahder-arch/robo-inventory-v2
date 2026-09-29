import { useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Box,
  FileCode2,
  FileUp,
  LifeBuoy,
  Loader2,
  PrinterCheck,
  Scissors,
  Send,
  Upload,
} from "lucide-react";

const GCODE_EXT = /\.(gcode|gco|g)$/i;
const STL_EXT = /\.(stl|3mf|obj|step|stp)$/i;

type FileKind = "gcode" | "model" | null;

/** Submit a new print request with a part BROWSED from the device. */
export function NewJobDialog({
  open,
  onOpenChange,
  onGoToSlicer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoToSlicer: () => void;
}) {
  const createJob = useMutation(api.printing.createJob);
  const generateUploadUrl = useMutation(api.printing.generateUploadUrl);
  const relayPrintFile = useAction(api.telegram.relayPrintFile);

  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<FileKind>(null);
  const [estWeightG, setEstWeightG] = useState<number>(30);
  const [estHours, setEstHours] = useState<number>(2);
  const [needSlicing, setNeedSlicing] = useState(false);
  const [slicingNote, setSlicingNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName("");
    setDetails("");
    setFile(null);
    setFileKind(null);
    setSlicingNote("");
    setNeedSlicing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onPickFile = (picked: File | null) => {
    setFile(picked);
    if (!picked) {
      setFileKind(null);
      return;
    }
    if (GCODE_EXT.test(picked.name)) {
      setFileKind("gcode");
      setNeedSlicing(false);
    } else if (STL_EXT.test(picked.name)) {
      setFileKind("model");
      setNeedSlicing(false);
    } else {
      setFileKind(null);
    }
  };

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      // --- Path 1: ready-to-print G-code → relay to printer group, request approval.
      if (file && fileKind === "gcode") {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) throw new Error("Uploading the file failed — try again");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

        await createJob({
          name: name.trim(),
          details: details.trim() || undefined,
          fileName: file.name,
          fileSizeKb: Math.round(file.size / 1024),
          estWeightG: estWeightG || undefined,
          estMinutes: estHours ? Math.round(estHours * 60) : undefined,
        });
        const relay = await relayPrintFile({
          storageId,
          fileName: file.name,
          caption: `🧾 Print request: ${name.trim()} — ${estWeightG || "?"} g est. — awaiting approval`,
        });
        if (!relay.sent) {
          toast.warning(
            relay.reason === "no-printer-group-chat-id"
              ? "Request saved, but no printer Telegram group is configured — ask an admin to set one in Settings."
              : "Request saved, but relaying the file to the printer group failed.",
          );
        } else {
          toast.success("G-code sent to the printer group — request awaiting approval.");
        }
        onOpenChange(false);
        reset();
        return;
      }

      // --- Path 2: model file (STL/3MF/…) → send the member to Slicer Studio.
      if (file && fileKind === "model") {
        toast.info(`${file.name} is a 3D model — let's slice it first.`, {
          description: "Slicer Studio is opening: load the model there, slice it, then submit the G-code.",
        });
        onOpenChange(false);
        onGoToSlicer();
        reset();
        return;
      }

      // --- Path 3: no file or explicit "need help" → slicing-help request.
      await createJob({
        name: name.trim(),
        details: details.trim() || undefined,
        estWeightG: estWeightG || undefined,
        estMinutes: estHours ? Math.round(estHours * 60) : undefined,
        needSlicing: needSlicing || !file,
        slicingNote: slicingNote.trim() || undefined,
      });
      toast.success("Print request submitted — the team has been notified.");
      onOpenChange(false);
      reset();
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
            Browse the part file from your device — it is never stored in the app. G-code goes
            straight to the printer group; models are sliced in Slicer Studio.
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
            <Label>Part file</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 glass-3d rounded-lg border border-dashed border-border/70 bg-muted/30 px-4 py-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                {fileKind === "gcode" ? (
                  <FileCode2 className="size-5" />
                ) : fileKind === "model" ? (
                  <Box className="size-5" />
                ) : (
                  <Upload className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                {file ? (
                  <>
                    <span className="block truncate text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                      {fileKind === "gcode"
                        ? "ready-to-print — will be relayed to the printer group"
                        : fileKind === "model"
                          ? "3D model — you'll be taken to Slicer Studio"
                          : "unrecognized type — choose a .gcode or .stl file"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-sm font-medium">Browse for the part file…</span>
                    <span className="text-xs text-muted-foreground">
                      .gcode / .stl / .3mf / .step — nothing is uploaded to the database
                    </span>
                  </>
                )}
              </span>
              <FileUp className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".stl,.3mf,.obj,.step,.stp,.gcode,.gco,.g"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Guidance card that reacts to the picked file type */}
          {fileKind === "gcode" && (
            <div className="flex items-start gap-2.5 glass-3d rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
              <PrinterCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>
                <span className="font-medium text-primary">Ready to print.</span> On submit, the
                G-code is relayed to the printer Telegram group as the archive copy and the request
                waits for an admin/printer approval before scheduling.
              </p>
            </div>
          )}
          {fileKind === "model" && (
            <div className="flex items-start gap-2.5 glass-3d rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
              <Scissors className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <p>
                <span className="font-medium text-amber-500">Needs slicing.</span> Submitting opens
                Slicer Studio — load {file?.name ?? "the model"} there, set material and printer,
                then hand the sliced job back for approval.
              </p>
            </div>
          )}

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

          {!file && (
            <div className="glass-3d rounded-lg border border-dashed p-3">
              <label className="flex cursor-pointer items-center gap-3">
                <Checkbox
                  checked={needSlicing}
                  onCheckedChange={(v) => setNeedSlicing(v === true)}
                />
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <LifeBuoy className="size-4 text-primary" /> I need help slicing this
                  </p>
                  <p className="text-xs text-muted-foreground">
                    No file handy or unsure how to slice? Ask and a team member will prepare it for
                    you.
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !name.trim() || (!!file && fileKind === null)}
          >
            {busy && <LoadingGifInline size={18} className="size-4" />}
            {fileKind === "gcode" ? (
              <>
                <Send className="size-4" /> Send G-code for approval
              </>
            ) : fileKind === "model" ? (
              <>
                <Scissors className="size-4" /> Open Slicer Studio
              </>
            ) : (
              "Submit request"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
