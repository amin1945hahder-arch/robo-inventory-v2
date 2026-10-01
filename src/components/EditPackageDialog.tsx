import { useEffect, useMemo, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { StatusBadge } from "@/components/StatusBadge";
import { asMessage, toLocalInput } from "@/components/EditRentalDialog";
import { PackageItemPicker } from "@/components/PackageItemPicker";
import { buildPackageDropdown } from "@/lib/package-dropdown";
import { isBulkMaterialGroup, roundBulk } from "@/lib/group-measure";
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
import {
  packageDisplayStatus,
  type PackageDisplayStatus,
} from "@/lib/package-status";
import { toast } from "sonner";
import { CalendarClock, Database, Package, Plus, Trash2 } from "lucide-react";

/**
 * Admin editor for a whole package record — the bundle-level twin of the
 * per-unit EditRentalDialog. Two editing modes, chosen by the package's own
 * state, so every edit stays truthful to what physically happened:
 *
 * - PENDING package → full re-pick, exactly like the member's own edit:
 *   every claimed unit is released and fresh ones are claimed for the new
 *   lines when the admin approves.
 * - APPROVED package → surgical unit-level diff: add units from the shelf
 *   (inserted as "approved", they belong to an approved bundle), remove
 *   units that are only pending/approved, update note and scheduled
 *   pick-up. Units already handed out or processed are shown read-only —
 *   those live records are edited per unit (EditRentalDialog), never
 *   silently deleted by a lines edit.
 */

type UnitRow = {
  rentalId: string;
  partId: string;
  tag?: string;
  status: string;
  rentBroken: boolean;
  returnRequestedAt?: number;
  /** Which line of pkg.lines this unit belongs to. */
  groupId: string;
};

type EditLine = {
  groupId: string;
  count: number;
  note?: string;
  /** Current actual units in the package for this group (set on load). */
  existing: number;
  /** Rentals that this edit should remove (un-tagged by the admin). */
  removed: Set<string>;
};

/** Unit statuses a package edit may remove. */
const REMOVABLE = new Set(["pending", "approved"]);

/** Unit statuses whose part is still held by the package (counts against
 *  availability). Returned/on_project units are back on the shelf or in a
 *  project — their shelf slots must NOT be subtracted from headroom. */
const HOLDS_PART = new Set(["pending", "approved", "active", "on_project"]);


export function EditPackageDialog({
  open,
  onOpenChange,
  pkg,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pkg: any;
  onDone?: () => void;
}) {
  const adminEdit = useMutation(api.parts.adminEditPackage);
  const deletePackageRec = useMutation(api.bulk.deletePackageRecord);
  // Live availability per group — additions can only claim free units.
  const availability = useQuery(api.parts.availabilityByGroup, open ? {} : "skip");
  const groups = useQuery(api.catalog.listGroups, open ? {} : "skip");
  const categories = useQuery(api.catalog.listCategories, open ? {} : "skip");
  // Renter re-assignment (whole bundle + every unit record in it).
  const people = useQuery(api.users.listPeopleLite, open ? {} : "skip");

  const [status, setStatus] = useState<string>("pending");
  const [renter, setRenter] = useState<string>("");
  const [originalRenter, setOriginalRenter] = useState<string>("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [removedExtra, setRemovedExtra] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [pickupLocal, setPickupLocal] = useState("");
  const [pickupTouched, setPickupTouched] = useState(false);
  const [pickupCleared, setPickupCleared] = useState(false);
  // Date corrections — every date the per-unit record editor offers, applied
  // to the WHOLE bundle (package row + every rental record + held units).
  const [requestedLocal, setRequestedLocal] = useState("");
  const [requestedTouched, setRequestedTouched] = useState(false);
  const [decidedLocal, setDecidedLocal] = useState("");
  const [decidedTouched, setDecidedTouched] = useState(false);
  const [pickedUpLocal, setPickedUpLocal] = useState("");
  const [pickedUpTouched, setPickedUpTouched] = useState(false);
  const [returnedLocal, setReturnedLocal] = useState("");
  const [returnedTouched, setReturnedTouched] = useState(false);
  const [dueLocal, setDueLocal] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  // Whole-record delete (two modes): "record only" erases the bundle from
  // the ledger but leaves every unit's state untouched; "put everything
  // back" also releases the units the bundle still holds. Hidden when the
  // bundle is still pending — deny it from the request instead.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteRelease, setDeleteRelease] = useState(false);

  // Hydrate the editor from the package row when it opens — keyed on the
  // package id (NOT the row object) so a live-query refetch never wipes the
  // admin's in-progress edits mid-dialog.
  const pkgId: string | undefined = pkg?.package?._id;
  useEffect(() => {
    if (!open || !pkg) return;
    setStatus(pkg.package?.status ?? "pending");
    setRenter((pkg.package?.userId as string) ?? "");
    setOriginalRenter((pkg.package?.userId as string) ?? "");
    setNote(pkg.package?.note ?? "");
    setPickupLocal(toLocalInput(pkg.package?.pickupAt ?? null));
    setPickupTouched(false);
    setPickupCleared(false);
    setRequestedLocal(toLocalInput(pkg.package?.requestedAt ?? null));
    setRequestedTouched(false);
    setDecidedLocal(toLocalInput(pkg.package?.decidedAt ?? null));
    setDecidedTouched(false);
    // Seed from the real per-unit records (listPackages rentals) — the best
    // available timestamps — instead of copying other fields or blanks.
    const unitDates = (pkg.lines ?? []).flatMap((l: any) => l.units ?? []);
    const pickedUpAt = unitDates.find((u: any) => u.pickedUpAt)?.pickedUpAt;
    const returnedAt = unitDates.find((u: any) => u.returnedAt)?.returnedAt;
    const dueAt = unitDates.find((u: any) => u.dueAt)?.dueAt;
    setPickedUpLocal(toLocalInput(pickedUpAt ?? null));
    setPickedUpTouched(false);
    setReturnedLocal(toLocalInput(returnedAt ?? null));
    setReturnedTouched(false);
    setDueLocal(toLocalInput(dueAt ?? null));
    setDueTouched(false);
    setRemovedExtra(new Set());
    setConfirmDelete(false);
    setDeleteRelease(false);
    const next: EditLine[] = (pkg.lines ?? []).map((l: any) => ({
      groupId: l.groupId as string,
      count: l.requested as number,
      note: l.note as string | undefined,
      existing: l.units.length as number,
      removed: new Set<string>(),
    }));
    setLines(next);
    // pkgId (not the pkg object): live-query refetches keep a new object
    // identity — rehydrating on that would wipe the admin's open edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pkgId]);

  // The per-line unit list: pkg.lines carries the units, but the dialog's
  // own removals must be reflected immediately, so join + filter here.
  const unitRows: UnitRow[] = useMemo(() => {
    const rows: UnitRow[] = [];
    for (const l of pkg?.lines ?? []) {
      for (const u of l.units ?? []) {
        rows.push({
          rentalId: u.rentalId,
          partId: u.partId,
          tag: u.tag,
          status: u.status,
          rentBroken: Boolean(u.rentBroken),
          returnRequestedAt: u.returnRequestedAt,
          groupId: l.groupId,
        });
      }
    }
    return rows;
  }, [pkg]);

  const groupById = useMemo(() => {
    const m = new Map<string, { _id: string; name: string }>();
    for (const g of groups ?? []) m.set(g._id, g);
    return m;
  }, [groups]);

  // Bulk (weight/length) groups keep their amount ledger on unit rows —
  // per-group measure lookup drives the amount-vs-count line UI.
  const groupsQuery = useMemo(() => {
    const m = new Map<string, any>();
    for (const g of groups ?? []) m.set(g._id, g);
    return m;
  }, [groups]);
  const isBulkLine = (groupId: string) => isBulkMaterialGroup(groupsQuery.get(groupId));
  const bulkUnitOf = (groupId: string) => groupsQuery.get(groupId)?.measureUnit ?? "";

  // Same professional dropdown as the member builder: category sections with
  // fixed labels, container → name → brand → model ordering, containers
  // excluded, search box inside the dropdown.
  const dropdownSections = useMemo(
    () => buildPackageDropdown((groups ?? []) as any, categories ?? []),
    [groups, categories],
  );
  const closets = useQuery(api.catalog.listClosets, open ? {} : "skip");
  // groupId → storage display name; used lines are hidden from the picker.
  const closetNames = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of closets ?? []) {
      byId.set(c._id, [c.name, c.location].filter(Boolean).join(" — "));
    }
    return byId;
  }, [closets]);
  const usedGroupIds = useMemo(
    () => new Set(lines.map((l) => l.groupId).filter(Boolean) as string[]),
    [lines],
  );

  /** Free units of a group NOT already in this package (additions see the
   *  real headroom — the package's own held units are not "free", but units
   *  already returned to the shelf are). For bulk (weight/length) lines the
   *  headroom is the lendable AMOUNT on the shelf — this package's pending
   *  BULK record holds no units, so nothing is subtracted. */
  const freeOutside = (groupId: string) => {
    const a = availability?.[groupId];
    if (!a) return 0;
    if (isBulkLine(groupId)) return roundBulk(a.bulkFree);
    const heldInside = unitRows.filter(
      (u) => u.groupId === groupId && HOLDS_PART.has(u.status) && !removedExtra.has(u.rentalId),
    ).length;
    return Math.max(0, a.available - heldInside);
  };

  const isPending = status === "pending";
  const pkgHoldsLive = unitRows.some(
    (u) => u.status === "active" || u.status === "on_project" || u.status === "approved" || u.status === "pending",
  );
  const removableCount = unitRows.filter((u) => REMOVABLE.has(u.status) && !removedExtra.has(u.rentalId)).length;
  const removedCount = removedExtra.size;
  const displayStatus: PackageDisplayStatus = packageDisplayStatus(status, {
    approvedUnits: unitRows.filter((u) => u.status === "approved").length,
    activeUnits: unitRows.filter((u) => u.status === "active").length,
    returnedUnits: unitRows.filter((u) => u.status === "returned" || u.status === "on_project").length,
  });

  const setLine = (i: number, patch: Partial<EditLine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const plannedUnits = lines.reduce(
    (n, l) => n + (l.groupId && l.count > 0 && !isBulkLine(l.groupId) ? l.count : 0),
    0,
  );
  const bulkLineCount = lines.filter((l) => l.groupId && isBulkLine(l.groupId)).length;
  const shortages = lines.filter((l) => {
    if (!l.groupId || l.count <= 0) return false;
    if (isBulkLine(l.groupId)) return l.count > freeOutside(l.groupId) + 1e-9;
    if (isPending) {
      const a = availability?.[l.groupId];
      return l.count > (a?.available ?? 0);
    }
    return l.count > l.existing - l.removed.size + freeOutside(l.groupId);
  });

  const toggleRemoved = (u: UnitRow) => {
    setRemovedExtra((prev) => {
      const next = new Set(prev);
      if (next.has(u.rentalId)) next.delete(u.rentalId);
      else next.add(u.rentalId);
      return next;
    });
    // The line's kept count shrinks by one when its unit is un-tagged. Only
    // ORIGINAL lines (existing > 0) own units — a freshly re-added line for
    // the same group is a new claim and must not be adjusted.
    setLines((prev) =>
      prev.map((l) => {
        if (l.groupId !== u.groupId || l.existing === 0) return l;
        const going = !l.removed.has(u.rentalId);
        return { ...l, removed: going ? new Set([...l.removed, u.rentalId]) : new Set([...l.removed].filter((x) => x !== u.rentalId)), count: going ? Math.max(0, l.count - 1) : l.count + 1 };
      }),
    );
  };

  const addLine = () =>
    setLines((prev) => [...prev, { groupId: "", count: 1, existing: 0, removed: new Set() }]);

  const removeLine = (i: number) => {
    const line = lines[i];
    // Removing a line un-tags every removable unit of that group.
    const doomed = unitRows.filter((u) => u.groupId === line.groupId && REMOVABLE.has(u.status));
    setRemovedExtra((prev) => {
      const next = new Set(prev);
      for (const u of doomed) next.add(u.rentalId);
      return next;
    });
    setLines((prev) => prev.filter((_, j) => j !== i));
  };

  const submit = async () => {
    const clean = lines.filter((l) => l.groupId && l.count > 0);
    if (clean.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    if (shortages.length > 0) {
      toast.error(
        `Not enough available for: ${shortages
          .map((l) => {
            const g = groupsQuery.get(l.groupId);
            const unit = isBulkMaterialGroup(g) ? ` ${g?.measureUnit ?? ""}`.trimEnd() : " units";
            return `${groupById.get(l.groupId)?.name ?? "item"} (max ${freeOutside(l.groupId)}${unit})`;
          })
          .join(", ")}`,
      );
      return;
    }
    setBusy(true);
    try {
      await adminEdit({
        packageId: pkg.package._id as any,
        lines: clean.map((l) => ({ groupId: l.groupId as any, count: l.count, note: l.note || undefined })),
        note: note.trim() || undefined,
        pickupAt: pickupCleared ? null : pickupTouched && pickupLocal ? new Date(pickupLocal).getTime() : undefined,
        // Dates: only sent when the admin actually edited the field.
        requestedAt: requestedTouched ? (requestedLocal ? new Date(requestedLocal).getTime() : null) : undefined,
        decidedAt: decidedTouched ? (decidedLocal ? new Date(decidedLocal).getTime() : null) : undefined,
        pickedUpAt: pickedUpTouched ? (pickedUpLocal ? new Date(pickedUpLocal).getTime() : null) : undefined,
        returnedAt: returnedTouched ? (returnedLocal ? new Date(returnedLocal).getTime() : null) : undefined,
        dueAt: dueTouched ? (dueLocal ? new Date(dueLocal).getTime() : null) : undefined,
        // Renter: only sent when the admin picked a different member.
        ...(renter && renter !== originalRenter ? { userId: renter as any } : {}),
        removeRentalIds:
          status === "approved" && removedExtra.size > 0 ? ([...removedExtra] as any) : undefined,
      });
      toast.success("Package updated");
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Two-mode delete of the whole package record (see the panel below for
  // what each mode means). The backend reports records it had to skip —
  // those still hold their unit and can only be cleared by the release mode.
  const doDelete = async (mode: "record" | "release") => {
    if (!pkgId) return;
    setBusy(true);
    try {
      const res = await deletePackageRec({
        packageId: pkgId as never,
        releaseUnits: mode === "release" || undefined,
      });
      const skipped: any[] = res?.skipped ?? [];
      if (mode === "record" && skipped.length > 0) {
        const tags = skipped.map((s: any) => s.tag ?? "unit").slice(0, 4).join(", ");
        toast.warning(
          `Deleted ${res.deleted} record(s). Kept ${skipped.length} still holding a unit (${tags}${skipped.length > 4 ? "…" : ""}) — choose “Delete and put everything back” to release them.`,
        );
      } else {
        toast.success(
          mode === "release"
            ? `Package record deleted — ${res?.deleted ?? 0} unit record(s) cleared and everything put back in its place`
            : `Package record deleted from history — everything stays as it is`,
        );
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4 text-primary" />
            Edit package
            <StatusBadge status={displayStatus} className="ml-1" />
          </DialogTitle>
          <DialogDescription>
            {isPending
              ? "This request is still pending — rework its lines freely; units are re-claimed when it is approved."
              : "Approved package — add units from the shelf, remove ones that are not handed out yet, or fix the note and pick-up time. Handed-out and processed units are locked and are edited per unit."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Renter — who the whole package belongs to</Label>
          <Select value={renter || undefined} onValueChange={setRenter}>
            <SelectTrigger>
              <SelectValue placeholder="Package holder" />
            </SelectTrigger>
            <SelectContent>
              {(people ?? []).map((p: any) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name ?? p.email}
                  {p.email ? ` · ${p.email}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {renter !== originalRenter && (
            <p className="text-xs font-medium text-amber-500">
              Saving moves this package — and every unit record in it — to the selected member.
            </p>
          )}
        </div>

        <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto pr-1">
          {lines.map((line, i) => {
            // Pending: how many units are on the shelf. Approved: the line's
            // real headroom — kept units + free units NOT already in the pkg.
            // Bulk (weight/length) lines work in AMOUNT: their headroom is the
            // lendable stock of the whole group (kept BULK records hold no
            // units, so they don't reduce it).
            const bulk = isBulkLine(line.groupId);
            const unit = bulkUnitOf(line.groupId);
            const max = isPending
              ? (bulk ? roundBulk(availability?.[line.groupId]?.bulkFree ?? 0) : availability?.[line.groupId]?.available ?? 0)
              : bulk
                ? freeOutside(line.groupId)
                : line.existing - line.removed.size + freeOutside(line.groupId);
            const g = groupById.get(line.groupId);
            return (
              <div key={i} className="glass-3d flex flex-col gap-2 rounded-md border p-2">
                {g ? (
                  <span className="min-w-0 truncate text-sm font-medium">{g.name}</span>
                ) : (
                  <PackageItemPicker
                    sections={dropdownSections}
                    availability={availability}
                    closetNames={closetNames}
                    selectedIds={usedGroupIds}
                    onPick={(groupId) => setLine(i, { groupId, count: 1, note: undefined, existing: 0, removed: new Set() })}
                  />
                )}
                <div className="flex items-center justify-between gap-2">
                  {bulk ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Decrease amount"
                        onClick={() => setLine(i, { count: roundBulk(Math.max(0.01, line.count - 0.5)) })}
                      >
                        −
                      </Button>
                      <Input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={line.count}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setLine(i, { count: Number.isFinite(n) && n > 0 ? roundBulk(n) : 0 });
                        }}
                        className="h-8 w-24 text-center"
                        aria-label={`Amount in ${unit || "units"}`}
                      />
                      <span className="w-8 text-xs text-muted-foreground">{unit}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Increase amount"
                        onClick={() => setLine(i, { count: roundBulk(line.count + 0.5) })}
                      >
                        +
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Decrease quantity"
                        onClick={() => setLine(i, { count: Math.max(1, line.count - 1) })}
                      >
                        −
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        value={line.count}
                        onChange={(e) =>
                          setLine(i, { count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                        }
                        className="h-8 w-14 text-center"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Increase quantity"
                        onClick={() => setLine(i, { count: line.count + 1 })}
                      >
                        +
                      </Button>
                    </div>
                  )}
                  <span
                    className={`text-right text-[11px] ${
                      shortages.some((s) => s.groupId === line.groupId)
                        ? "font-semibold text-rose-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {isPending
                      ? `${max}${bulk ? ` ${unit} free` : " free"}`
                      : bulk
                        ? `${max} ${unit} free`
                        : `${line.existing - line.removed.size} in pkg · ${freeOutside(line.groupId)} free`}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive"
                    title="Remove this item (its not-yet-handed-out units are released)"
                    onClick={() => removeLine(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="size-4" /> Add item
            </Button>
          </div>
        </div>

        {/* Unit-level view: full history for approved packages, plain list for
            pending ones. Removable units can be un-tagged; locked ones link
            to the per-unit record editor by rule (the admin closes this
            dialog and uses the unit's ✏️ in the row). */}
        {status !== "pending" && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">
              Units in this package — un-tag the ones to release ({removableCount} removable, {removedCount} marked)
            </Label>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {unitRows.map((u) => {
                const removable = REMOVABLE.has(u.status);
                const marked = removedExtra.has(u.rentalId);
                return (
                  <li key={u.rentalId} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={marked}
                      disabled={!removable}
                      onChange={() => toggleRemoved(u)}
                      className="size-3.5 accent-primary"
                      title={removable ? "Release this unit" : "Handed-out or processed units cannot be removed by a package edit"}
                    />
                    <span className="font-mono">{u.tag ?? "?"}</span>
                    <StatusBadge status={u.status} />
                    {u.rentBroken && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">broken</span>
                    )}
                    {!removable && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {u.status === "active" || u.status === "on_project" ? "locked — edit per unit" : "processed"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="grid gap-2">
          <Label>Note</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What's the package for?"
          />
        </div>

        {/* ALL dates, editable — saved to the package row, every unit record
            in the bundle AND the held units themselves (rent-at / return-by).
            Leave a field untouched to keep its stored value; clear it to erase. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> Requested at
            </Label>
            <Input
              type="datetime-local"
              value={requestedLocal}
              onChange={(e) => {
                setRequestedLocal(e.target.value);
                setRequestedTouched(true);
              }}
              className="h-8"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> Decided at (approve/deny)
            </Label>
            <Input
              type="datetime-local"
              value={decidedLocal}
              onChange={(e) => {
                setDecidedLocal(e.target.value);
                setDecidedTouched(true);
              }}
              className="h-8"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> Scheduled pick-up
            </Label>
            <Input
              type="datetime-local"
              value={pickupLocal}
              onChange={(e) => {
                setPickupLocal(e.target.value);
                setPickupTouched(true);
                setPickupCleared(false);
              }}
              className="h-8"
            />
            {(pkg?.package?.pickupAt || pickupLocal) && (
              <button
                type="button"
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setPickupLocal("");
                  setPickupTouched(false);
                  setPickupCleared(true);
                }}
              >
                Clear pick-up time (whole bundle)
              </button>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> Picked up at
            </Label>
            <Input
              type="datetime-local"
              value={pickedUpLocal}
              onChange={(e) => {
                setPickedUpLocal(e.target.value);
                setPickedUpTouched(true);
              }}
              className="h-8"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> Return by (lend window)
            </Label>
            <Input
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => {
                setDueLocal(e.target.value);
                setDueTouched(true);
              }}
              className="h-8"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="size-3.5" /> Returned at
            </Label>
            <Input
              type="datetime-local"
              value={returnedLocal}
              onChange={(e) => {
                setReturnedLocal(e.target.value);
                setReturnedTouched(true);
              }}
              className="h-8"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Saved dates apply to the whole package — every unit record and each held unit inherits them.
        </p>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {lines.filter((l) => l.groupId).length} item(s) · planned {plannedUnits} unit(s)
            {bulkLineCount > 0 ? ` · ${bulkLineCount} by amount` : ""}
            {removedCount > 0 ? ` · ${removedCount} unit(s) to release` : ""}
          </span>
          {shortages.length > 0 && (
            <span className="font-medium text-rose-400">Some items exceed availability</span>
          )}
        </div>

        {/* Whole-record delete with the same two-mode choice as individual
            records: wipe the ledger row only, or wipe it AND release every
            unit the bundle still holds back to its shelf slot. */}
        {!isPending && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            {!confirmDelete ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" /> Delete package record
              </Button>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-destructive">
                  <Database className="size-4" /> Delete this package record?
                </p>
                <p className="text-xs text-muted-foreground">
                  Removes the bundle and its unit records from the ledger permanently.
                </p>
                <div className="flex flex-col gap-1.5">
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${deleteRelease ? "" : "border-foreground/60"}`}
                  >
                    <input
                      type="radio"
                      name="pkg-delete-mode"
                      className="mt-0.5"
                      checked={!deleteRelease}
                      onChange={() => setDeleteRelease(false)}
                    />
                    <span>
                      <span className="font-medium">Delete only the record</span>
                      <span className="block text-muted-foreground">
                        History forgets the bundle; every unit keeps its current state (shelf counts unchanged).
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs ${deleteRelease ? "border-foreground/60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="pkg-delete-mode"
                      className="mt-0.5"
                      checked={deleteRelease}
                      onChange={() => setDeleteRelease(true)}
                    />
                    <span>
                      <span className="font-medium">Delete and put everything back</span>
                      <span className="block text-muted-foreground">
                        {pkgHoldsLive
                          ? "Every unit still held by this package is released to its shelf slot and becomes available again."
                          : "Nothing is currently held — both choices end the same for this package."}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => doDelete(deleteRelease ? "release" : "record")}
                  >
                    <Trash2 className="size-3.5" /> {deleteRelease ? "Delete & put back" : "Delete record only"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || lines.length === 0 || shortages.length > 0}>
            {busy ? <LoadingGifInline size={18} className="size-4" /> : <Package className="size-4" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
