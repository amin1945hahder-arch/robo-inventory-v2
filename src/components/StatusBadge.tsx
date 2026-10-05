import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; className: string }> = {
  available: { label: "Available", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  pending: { label: "Pending", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  rented: { label: "Rented", className: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  on_project: { label: "On project", className: "border-violet-500/40 bg-violet-500/10 text-violet-400" },
  broken: { label: "Broken", className: "border-rose-500/40 bg-rose-500/10 text-rose-400" },
  transferred: { label: "Transferred", className: "border-orange-500/40 bg-orange-500/10 text-orange-400" },
  consumed: { label: "Consumed", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400" },
  active: { label: "Active", className: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  on_project_rental: { label: "On project", className: "border-violet-500/40 bg-violet-500/10 text-violet-400" },
  returned: { label: "Returned", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400" },
  approved: { label: "Approved · pick up", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  taken: { label: "Taken", className: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  denied: { label: "Denied", className: "border-rose-500/40 bg-rose-500/10 text-rose-400" },
  canceled: { label: "Canceled", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400" },
  completed: { label: "Completed", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400" },
  dismantled: { label: "Dismantled", className: "border-rose-500/40 bg-rose-500/10 text-rose-400" },
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const key = status == null ? "" : String(status);
  const cfg = MAP[key] ?? { label: key || "—", className: "border-border bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className, className)}>
      {cfg.label}
    </Badge>
  );
}
