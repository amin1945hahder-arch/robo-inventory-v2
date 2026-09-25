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
 * group": the unit keeps its QR tag but changes its home card.
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
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (units.length === 0) return;
    if (applyMove && !moveGroupId) {
      toast.error("Pick the group to move these units into");
      return;
    }
    if (applyStatus && applyProject && status !== "on_project") {
      toast.error("Project assignment sets the status to on_project");
      return;
    }
    setBusy(true);
    let ok = 0;
    try {
      for (const u of units) {
        try {
          await updatePart({
            id: u._id,
            ...(applyStatus ? { status: status as any } : {}),
            ...(applyNote ? { note } : {}),
            ...(applyMove && moveGroupId ? { moveGroupId: moveGroupId as Id<"groups"> } : {}),
            ...(applyProject
              ? { projectId: (projectId || null) as Id<"projects"> | null }
              : {}),
            ...(applyHolder
              ? { holderId: (holderId || null) as Id<"users"> | null }
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
              <Select value={status} onValueChange={setStatus} disabled={!applyStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["available", "rented", "on_project", "broken", "transferred", "consumed"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox checked={applyNote} onCheckedChange={(v) => setApplyNote(Boolean(v))} className="mt-1" />
            <div className="grid flex-1 gap-2">
              <Label className={applyNote ? "" : "text-muted-foreground"}>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!applyNote} />
            </div>
          </div>

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
                release. Status “rented” needs a holder.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || units.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Applying…" : `Apply to ${units.length} unit${units.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
