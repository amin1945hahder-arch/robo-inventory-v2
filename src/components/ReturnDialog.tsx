import { useEffect, useMemo, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
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
import { asMessage } from "@/components/EditRentalDialog";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DocAttachmentField,
  type AttachedDoc,
} from "@/components/DocAttachmentField";
import type { Doc } from "@/convex/_generated/dataModel";

export type ReturnDestination = "shelf" | "project" | "transferred";

/** Admin-only flow: return to shelf, assign to a project, or transfer out. */
export function ReturnDialog({
  open,
  onOpenChange,
  rentalId,
  partTag,
  groupName,
  partId,
  rentalAmount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rentalId: string;
  partTag: string;
  groupName: string;
  partId: string;
  /** Bulk rentals: the amount taken (kg/m), when present. */
  rentalAmount?: number;
}) {
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const act = useMutation(api.parts.adminRentalAction);
  // Group + category of the unit: drives the consumable recovered-amount form.
  const partData = useQuery(api.parts.getPartWithRental, { id: partId as any });
  const group = partData?.group;
  const isBulk = group?.measure === "weight" || group?.measure === "length";
  // Measurable stock asks how much came back unless the category is explicitly
  // non-consumable (then everything taken is expected back whole).
  const consumableForm = isBulk && rentalAmount !== undefined && partData?.category?.consumable !== false;

  const [destination, setDestination] = useState<ReturnDestination>("shelf");
  const [functional, setFunctional] = useState<boolean | null>(null);
  const [report, setReport] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Transfer fields.
  const [transferName, setTransferName] = useState("");
  const [transferDetails, setTransferDetails] = useState("");
  const [transferDoc, setTransferDoc] = useState<AttachedDoc | null>(null);
  // Bulk consumable return: how much of the taken amount physically came back.
  const [recovered, setRecovered] = useState("");
  const [busy, setBusy] = useState(false);

  const createProject = useMutation(api.projects.upsertProject);

  useEffect(() => {
    if (!open) {
      setDestination("shelf");
      setFunctional(null);
      setReport("");
      setProjectId("");
      setCreating(false);
      setNewName("");
      setTransferName("");
      setTransferDetails("");
      setTransferDoc(null);
      setRecovered("");
    }
  }, [open]);

  const unitLabel = group?.measureUnit ?? "";
  const taken = rentalAmount ?? 0;

  const valid = useMemo(() => {
    if (functional === null) return false;
    if (destination === "project") {
      if (creating) return newName.trim().length > 1;
      return Boolean(projectId);
    }
    if (destination === "transferred") {
      return transferName.trim().length > 1;
    }
    return true;
  }, [functional, destination, creating, newName, projectId, transferName]);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (destination === "project") {
        let target = projectId;
        if (creating) {
          target = await createProject({ name: newName.trim(), status: "active" });
        }
        await act({
          rentalId: rentalId as any,
          action: "assign_project",
          projectId: target as any,
          functional: functional ?? true,
          conditionReport: report.trim() || undefined,
        });
        toast.success(`Assigned to ${creating ? newName.trim() : "project"}`);
      } else if (destination === "transferred") {
        await act({
          rentalId: rentalId as any,
          action: "transfer",
          transferToName: transferName.trim(),
          transferDetails: transferDetails.trim() || undefined,
          transferDoc: transferDoc ?? undefined,
          functional: functional ?? true,
          conditionReport: report.trim() || undefined,
        });
        toast.success(`Transferred to “${transferName.trim()}” — kept on record`);
      } else {
        const recoveredNum =
          consumableForm && recovered.trim() !== "" ? Number(recovered) : undefined;
        if (consumableForm && recovered.trim() !== "") {
          if (!Number.isFinite(recoveredNum) || (recoveredNum as number) < 0) {
            toast.error(`Enter the recovered amount in ${unitLabel}`);
            setBusy(false);
            return;
          }
          if ((recoveredNum as number) > taken + 1e-9) {
            toast.error(`Recovered cannot exceed the taken ${taken} ${unitLabel}`);
            setBusy(false);
            return;
          }
        }
        await act({
          rentalId: rentalId as any,
          action: "mark_returned",
          functional: functional ?? true,
          conditionReport: report.trim() || undefined,
          ...(consumableForm && recoveredNum !== undefined
            ? { recoveredAmount: recoveredNum }
            : {}),
        });
        toast.success(functional ? "Returned to shelf" : "Marked broken and shelved");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Process return</DialogTitle>
          <DialogDescription>
            {groupName} — unit {partTag}. Decide where this unit goes next and record its condition.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <RadioGroup
            value={destination}
            onValueChange={(v) => setDestination(v as ReturnDestination)}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${destination === "shelf" ? "border-foreground" : ""}`}
            >
              <RadioGroupItem value="shelf" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Return to shelf</p>
                <p className="text-xs text-muted-foreground">Back to its storage, available for rent again.</p>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${destination === "project" ? "border-foreground" : ""}`}
            >
              <RadioGroupItem value="project" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Assign to project</p>
                <p className="text-xs text-muted-foreground">Stays checked out until the project is dismantled.</p>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${destination === "transferred" ? "border-foreground" : ""}`}
            >
              <RadioGroupItem value="transferred" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Transferred to</p>
                <p className="text-xs text-muted-foreground">Handed to another department/lab — kept on record.</p>
              </div>
            </label>
          </RadioGroup>

          {destination === "project" && (
            <div className="flex flex-col gap-2">
              <Label>Project</Label>
              {!creating ? (
                <div className="flex gap-2">
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an active project" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects ?? []).map((p) => (
                        <SelectItem key={p._id} value={p._id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setCreating(true)}>
                    New
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New project name"
                  />
                  <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}

          {destination === "transferred" && (
            <div className="flex flex-col gap-2">
              <Label>Transfer destination name</Label>
              <Input
                value={transferName}
                onChange={(e) => setTransferName(e.target.value)}
                placeholder="e.g. Mechatronics dept., Al-Amal school lab…"
              />
              <Label>Details</Label>
              <Textarea
                value={transferDetails}
                onChange={(e) => setTransferDetails(e.target.value)}
                placeholder="Who received it, why, reference number…"
                rows={2}
              />
              <DocAttachmentField doc={transferDoc} onChange={setTransferDoc} />
            </div>
          )}

          {consumableForm && destination === "shelf" && (
            <div className="flex flex-col gap-2 glass-3d rounded-lg border bg-muted/30 p-3">
              <Label>
                Amount recovered ({unitLabel}) — taken: {taken} {unitLabel}
              </Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={recovered}
                onChange={(e) => setRecovered(e.target.value)}
                placeholder={`What physically came back (≤ ${taken} ${unitLabel})`}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to shelve all of it. The difference is logged as consumed on the unit —
                e.g. take 2 kg, recover 1.4 kg → 0.6 kg consumed.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Condition check</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={functional === true ? "default" : "outline"}
                className="flex-1"
                onClick={() => setFunctional(true)}
              >
                <StatusBadge status="approved" className="mr-2 border-0 bg-transparent p-0" />
                Works fine
              </Button>
              <Button
                type="button"
                variant={functional === false ? "default" : "outline"}
                className="flex-1"
                onClick={() => setFunctional(false)}
              >
                Needs repair
              </Button>
            </div>
            <Textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              placeholder="Anything to note about this unit? (missing cable, scratched pins…)"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
