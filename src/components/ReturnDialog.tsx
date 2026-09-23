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
import { StatusBadge } from "@/components/StatusBadge";

/** Admin-only flow for handling an active rental: return to shelf, or assign to a project. */
export function ReturnDialog({
  open,
  onOpenChange,
  rentalId,
  partTag,
  groupName,
  partId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rentalId: string;
  partTag: string;
  groupName: string;
  partId: string;
}) {
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const markReturned = useMutation(api.parts.adminRentalAction);
  const [destination, setDestination] = useState<"shelf" | "project">("shelf");
  const [functional, setFunctional] = useState<boolean | null>(null);
  const [report, setReport] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
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
    }
  }, [open]);

  const valid = useMemo(() => {
    if (functional === null) return false;
    if (destination === "project") {
      if (creating) return newName.trim().length > 1;
      return Boolean(projectId);
    }
    return true;
  }, [functional, destination, creating, newName, projectId]);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      let target = projectId;
      if (destination === "project") {
        if (creating) {
          target = await createProject({ name: newName.trim(), status: "active" });
        }
        await markReturned({
          rentalId: rentalId as any,
          action: "assign_project",
          projectId: target as any,
          functional: functional ?? true,
          conditionReport: report.trim() || undefined,
        });
        toast.success(`Assigned to ${creating ? newName.trim() : "project"}`);
      } else {
        await markReturned({
          rentalId: rentalId as any,
          action: "mark_returned",
          functional: functional ?? true,
          conditionReport: report.trim() || undefined,
        });
        toast.success(functional ? "Returned to shelf" : "Marked broken and shelved");
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Process return</DialogTitle>
          <DialogDescription>
            {groupName} — unit {partTag}. Decide where this unit goes next and record its condition.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <RadioGroup
            value={destination}
            onValueChange={(v) => setDestination(v as "shelf" | "project")}
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
