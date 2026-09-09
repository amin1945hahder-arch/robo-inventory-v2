import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; className: string }> = {
  available: { label: "Available", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  pending: { label: "Pending", className: "border-amber-200 bg-amber-50 text-amber-700" },
  rented: { label: "Rented", className: "border-sky-200 bg-sky-50 text-sky-700" },
  on_project: { label: "On project", className: "border-violet-200 bg-violet-50 text-violet-700" },
  broken: { label: "Broken", className: "border-rose-200 bg-rose-50 text-rose-700" },
  active: { label: "Active", className: "border-sky-200 bg-sky-50 text-sky-700" },
  on_project_rental: { label: "On project", className: "border-violet-200 bg-violet-50 text-violet-700" },
  returned: { label: "Returned", className: "border-zinc-200 bg-zinc-50 text-zinc-600" },
  approved: { label: "Approved", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  denied: { label: "Denied", className: "border-rose-200 bg-rose-50 text-rose-700" },
  canceled: { label: "Canceled", className: "border-zinc-200 bg-zinc-50 text-zinc-600" },
  completed: { label: "Completed", className: "border-zinc-200 bg-zinc-50 text-zinc-600" },
  dismantled: { label: "Dismantled", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = MAP[status] ?? { label: status, className: "border-border bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className, className)}>
      {cfg.label}
    </Badge>
  );
}
