import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { projectQr } from "@/lib/qr";
import { toast } from "sonner";
import { FolderKanban, Plus } from "lucide-react";

export default function Projects() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const projects = useQuery(api.projects.listProjects, {});
  const upsert = useMutation(api.projects.upsertProject);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const active = (projects ?? []).filter((p) => p.status === "active");
  const past = (projects ?? []).filter((p) => p.status !== "active");

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await upsert({ name: name.trim(), description: description.trim() || undefined, status: "active" });
      toast.success("Project created");
      setOpen(false);
      setName("");
      setDescription("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Parts assigned to a project stay checked out until it's dismantled.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New project
            </Button>
          )}
        </header>

        {projects === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((p) => (
                <Card key={p._id} className="group relative overflow-hidden border-border/80 shadow-none transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/projects/${p._id}`} className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold">{p.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {p.description ?? "Club project"}
                        </p>
                      </Link>
                      <QrChip payload={projectQr(p._id)} label={p.name} />
                    </div>
                    <StatusBadge status={p.status} />
                  </CardContent>
                </Card>
              ))}
              {active.length === 0 && (
                <div className="col-span-full flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
                  <FolderKanban className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No active projects yet.</p>
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Completed & dismantled</h2>
                <ul className="divide-y rounded-lg border">
                  {past.map((p) => (
                    <li key={p._id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <Link to={`/projects/${p._id}`} className="truncate text-sm font-medium">
                        {p.name}
                      </Link>
                      <StatusBadge status={p.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Line Follower 2026" />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
