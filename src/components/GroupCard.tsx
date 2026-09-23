import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { QrChip } from "@/components/QrChip";
import { groupQr } from "@/lib/qr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Doc } from "@/convex/_generated/dataModel";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export interface GroupStats {
  total: number;
  available: number;
  rented: number;
  onProject: number;
  broken: number;
  pending: number;
  transferred?: number;
  consumed?: number;
}

export function GroupCard({
  group,
  stats,
  categoryName,
  isAdmin,
  onEdit,
  onDelete,
}: {
  group: Doc<"groups">;
  stats?: GroupStats;
  categoryName?: string;
  isAdmin: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const s: GroupStats =
    stats ?? { total: 0, available: 0, rented: 0, onProject: 0, broken: 0, pending: 0, transferred: 0, consumed: 0 };
  const total = Math.max(s.total, 1);
  return (
    <Card className="group relative overflow-hidden border-border/80 shadow-none transition-colors hover:border-primary/40">
      <CardContent className="flex flex-col gap-3 p-5">
        {group.imageUrl && (
          <img
            src={group.imageUrl}
            alt={group.name}
            className="aspect-[16/9] w-full rounded-md border object-cover"
          />
        )}
        <div className="flex items-start justify-between gap-3">
          <Link to={`/group/${group._id}`} className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {categoryName ?? "Component"}
            </p>
            <h3 className="mt-1 truncate text-base font-semibold leading-tight">
              {group.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {group.parentGroupId ? "📦 Container · " : ""}
              {[group.brand, group.model].filter(Boolean).join(" · ") || "—"}
            </p>
          </Link>
          <div className="flex items-center gap-1.5">
            <QrChip payload={groupQr(group._id)} label={group.name} />
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7 shrink-0">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="size-4" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <Link to={`/group/${group._id}`} className="block">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-emerald-500/80" style={{ width: `${(s.available / total) * 100}%` }} />
            <div className="bg-sky-500/80" style={{ width: `${(s.rented / total) * 100}%` }} />
            <div className="bg-violet-500/80" style={{ width: `${(s.onProject / total) * 100}%` }} />
            <div className="bg-amber-500/80" style={{ width: `${(s.pending / total) * 100}%` }} />
            <div className="bg-rose-500/80" style={{ width: `${(s.broken / total) * 100}%` }} />
            <div className="bg-orange-500/80" style={{ width: `${((s.transferred ?? 0) / total) * 100}%` }} />
            <div className="bg-zinc-500/80" style={{ width: `${((s.consumed ?? 0) / total) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span><b className="text-foreground">{s.available}</b> available</span>
            <span><b className="text-foreground">{s.rented}</b> rented</span>
            <span><b className="text-foreground">{s.onProject}</b> on project</span>
            <span><b className="text-foreground">{s.broken}</b> broken</span>
            {(s.transferred ?? 0) > 0 && (
              <span className="text-orange-400"><b>{s.transferred}</b> transferred</span>
            )}
            {(s.consumed ?? 0) > 0 && (
              <span><b className="text-foreground">{s.consumed}</b> consumed</span>
            )}
            <span className="ml-auto font-medium text-foreground">{s.total} total</span>
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}
