import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

/**
 * Unit editor that works for ONE unit or a whole selection at once.
 *
 * Every field starts OFF ("(unchanged)") — only the ones the admin ticks are
 * applied to all selected units, so opening it with several units selected
 * never overwrites anything by accident. Includes "move to a different
 * group", project assignment, and the transferred state with its destination
 * setting (mutually exclusive with project / holder — a unit is either
 * transferred away or checked out to a project, never both).
 */
export function UnitEditDialog({
  open,
  onOpenChange,
  units,
  groups,
  activeProjects,
  onClose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  units: Doc<"parts">[];
  /** All groups (targets for moving units). */
  groups: Doc<"groups">[];
  activeProjects: Doc<"projects">[] | undefined;
  /** Optional extra callback (used by the bulk flow to clear selection). */
  onClose?: () => void;
}) {
  const updatePart = useMutation(api.parts.updatePart);
  const [applyStatus, setApplyStatus] = useState(false);
  const [status, setStatus] = useState<string>("available");
  const [applyNote, setApplyNote] = useState(false);
  const [note, setNote] = useState("");
  const [applyMove, setApplyMove] = useState(false);
  const [moveGroupId, setMoveGroupId] = useState("");
  const [applyProject, setApplyProject] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [applyHolder, setApplyHolder] = useState(false);
  const [holderId, setHolderId] = useState("");
  const [applyTransfer, setApplyTransfer] = useState(false);
  const [transferName, setTransferName] = useState("");
  const [busy, setBusy] = useState(false);

  const many = units.length > 1;

  useEffect(() => {
    if (open) {
      // Reset every field to unchanged; single-unit mode pre-fills with the
      // unit's current values for a familiar quick edit.
      const u = units[0];
      setApplyStatus(false);
      setStatus(u?.status ?? "available");
      setApplyNote(false);
      setNote(u?.note ?? "");
      setApplyMove(false);
      setMoveGroupId("");
      setApplyProject(false);
      setProjectId(u?.currentProjectId ?? "");
      setApplyHolder(false);
      setHolderId(u?.currentHolderId ?? "");
      setApplyTransfer(false);
      setTransferName(u?.transferToName ?? "");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onStatusChange = (s: string) => {
    setStatus(s);
    // A unit is EITHER transferred away OR checked out (project / holder) —
    // picking one clears the others' selections instead of erroring later.
    if (s === "transferred" && applyProject) {
      setApplyProject(false);
      setProjectId("");
    }
    if (s === "transferred" && applyHolder) {
      setApplyHolder(false);
      setHolderId("");
    }
    if ((s === "on_project" || s === "rented") && applyTransfer) {
      setApplyTransfer(false);
      setTransferName("");
    }
  };

  const submit = async () => {
    if (units.length === 0) return;
    if (applyMove && !moveGroupId) {
      toast.error("Pick the group to move these units into");
      return;
    }
    if (applyStatus && applyProject && status === "transferred") {
      toast.error("A transferred unit cannot be on a project");
      return;
    }
    if (applyStatus && applyHolder && status === "transferred") {
      toast.error("A transferred unit has no holder");
      return;
    }
    if (applyStatus && applyTransfer && status !== "transferred") {
      toast.error("Transfer details apply only when the status is transferred");
      return;
    }
    if (applyStatus && status === "transferred" && applyTransfer && !transferName.trim()) {
      toast.error("Enter where the unit was transferred to");
      return;
    }
    setBusy(true);
    let ok = 0;
    try {
      for (const u of units) {
        try {
          // Deliberate "wants" logic: a non-transfer status implicitly clears
          // the transfer destination; "transferred" clears project + holder.
          const nextTransfer =
            applyStatus && status === "transferred"
              ? applyTransfer
                ? transferName.trim()
                : u.transferToName ?? ""
              : "";
          await updatePart({
            id: u._id,
            ...(applyStatus ? { status: status as any } : {}),
            ...(applyNote ? { note } : {}),
            ...(applyMove && moveGroupId ? { moveGroupId: moveGroupId as Id<"groups"> } : {}),
            // Project and transfer are mutually exclusive.
            ...(applyProject
              ? { projectId: (projectId || null) as Id<"projects"> | null }
              : { projectId: null }),
            ...(applyHolder
              ? { holderId: (holderId || null) as Id<"users"> | null }
              : {}),
            ...(applyTransfer || nextTransfer !== undefined
              ? { transferToName: nextTransfer }
              : {}),
          });
          ok += 1;
        } catch (e) {
          toast.error(
            `${u.tag}: ${e instanceof Error ? e.message : "update failed"}`,
          );
        }
      }
      if (ok > 0) toast.success(`${ok} unit(s) updated`);
      onOpenChange(false);
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {many ? `Edit ${units.length} units` : `Edit unit ${units[0]?.tag ?? ""}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          {many && (
            <p className="text-xs text-muted-foreground">
              Only the fields you tick below are applied — everything else stays
              as-is on each unit.
            </p>
          )}

          <div className="flex items-start gap-2">
            <Checkbox checked={applyStatus} onCheckedChange={(v) => setApplyStatus(Boolean(v))} className="mt-1" />
            <div className="grid flex-1 gap-2">
              <Label className={applyStatus ? "" : "text-muted-foreground"}>Status</Label>
              <Select value={status} onValueChange={onStatusChange} disabled={!applyStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["available", "rented", "on_project", "transferred", "broken", "consumed"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Transferred state: destination + details. Only when the status
              is transferred (it is mutually exclusive with project/holder). */}
          {applyStatus && status === "transferred" && (
            <div className="ml-6 grid gap-2 glass-3d rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <Label className="text-xs">Transferred to *</Label>
              <Input
                value={transferName}
                onChange={(e) => setTransferName(e.target.value)}
                placeholder="e.g. Mechatronics dept., a donated school lab…"
              />
              <p className="text-xs text-muted-foreground">
                The unit leaves the circulating inventory and stays on record
                with this destination. A transferred unit cannot be on a
                project or rented at the same time.
              </p>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Checkbox checked={applyNote} onCheckedChange={(v) => setApplyNote(Boolean(v))} className="mt-1" />
            <div className="grid flex-1 gap-2">
              <Label className={applyNote ? "" : "text-muted-foreground"}>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!applyNote} />
            </div>
          </div>

          {/* Project / holder options hide while "transferred" is picked —
              a unit is either transferred away or checked out, never both. */}
          {!(applyStatus && status === "transferred") && (
            <>
              <div className="flex items-start gap-2">
                <Checkbox checked={applyProject} onCheckedChange={(v) => setApplyProject(Boolean(v))} className="mt-1" />
                <div className="grid flex-1 gap-2">
                  <Label className={applyProject ? "" : "text-muted-foreground"}>Assign to project</Label>
                  <Select value={projectId || "none"} onValueChange={(v) => setProjectId(v === "none" ? "" : v)} disabled={!applyProject}>
                    <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None (not on a project) —</SelectItem>
                      {(activeProjects ?? []).map((p) => (
                        <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Checking the unit out to a project keeps it there until the
                    project is dismantled.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox checked={applyHolder} onCheckedChange={(v) => setApplyHolder(Boolean(v))} className="mt-1" />
                <div className="grid flex-1 gap-2">
                  <Label className={applyHolder ? "" : "text-muted-foreground"}>Holder (rented to)</Label>
                  <Input
                    value={holderId}
                    onChange={(e) => setHolderId(e.target.value)}
                    placeholder="Member ID (optional)"
                    disabled={!applyHolder}
                  />
                  <p className="text-xs text-muted-foreground">
                    Advanced: paste a member ID to hand the unit over, or clear to
                    release. Status "rented" needs a holder.
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="flex items-start gap-2">
            <Checkbox checked={applyMove} onCheckedChange={(v) => setApplyMove(Boolean(v))} className="mt-1" />
            <div className="grid flex-1 gap-2">
              <Label className={applyMove ? "" : "text-muted-foreground"}>Move to group</Label>
              <Select value={moveGroupId || "none"} onValueChange={(v) => setMoveGroupId(v === "none" ? "" : v)} disabled={!applyMove}>
                <SelectTrigger><SelectValue placeholder="Pick a group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Pick a group —</SelectItem>
                  {groups
                    .filter((g) => !g.measure || g.measure === "count")
                    .filter((g) => !units.some((u) => u.groupId === g._id))
                    .map((g) => (
                      <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The unit keeps its QR tag and history; only its home card changes.
                Shelf units only (available / broken).
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || units.length === 0}>
            {busy ? <LoadingGifInline size={18} className="size-4" /> : null}
            {busy ? "Applying…" : `Apply to ${units.length} unit${units.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
