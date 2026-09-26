import { useEffect, useMemo, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { QrScanDialog } from "@/components/QrScanDialog";
import { normalizeScan } from "@/lib/qr";
import { matchesSearch } from "@/lib/searchText";
import {
  groupAllowedByFilter,
  scanOutcome,
  upsertLine,
  type PackageLine,
  type ScanFilter,
} from "@/lib/package-scan";
import { toast } from "sonner";
import { describePackSize, isPackGroup } from "@/lib/group-measure";
import { Loader2, Package, Plus, ScanLine, Trash2, X } from "lucide-react";

type Line = PackageLine;

/**
 * Build (or edit) a package rental: several items, each with a quantity,
 * submitted as ONE request that admins approve in a single click.
 */
export function PackageBuilderDialog({
  open,
  onOpenChange,
  presetGroupId,
  editPackageId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetGroupId?: string;
  editPackageId?: string | null;
  onDone?: () => void;
}) {
  const groups = useQuery(api.catalog.listGroups, open ? {} : "skip");
  // Unit tags/notes join into the search: typing a unit tag finds its group.
  const unitRows = useQuery(api.parts.listPartsByGroups, open ? {} : "skip");
  const availability = useQuery(api.parts.availabilityByGroup, open ? {} : "skip");
  const existing = useQuery(
    api.parts.getPackage,
    open && editPackageId ? { id: editPackageId as any } : "skip",
  );

  const createPackage = useMutation(api.parts.createPackage);
  const editPackage = useMutation(api.parts.editPackage);

  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // QR scanning: a unit/group label adds a line, a category/storage label
  // narrows the item dropdown to the available items of that scope.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFilter, setScanFilter] = useState<ScanFilter>(null);
  const [scanQuery, setScanQuery] = useState("");

  // Load an existing pending package for editing, or seed with the group the
  // user came from (quantity pre-set to 1 so they just bump the number).
  useEffect(() => {
    if (!open) return;
    if (editPackageId && existing) {
      setLines(existing.package.lines.map((l: any) => ({ groupId: l.groupId, count: l.count, note: l.note })));
      setNote(existing.package.note ?? "");
    } else if (!editPackageId && presetGroupId) {
      setLines([{ groupId: presetGroupId, count: 1 }]);
      setNote("");
    } else if (!editPackageId) {
      setLines([]);
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editPackageId, presetGroupId, existing]);

  // Reset the scan filter each time the dialog opens.
  useEffect(() => {
    if (!open) {
      setScanFilter(null);
      setScanQuery("");
      setScanOpen(false);
    }
  }, [open]);

  const groupById = useMemo(() => {
    const m = new Map<string, { _id: string; name: string }>();
    for (const g of groups ?? []) m.set(g._id, g);
    return m;
  }, [groups]);

  const maxFor = (groupId: string) => availability?.[groupId]?.available ?? 0;

  // Dropdown content: groups filtered by the scanned category/storage (and the
  // free-text search), each with its live availability count.
  const dropdownGroups = useMemo(() => {
    const unitsByGroup = new Map<string, string>();
    for (const p of unitRows ?? []) {
      unitsByGroup.set(p.groupId, [unitsByGroup.get(p.groupId), p.tag, p.note].filter(Boolean).join(" "));
    }
    return (groups ?? []).filter(
      (g: any) =>
        groupAllowedByFilter({ categoryId: g.categoryId, closetId: g.closetId }, scanFilter) &&
        matchesSearch(g, scanQuery, unitsByGroup.get(g._id)),
    );
  }, [groups, unitRows, scanFilter, scanQuery]);

  // QR scans resolve through the server lookup query (same resolver the QR
  // route uses): set the payload, the query resolves, the effect applies it.
  const [scanPayload, setScanPayload] = useState<string | null>(null);
  const scanResolved = useQuery(
    api.lookup.resolve,
    scanPayload ? { payload: scanPayload } : "skip",
  );

  useEffect(() => {
    if (!scanPayload || scanResolved === undefined) return;
    setScanPayload(null);
    const out = scanOutcome(scanResolved as any);
    if (out.action === "add-line") {
      const g = (groups ?? []).find((x: any) => x._id === out.groupId);
      setLines((prev) => upsertLine(prev, out.groupId));
      toast.success(g ? `Added ${g.name}` : "Item added to the package");
    } else if (out.action === "set-filter") {
      setScanFilter(out.filter);
      toast.success(
        out.filter.type === "category" ? "Showing that category only" : "Showing that storage only",
      );
    } else {
      toast.info(out.reason);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResolved, scanPayload]);

  const totalUnits = lines.reduce((n, l) => n + (Number.isFinite(l.count) ? l.count : 0), 0);

  const shortages = lines
    .map((l) => ({ ...l, max: maxFor(l.groupId) }))
    .filter((l) => l.count > l.max);

  const submit = async () => {
    const clean = lines.filter((l) => l.groupId && l.count >= 1);
    if (clean.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    if (shortages.length > 0) {
      const names = shortages
        .map((l) => `${groupById.get(l.groupId)?.name ?? "item"} (max ${l.max})`)
        .join(", ");
      toast.error(`Not enough units available for: ${names}`);
      return;
    }
    setBusy(true);
    try {
      if (editPackageId) {
        await editPackage({
          packageId: editPackageId as any,
          lines: clean.map((l) => ({ groupId: l.groupId as any, count: l.count, note: l.note || undefined })),
          note: note.trim() || undefined,
        });
        toast.success("Package updated");
      } else {
        await createPackage({
          lines: clean.map((l) => ({ groupId: l.groupId as any, count: l.count, note: l.note || undefined })),
          note: note.trim() || undefined,
        });
        toast.success(`Package of ${totalUnits} unit(s) requested — the admin has been notified`);
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4 text-primary" />
            {editPackageId ? "Edit package request" : "Build a rental package"}
          </DialogTitle>
          <DialogDescription>
            Bundle several items into one request — e.g. 3× Arduino Uno + 2× servo. One approval,
            one pickup. Available counts update live. Scan item labels to add lines, or scan a
            category/storage label to filter the list below.
          </DialogDescription>
        </DialogHeader>

        {(scanFilter || scanQuery.trim()) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {scanFilter && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
                {scanFilter.type === "category" ? "Category" : "Storage"} filter
                <button
                  type="button"
                  onClick={() => setScanFilter(null)}
                  className="rounded-full p-0.5 hover:bg-primary/20"
                  title="Clear scan filter"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {scanQuery.trim() && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
                “{scanQuery.trim()}”
                <button
                  type="button"
                  onClick={() => setScanQuery("")}
                  className="rounded-full p-0.5 hover:bg-muted"
                  title="Clear search"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>
        )}

        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1">
          {lines.map((line, i) => {
            const max = maxFor(line.groupId);
            return (
              <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                <Select value={line.groupId} onValueChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, groupId: v, count: Math.min(l.count, Math.max(1, maxFor(v))) } : l)))}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Choose an item" />
                  </SelectTrigger>
                  <SelectContent>
                    {dropdownGroups.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No items match the filter — clear it or scan another label.
                      </div>
                    ) : (
                      dropdownGroups.map((g: any) => {
                        const a = availability?.[g._id];
                        return (
                          <SelectItem key={g._id} value={g._id}>
                            {g.name}
                            {isPackGroup(g) ? ` (${describePackSize(g)})` : ""} · {a ? `${a.available} free` : "…"}
                          </SelectItem>
                        );
                      })
                    )}
                  </SelectContent>
                </Select>
                <div className="flex w-28 items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() =>
                      setLines((prev) => prev.map((l, j) => (j === i ? { ...l, count: Math.max(1, l.count - 1) } : l)))
                    }
                  >
                    −
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    value={line.count}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, j) => (j === i ? { ...l, count: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : l)),
                      )
                    }
                    className="h-7 text-center"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-7"
                    onClick={() =>
                      setLines((prev) => prev.map((l, j) => (j === i ? { ...l, count: l.count + 1 } : l)))
                    }
                  >
                    +
                  </Button>
                </div>
                <span className={`w-16 shrink-0 text-right text-[11px] ${line.count > max ? "font-semibold text-rose-400" : "text-muted-foreground"}`}>
                  {max} free
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 text-destructive"
                  onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setLines((prev) => [...prev, { groupId: "", count: 1 }])}
            >
              <Plus className="size-4" /> Add item
            </Button>
            <Input
              value={scanQuery}
              onChange={(e) => setScanQuery(e.target.value)}
              placeholder="Search items…"
              className="h-8 w-40"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setScanOpen(true)}
              title="Scan a unit/group label to add it, or a category/storage label to filter the list"
            >
              <ScanLine className="size-4" /> Scan QR
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Note for the admin (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What's the package for? (e.g. Dual Arms project build week)"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {lines.filter((l) => l.groupId).length} item(s) · {totalUnits} unit(s) total
          </span>
          {shortages.length > 0 && (
            <span className="font-medium text-rose-400">Some items exceed availability</span>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || lines.length === 0 || shortages.length > 0}>
            {busy ? <LoadingGifInline size={18} className="size-4" /> : <Package className="size-4" />}
            {editPackageId ? "Save changes" : "Send package request"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <QrScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(text) => setScanPayload(normalizeScan(text))}
        hint="Unit/group labels add items · category/storage labels filter the list"
      />
    </Dialog>
  );
}
