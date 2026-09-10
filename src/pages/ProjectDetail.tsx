import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { projectQr, unitQr } from "@/lib/qr";
import { toast } from "sonner";
import { ArrowLeft, PackageX, RotateCcw, Trash2 } from "lucide-react";

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const data = useQuery(api.projects.getProject, id ? { id: id as any } : "skip");
  const dismantle = useMutation(api.projects.dismantleProject);
  const complete = useMutation(api.projects.completeProject);
  const reactivate = useMutation(api.projects.reactivateProject);
  const deleteProject = useMutation(api.projects.deleteProject);

  const [dismantleOpen, setDismantleOpen] = useState(false);
  const [functional, setFunctional] = useState(true);
  const [busy, setBusy] = useState(false);

  if (data === undefined) {
    return (
      <AppShell>
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }
  if (data === null || data.project === null) {
    return (
      <AppShell>
        <p className="py-16 text-center text-sm text-muted-foreground">Project not found.</p>
      </AppShell>
    );
  }

  const { project, parts } = data;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
            <ArrowLeft className="size-4" /> Projects
          </Button>
        </div>

        <header className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
          <div className="flex items-start gap-3">
            <QrChip payload={projectQr(project._id)} label={project.name} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {project.description ?? "Club project"}
              </p>
              <div className="mt-2">
                <StatusBadge status={project.status} />
              </div>
            </div>
          </div>
          {isAdmin && project.status === "active" && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={async () => {
                try {
                  await complete({ id: project._id });
                  toast.success("Marked completed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}>
                Mark completed
              </Button>
              <Button variant="outline" className="text-destructive" onClick={() => setDismantleOpen(true)}>
                <PackageX className="size-4" /> Dismantle
              </Button>
            </div>
          )}
          {isAdmin && project.status !== "active" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await reactivate({ id: project._id });
                    toast.success("Project reactivated — parts can be assigned again");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                <RotateCcw className="size-4" /> Reactivate
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={async () => {
                  try {
                    await deleteProject({ id: project._id });
                    toast.success("Project deleted");
                    navigate("/projects");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                <Trash2 className="size-4" /> Delete record
              </Button>
            </div>
          )}
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            Checked-out parts · {parts.length}
          </h2>
          {parts.length === 0 ? (
            <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              No parts assigned to this project yet. An admin can assign rented parts here during a
              return, or from the unit page.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {parts.map(({ part, group }) => (
                <li key={part._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <QrChip payload={unitQr(part.tag)} label={`${group?.name ?? "Unit"} · ${part.tag}`} />
                  <Link to={`/part/${part._id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{group?.name ?? "Unit"}</p>
                    <p className="font-mono text-xs text-muted-foreground">{part.tag}</p>
                  </Link>
                  {part.note && (
                    <p className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block">
                      {part.note}
                    </p>
                  )}
                  <StatusBadge status={part.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={dismantleOpen} onOpenChange={setDismantleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dismantle “{project.name}”?</DialogTitle>
            <DialogDescription>
              All {parts.length} checked-out part{parts.length === 1 ? "" : "s"} will be released back
              to the inventory. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Label>Condition of parts</Label>
            <RadioGroup value={functional ? "ok" : "broken"} onValueChange={(v) => setFunctional(v === "ok")} className="flex gap-2">
              <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 ${functional ? "border-foreground" : ""}`}>
                <RadioGroupItem value="ok" />
                <span className="text-sm">Working — back to shelf</span>
              </label>
              <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 ${!functional ? "border-foreground" : ""}`}>
                <RadioGroupItem value="broken" />
                <span className="text-sm">Broken — repair pile</span>
              </label>
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismantleOpen(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await dismantle({ id: project._id, functional });
                  toast.success("Project dismantled — parts released");
                  setDismantleOpen(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Dismantle project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
