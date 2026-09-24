import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { QrChip } from "@/components/QrChip";
import { groupQr } from "@/lib/qr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Doc } from "@/convex/_generated/dataModel";
import { Link } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  FolderInput,
  MoreHorizontal,
  Package,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

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
  containedGroups,
}: {
  group: Doc<"groups">;
  stats?: GroupStats;
  categoryName?: string;
  isAdmin: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Master containers: the groups inside — shown on the card instead of
      unit stats, so the outside view matches the inside view. */
  containedGroups?: Doc<"groups">[];
}) {
  const s: GroupStats =
    stats ?? { total: 0, available: 0, rented: 0, onProject: 0, broken: 0, pending: 0, transferred: 0, consumed: 0 };
  const total = Math.max(s.total, 1);
  // A card that was handed the list of groups it contains renders as a
  // master container (outside view mirrors the inside view).
  const isMasterView = Boolean(containedGroups?.length);

  // "Move to inside group" dialog: pick a container group to place this
  // group's card inside (its own subtree is filtered out to avoid loops).
  const move = useMutation(api.catalog.moveGroupToContainer);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);
  const allGroups = useQuery(api.catalog.childGroupOptions, moveOpen ? {} : "skip");

  const descendantIds = (rootId: string): string[] => {
    const out: string[] = [];
    const walk = (pid: string) => {
      for (const g of allGroups ?? []) {
        if (g.parentGroupId === pid) {
          out.push(g._id);
          walk(g._id);
        }
      }
    };
    walk(rootId);
    return out;
  };

  useEffect(() => {
    if (moveOpen) {
      setMoveTarget(group.parentGroupId ?? "");
    }
  }, [moveOpen, group.parentGroupId]);

  // Bulk (weight/length) groups hold material, not groups — never containers.
  const moveOptions = (allGroups ?? []).filter(
    (g) =>
      g._id !== group._id &&
      !descendantIds(group._id).includes(g._id) &&
      (!g.measure || g.measure === "count"),
  );
  const chosenMoveTarget = (allGroups ?? []).find((g) => g._id === moveTarget);

  const submitMove = async () => {
    setMoveBusy(true);
    try {
      await move({ groupId: group._id, parentGroupId: (moveTarget || null) as any });
      toast.success(
        moveTarget
          ? `Moved “${group.name}” inside “${chosenMoveTarget?.name ?? "container"}”`
          : `“${group.name}” moved to the top level`,
      );
      setMoveOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move group");
    } finally {
      setMoveBusy(false);
    }
  };

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
                  <DropdownMenuItem onClick={() => setMoveOpen(true)}>
                    <FolderInput className="size-4" /> Move to inside group
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

        {isMasterView ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              📦 Master container ·{" "}
              <b className="text-foreground">{containedGroups!.length}</b>{" "}
              group{containedGroups!.length === 1 ? "" : "s"} inside
            </p>
            <div className="flex flex-wrap gap-1.5">
              {containedGroups!.map((child) => (
                <Link
                  key={child._id}
                  to={`/group/${child._id}`}
                  className="rounded-full border px-2.5 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary"
                >
                  {child.name}
                </Link>
              ))}
            </div>
          </div>
        ) : (
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
        )}
      </CardContent>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move “{group.name}” inside a group</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <Select value={moveTarget || "none"} onValueChange={(v) => setMoveTarget(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a container group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not inside anything (top level)</SelectItem>
                {moveOptions.map((g) => (
                  <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {chosenMoveTarget
                ? `Its card will appear inside “${chosenMoveTarget.name}”. Containers hold groups only — no units are added to them.`
                : "Pick a container (box/bag) — its page will show this group's card. You can also move it back to the top level."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button onClick={submitMove} disabled={moveBusy}>
              <Package className="size-4" /> {moveBusy ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
