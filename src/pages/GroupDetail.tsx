import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useSound } from "@/hooks/use-sound";
import { AppShell } from "@/components/AppShell";
import { LoadingGif, LoadingGifInline } from "@/components/LoadingGif";
import { NavArrows } from "@/components/NavArrows";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReturnDialog } from "@/components/ReturnDialog";
import { GroupCard } from "@/components/GroupCard";
import { PackageBuilderDialog } from "@/components/PackageBuilderDialog";
import { GroupDetailUnits, isBulkGroup, ConsumeBulkDialog } from "@/components/GroupDetailUnits";
import { describePackSize, isPackGroup, sumPiecesInUnits } from "@/lib/group-measure";
import { containerPathOf } from "@/lib/package-dropdown";
import { usePreviousLocation } from "@/hooks/use-previous-location";
import { BulkUnitDialog } from "@/components/BulkUnitDialog";
import { UnitEditDialog } from "@/components/UnitEditDialog";
import { GroupFormDialog } from "@/components/GroupFormDialog";
import { groupQr, unitQr } from "@/lib/qr";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import {
  ArrowDownUp,
  ArrowLeft,
  Box,
  ExternalLink,
  Loader2,
  PackagePlus,
  Package,
  Pencil,
  RotateCcw,
  Scale,
  Trash2,
} from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

export default function GroupDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const group = useQuery(api.catalog.getGroup, id ? { id: id as any } : "skip");
  const parts = useQuery(api.parts.listPartsOfGroup, id ? { groupId: id as any } : "skip");
  const stats = useQuery(api.stats.groupStats, {});
  const myRentals = useQuery(api.parts.listMyRentals, {});
  const activeRentals = useQuery(
    api.parts.listAllRentals,
    isAdmin ? { status: "active" } : "skip",
  );
  const addPart = useMutation(api.catalog.addPartToGroup);
  const requestRental = useMutation(api.parts.requestRental);
  const requestQty = useMutation(api.parts.requestRentalQuantity);
  const requestBulkRental = useMutation(api.catalog.requestBulkRental);
  const playSound = useSound();
  // Bulk-unit add/edit dialog state (weight/length groups).
  const [bulkUnitOpen, setBulkUnitOpen] = useState(false);
  const [bulkUnitEdit, setBulkUnitEdit] = useState<Doc<"parts"> | null>(null);
  // Routine-consumption dialog state (weight/length groups).
  const [consumeFor, setConsumeFor] = useState<Doc<"parts"> | null>(null);

  const [returnFor, setReturnFor] = useState<{ rentalId: string; partId: string; tag: string; amount?: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Editing a child group's card from inside a master container.
  const [editGroup, setEditGroup] = useState<Doc<"groups"> | null>(null);
  const removeGroup = useMutation(api.catalog.deleteGroup);
  // New groups created from a container's page start inside it.
  const [insideDefaults, setInsideDefaults] = useState<{ parentGroupId?: string }>({});
  const closets = useQuery(api.catalog.listClosets, {});
  const categories = useQuery(api.catalog.listCategories, {});
  const groupsIndex = useQuery(api.catalog.childGroupOptions, {});
  // Where the member came from (storage, container page, inventory…) — the
  // back button returns THERE instead of always jumping to /inventory.
  const prevLocation = usePreviousLocation();

  // ← → flip through the groups of the SAME container (or storage when the
  // group sits loose), sorted like the inventory grid. Container siblings
  // keep the browse inside the box the member is looking at.
  const navSiblingIds = useMemo(() => {
    if (!group) return [];
    if (group.parentGroupId) {
      return (groupsIndex ?? [])
        .filter((g) => g.parentGroupId === group.parentGroupId && !isContainer(g))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => g._id);
    }
    return (groupsIndex ?? [])
      .filter((g) => !g.parentGroupId && g.closetId === group.closetId && !isContainer(g))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => g._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?._id, group?.parentGroupId, group?.closetId, groupsIndex]);


  // Project names for the on-project chips + the unit editor.
  const activeProjects = useQuery(api.projects.listProjects, isAdmin ? { status: "active" } : "skip");
  const [busyTag, setBusyTag] = useState<string | null>(null);
  // Quantity picker for the "request N units" flow.
  const [qty, setQty] = useState(1);
  const [qtyBusy, setQtyBusy] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);
  // Unit multi-select + bulk actions (admin).
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const deletePart = useMutation(api.parts.deletePart);
  // Unit-list ordering: grouped by state (default) or a flat sort.
  const [unitSort, setUnitSort] = useState<"state" | "tag" | "tagDesc">("state");

  const toggleUnit = (pid: string) => {
    setSelectedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const orderedParts = useMemo(() => {
    const list = [...(parts ?? [])];
    const byTag = (a: Doc<"parts">, b: Doc<"parts">) => a.tag.localeCompare(b.tag);
    if (unitSort === "tag") return list.sort(byTag);
    if (unitSort === "tagDesc") return list.sort((a, b) => byTag(b, a));
    const ORDER = ["pending", "rented", "on_project", "available", "broken", "transferred", "consumed"];
    return list.sort(
      (a, b) =>
        ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || byTag(a, b),
    );
  }, [parts, unitSort]);

  const stateSections = useMemo(() => {
    if (unitSort !== "state") return null;
    const labels: Record<string, string> = {
      pending: "Pending requests",
      rented: "Rented",
      on_project: "On projects",
      available: "Available",
      broken: "Broken",
      transferred: "Transferred",
      consumed: "Consumed",
    };
    return ["pending", "rented", "on_project", "available", "broken", "transferred", "consumed"]
      .map((st) => ({
        status: st,
        label: labels[st],
        units: orderedParts.filter((p) => p.status === st),
      }))
      .filter((s) => s.units.length > 0);
  }, [orderedParts, unitSort]);

  const bulkDeleteUnits = async () => {
    if (selectedUnits.size === 0) return;
    if (!confirm(`Delete ${selectedUnits.size} selected unit(s)?`)) return;
    let ok = 0;
    for (const pid of selectedUnits) {
      try {
        await deletePart({ id: pid as any });
        ok += 1;
      } catch {
        // Units out on rent/project are refused server-side; keep going.
      }
    }
    setSelectedUnits(new Set());
    toast.success(`${ok} unit(s) deleted`);
  };

  const myActivePartIds = new Set(
    (myRentals ?? [])
      .filter((r) => r.rental.status === "active" && r.part)
      .map((r) => r.part!._id),
  );
  const myPendingPartIds = new Set(
    (myRentals ?? [])
      .filter((r) => r.rental.status === "pending" && r.part)
      .map((r) => r.part!._id),
  );

  const s = stats?.[id ?? ""];
  const total = s?.total ?? 0;
  // Amount-ledger groups (weight/length reels AND packs) share the bulk
  // unit list, consumption dialog and stock roll-up.
  const isBulk = isBulkGroup(group);
  const stock = Number(group?.measureStock ?? 0);
  // Packs: real stock = pieces inside ALL packs (ledger-aware), shown next
  // to the pack count in the stats grid.
  const isPack = isPackGroup(group);
  const piecesStock = isPack ? sumPiecesInUnits(parts ?? [], group) : 0;
  const fullPieces = Math.round(Number(group?.packSize ?? 0) * total);
  const availableUnits = (parts ?? []).filter(
    (p) =>
      p.status === "available" &&
      // Emptied packs are out of circulation until pieces are logged back.
      (!isPack || Number(p.amountRemaining ?? 0) > 0),
  );
  const [bulkAmount, setBulkAmount] = useState("");

  // Storage-alias group: its name is exactly a storage's name, so its printed
  // QR resolves to the storage. It cannot be lent — only edited/managed.
  const isStorageAlias = Boolean(
    group && (closets ?? []).some((c) => c.name === group.name),
  );
  // Group-of-groups: children that live inside this container group.
  const childGroups = (groupsIndex ?? []).filter((g) => g.parentGroupId === group?._id);
  const parentGroup = group?.parentGroupId
    ? (groupsIndex ?? []).find((g) => g._id === group.parentGroupId)
    : null;
  // Master containers hold GROUPS only: the moment a container has child
  // groups it stops offering unit/lending UI entirely.
  const isMaster = childGroups.length > 0 && !isBulk;

  // Back target: the container page when the group sits inside one (even if
  // the member arrived another way — that is the natural parent), otherwise
  // wherever they navigated from (storage page, inventory with its filters).
  const backTo = parentGroup
    ? `/group/${parentGroup._id}`
    : prevLocation
      ? `${prevLocation.pathname}${prevLocation.search}`
      : "/inventory";
  const backLabel = parentGroup
    ? parentGroup.name
    : (prevLocation?.pathname ?? "").startsWith("/closets/")
      ? "Storage"
      : prevLocation?.pathname === "/closets"
        ? "Storages"
        : prevLocation?.pathname === "/inventory" || prevLocation?.pathname === "/"
          ? "Inventory"
          : "Back";

  const requestBulk = async () => {
    if (!group) return;
    const amount = Number(bulkAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter the amount you need");
      return;
    }
    setQtyBusy(true);
    try {
      await requestBulkRental({ groupId: group._id, amount });
      playSound("rental_request");
      toast.success(`Requested ${amount} ${group.measureUnit} — the lab admin has been notified`);
      setBulkAmount("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setQtyBusy(false);
    }
  };

  const requestQuantity = async () => {
    if (!group) return;
    setQtyBusy(true);
    try {
      const res = await requestQty({ groupId: group._id, count: qty });
      playSound("rental_request");
      if ("packageId" in res && res.packageId) {
        // Multi-unit requests are bundled into ONE package automatically —
        // the admin approves/hands over/returns it as a single bundle.
        toast.success(
          `${res.created} ${isPackGroup(group) ? `pack${res.created > 1 ? "s" : ""}` : `unit${res.created > 1 ? "s" : ""}`} requested as ONE package — the lab admin has been notified`,
        );
      } else {
        toast.success(
          `${res.created} ${isPackGroup(group) ? `pack${res.created > 1 ? "s" : ""}` : `unit${res.created > 1 ? "s" : ""}`} requested — the lab admin has been notified`,
        );
      }
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setQtyBusy(false);
    }
  };

  const requestUnit = async (partId: string, tag: string) => {
    if (!group) return;
    setBusyTag(tag);
    try {
      await requestRental({ partId: partId as any, groupId: group._id });
      playSound("rental_request");
      toast.success("Request sent — the lab admin has been notified");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusyTag(null);
    }
  };

  return (
    <AppShell>
      {/* ← → flip through the groups of the same container (or storage). */}
      <NavArrows
        items={navSiblingIds}
        currentId={group?._id}
        onNavigate={(nid) => navigate(`/group/${nid}`)}
      />
      {!group ? (
        <LoadingGif size={48} label={null} />
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate(backTo)}>
              <ArrowLeft className="size-4" /> {backLabel}
            </Button>
          </div>

          <header className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
            <div className="flex items-start gap-3">
              <QrChip payload={groupQr(group._id)} label={group.name} />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[group.brand, group.model].filter(Boolean).join(" · ") || "Component group"}
                </p>
                {isPackGroup(group) && (
                  <p className="mt-1 text-xs font-medium text-primary">
                    📦 {describePackSize(group)} — packs are lent whole, one QR per pack
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              {isStorageAlias && (
                <p className="max-w-xs rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-400 sm:text-right">
                  ⚠️ A storage named “{group.name}" exists — this group's QR opens the storage,
                  so it cannot be lent. You can still edit it and manage its units.
                </p>
              )}
              {isAdmin && !isMaster && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (isBulk) {
                      // Bulk units AND packs are added through the dialog:
                      // bulk needs its amount up front; a new pack is added
                      // full (pieces prefilled from the pack size).
                      setBulkUnitEdit(null);
                      setBulkUnitOpen(true);
                    } else {
                      addPart({ groupId: group._id, count: 1 })
                        .then(() => {
                          playSound("assigned");
                          toast.success("Unit added with a new QR tag");
                        })
                        .catch((e: unknown) =>
                          toast.error(asMessage(e)),
                        );
                    }
                  }}
                >
                  <PackagePlus className="size-4" /> {isPackGroup(group) ? "Add pack" : "Add unit"}
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditGroup(null); // create mode
                    setInsideDefaults({ parentGroupId: group._id });
                    setAddOpen(true);
                  }}
                >
                  <Box className="size-4" /> Add group inside
                </Button>
              )}
              {/* Rental requests are available to every signed-in member —
                  admins included (they often demo or reserve units too).
                  Masters hold groups only — no lending UI. Packs keep the
                  count-style "Request N packs" flow (whole units); only
                  weight/length groups use the amount input. */}
              {isMaster ? null : isBulk && !isPack ? (
                <div className="flex flex-col items-stretch gap-2 sm:items-end">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={bulkAmount}
                      onChange={(e) => setBulkAmount(e.target.value)}
                      placeholder={`Amount in ${group.measureUnit}`}
                      className="w-36"
                      disabled={isStorageAlias}
                    />
                    <Button disabled={qtyBusy || stock <= 0 || isStorageAlias} onClick={requestBulk}>
                      {qtyBusy ? <LoadingGifInline size={18} className="size-4" /> : <Scale className="size-4" />}
                      Request amount
                    </Button>
                  </div>
                  {isAdmin && !isPack && (
                    <p className="max-w-xs text-right text-xs text-muted-foreground">
                      Stock is the sum of all units — add or edit units below to correct it.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={Math.max(1, availableUnits.length)}
                      value={qty}
                      onChange={(e) =>
                        setQty(Math.max(1, Math.min(availableUnits.length || 1, Math.floor(Number(e.target.value) || 1))))
                      }
                      className="w-20"
                      disabled={availableUnits.length === 0}
                    />
                    <Button
                      disabled={availableUnits.length === 0 || qtyBusy || isStorageAlias}
                      onClick={requestQuantity}
                    >
                      {qtyBusy ? <LoadingGifInline size={18} className="size-4" /> : <Package className="size-4" />}
                      {availableUnits.length > 0
                        ? `Request ${qty} ${isPackGroup(group) ? `pack${qty > 1 ? "s" : ""}` : `unit${qty > 1 ? "s" : ""}`}`
                        : "No units available"}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPkgOpen(true)}
                  >
                    <PackagePlus className="size-4" /> Request multiple items (package)
                  </Button>
                </>
              )}
            </div>
          </header>

          {group.imageUrl && (
            <img
              src={group.imageUrl}
              alt={group.name}
              className="h-44 w-full glass-3d rounded-lg border object-cover"
            />
          )}

          {group.description && (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{group.description}</p>
          )}

          {parentGroup && (
            <p className="text-sm text-muted-foreground">
              📦 Inside container group{" "}
              <Link to={`/group/${parentGroup._id}`} className="font-medium underline">
                {parentGroup.name}
              </Link>
            </p>
          )}
          {childGroups.length > 0 && (
            <section className={isMaster ? "flex flex-col gap-3" : "rounded-lg border border-dashed p-4"}>
              <div>
                <h2 className="text-sm font-semibold">
                  {isMaster
                    ? `Groups inside this master container (${childGroups.length})`
                    : `Inside this group (${childGroups.length})`}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {isMaster
                    ? "Lend or manage items from each group's own page — the container itself holds no units."
                    : "Groups that live together in this container (box/bag)."}
                </p>
              </div>
              {isMaster ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {childGroups.map((g) => {
                    const contained = (groupsIndex ?? []).filter(
                      (x) => x.parentGroupId === g._id,
                    );
                    return (
                      <GroupCard
                        key={g._id}
                        group={g}
                        stats={stats?.[g._id]}
                        categoryName={categories?.find((c) => c._id === g.categoryId)?.name}
                        isAdmin={isAdmin}
                        containedGroups={contained.length > 0 ? contained : undefined}
                        closetName={
                          g.closetId
                            ? (() => {
                                const c = (closets ?? []).find((x) => x._id === g.closetId);
                                return c ? [c.name, c.location].filter(Boolean).join(" — ") : undefined;
                              })()
                            : undefined
                        }
                        onEdit={() => {
                          setInsideDefaults({});
                          setEditGroup(g);
                          setAddOpen(true);
                        }}
                        onDelete={async () => {
                          if (!confirm(`Delete ${g.name} and all its units?`)) return;
                          try {
                            await removeGroup({ id: g._id });
                            toast.success("Group deleted");
                          } catch (e) {
                            toast.error(asMessage(e));
                          }
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {childGroups.map((g) => (
                    <Link
                      key={g._id}
                      to={`/group/${g._id}`}
                      className="rounded-full border px-3 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary"
                    >
                      {g.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {isMaster ? (
            <p className="max-w-2xl rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              📦 Master container — holds <b className="text-foreground">groups</b>, not units.
              Lend out items from the individual groups inside it.
            </p>
          ) : isBulk ? (
            <section className={`grid gap-px overflow-hidden rounded-lg border bg-border ${isPack ? "grid-cols-2" : "grid-cols-3"}`}>
              {[
                ...(isPack
                  ? [
                      ["Packs", String(total), ""],
                      ["Pieces in all packs", `${piecesStock} pieces${total > 0 ? ` · ${fullPieces} when full` : ""}`, ""],
                    ]
                  : []),
                ...(isPack
                  ? []
                  : [["Stock", `${stock} ${group.measureUnit}`, ""]]),
                ...(isPack
                  ? []
                  : [
                      [
                        "Low-stock at",
                        group.measureLowAt ? `${group.measureLowAt} ${group.measureUnit}` : "—",
                        "",
                      ],
                      [
                        "Status",
                        group.measureLowAt && stock <= Number(group.measureLowAt) ? "⚠️ LOW" : "OK",
                        group.measureLowAt && stock <= Number(group.measureLowAt) ? "text-rose-400" : "text-emerald-400",
                      ],
                    ]),
              ].map(([label, value, cls]) => (
                <div key={label as string} className="bg-background px-5 py-5">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{value}</p>
                </div>
              ))}
            </section>
          ) : (
          <section className="grid grid-cols-2 gap-px overflow-hidden glass-3d rounded-lg border bg-border md:grid-cols-4">
            {[
              ["Total", total, ""],
              ["Available", s?.available ?? 0, "text-emerald-400"],
              ["Pending", s?.pending ?? 0, "text-amber-400"],
              ["Rented", s?.rented ?? 0, "text-sky-400"],
              ["On projects", s?.onProject ?? 0, "text-violet-400"],
              ["Broken", s?.broken ?? 0, "text-rose-400"],
              ["Transferred", s?.transferred ?? 0, "text-orange-400"],
              ["Consumed", s?.consumed ?? 0, "text-zinc-400"],
            ].map(([label, value, cls]) => (
              <div key={label as string} className="bg-background px-5 py-5">
                <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {label}
                </p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls ?? ""}`}>
                  {value as number}
                </p>
              </div>              ))}
          </section>
          )}

          {/* Bulk groups keep a real unit list too: every reel/spool with its
              amount, minimum, QR and (admin) edit controls. */}
          {isBulk && (
            <GroupDetailUnits
              group={group}
              parts={parts}
              isAdmin={isAdmin}
              onEdit={(u) => {
                setBulkUnitEdit(u);
                setBulkUnitOpen(true);
              }}
              onConsume={(u) => setConsumeFor(u)}
            />
          )}

          {!isBulk && !isMaster && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {isPackGroup(group)
                  ? `Packs · each with its own QR (${describePackSize(group)})`
                  : "Units · each with its own QR"}
              </h2>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <>
                    {/* Select-all: every unit of this group. */}
                    <Checkbox
                      checked={(parts ?? []).length > 0 && (parts ?? []).every((p) => selectedUnits.has(p._id))}
                      onCheckedChange={() => {
                        setSelectedUnits((prev) => {
                          const list = parts ?? [];
                          if (list.length > 0 && list.every((p) => prev.has(p._id))) {
                            const next = new Set(prev);
                            for (const p of list) next.delete(p._id);
                            return next;
                          }
                          return new Set([...prev, ...list.map((p) => p._id)]);
                        });
                      }}
                      aria-label="Select all units"
                      title="Select all units"
                    />
                    <span className="text-xs text-muted-foreground">
                      All{selectedUnits.size > 0 ? ` · ${selectedUnits.size} selected` : ""}
                    </span>
                    {selectedUnits.size > 0 && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
                          <Pencil className="size-3.5" /> Edit selected
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={bulkDeleteUnits}>
                          <Trash2 className="size-3.5" /> Delete selected
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedUnits(new Set())}>
                          Clear
                        </Button>
                      </>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  title="Change how the list is ordered"
                  onClick={() =>
                    setUnitSort((s) =>
                      s === "state" ? "tag" : s === "tag" ? "tagDesc" : "state",
                    )
                  }
                >
                  <ArrowDownUp className="size-3.5" />
                  {unitSort === "state" ? "By state" : unitSort === "tag" ? "Tag A→Z" : "Tag Z→A"}
                </Button>
                {group.datasheetUrl && (
                  <a
                    href={group.datasheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground underline"
                  >
                    Datasheet
                  </a>
                )}
              </div>
            </div>
            {isAdmin && parts && parts.length > 0 && selectedUnits.size === 0 && (
              <p className="text-xs text-muted-foreground">
                Tip: use the “All” checkbox or tick rows to edit/delete several units at once.
              </p>
            )}
            {parts === undefined ? (
              <div className="py-10">
                <LoadingGif label="Loading units…" />
              </div>
            ) : parts.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                No units yet.
              </p>
            ) : (
              <>
                {stateSections ? (
                  <div className="flex flex-col gap-5">
                    {stateSections.map((sec) => (
                      <div key={sec.status} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 glass-3d rounded-md border bg-card/40 px-3 py-1.5">
                          <StatusBadge status={sec.status as any} />
                          <span className="text-xs font-semibold">{sec.label}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{sec.units.length}</span>
                        </div>
                        <ul className="divide-y glass-3d rounded-lg border">
                          {sec.units.map((p) => (
                            <UnitRow
                              key={p._id}
                              p={p}
                              group={group}
                              isAdmin={isAdmin}
                              selected={selectedUnits.has(p._id)}
                              onToggle={() => toggleUnit(p._id)}
                              busyTag={busyTag}
                              isStorageAlias={isStorageAlias}
                              requestUnit={requestUnit}
                              myActive={myActivePartIds.has(p._id)}
                              myPending={myPendingPartIds.has(p._id)}
                              onReturn={(tag, pid, amount) => {
                                const hit = (activeRentals ?? []).find((r) => r.part?._id === pid);
                                if (hit) {
                                  setReturnFor({ rentalId: hit.rental._id, partId: pid, tag, amount: hit.rental.amount });
                                } else {
                                  toast.info("No active rental found for this unit");
                                }
                              }}
                              activeProjects={activeProjects}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="divide-y glass-3d rounded-lg border">
                    {orderedParts.map((p) => (
                      <UnitRow
                        key={p._id}
                        p={p}
                        group={group}
                        isAdmin={isAdmin}
                        selected={selectedUnits.has(p._id)}
                        onToggle={() => toggleUnit(p._id)}
                        busyTag={busyTag}
                        isStorageAlias={isStorageAlias}
                        requestUnit={requestUnit}
                        myActive={myActivePartIds.has(p._id)}
                        myPending={myPendingPartIds.has(p._id)}
                        onReturn={(tag, pid, amount) => {
                          const hit = (activeRentals ?? []).find((r) => r.part?._id === pid);
                          if (hit) {
                            setReturnFor({ rentalId: hit.rental._id, partId: pid, tag, amount: hit.rental.amount });
                          } else {
                            toast.info("No active rental found for this unit");
                          }
                        }}
                        activeProjects={activeProjects}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
          )}
        </div>
      )}

      {returnFor && (
        <ReturnDialog
          open={Boolean(returnFor)}
          onOpenChange={(v) => !v && setReturnFor(null)}
          rentalId={returnFor.rentalId}
          partId={returnFor.partId}
          partTag={returnFor.tag}
          groupName={group?.name ?? ""}
          rentalAmount={returnFor.amount}
        />
      )}

      {group && (
        <BulkUnitDialog
          open={bulkUnitOpen}
          onOpenChange={setBulkUnitOpen}
          group={group}
          unit={bulkUnitEdit}
        />
      )}

      {group && consumeFor && (
        <ConsumeBulkDialog
          open={Boolean(consumeFor)}
          onOpenChange={(v) => !v && setConsumeFor(null)}
          group={group}
          unit={consumeFor}
        />
      )}

      <PackageBuilderDialog
        open={pkgOpen}
        onOpenChange={setPkgOpen}
        presetGroupId={group?._id}
        onDone={() => playSound("rental_request")}
      />

      {/* Group dialog: create-inside (defaults.parentGroupId) or edit a
          child group's card from within the master container. */}
      <GroupFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        group={editGroup}
        defaults={{
          categoryId: group?.categoryId,
          closetId: group?.closetId,
          ...insideDefaults,
        }}
      />

      {/* Multi-unit editor (same window, applied to every ticked unit). */}
      {group && (
        <UnitEditDialog
          open={bulkEditOpen}
          onOpenChange={(v) => {
            setBulkEditOpen(v);
            if (!v) setSelectedUnits(new Set());
          }}
          units={parts?.filter((p) => selectedUnits.has(p._id)) ?? []}
          groups={groupsIndex ?? []}
          activeProjects={activeProjects}
          onClose={() => setSelectedUnits(new Set())}
        />
      )}
    </AppShell>
  );
}

/**
 * One row in the group's unit list. Admins get a selection checkbox (bulk
 * edit/delete), an edit button, and — when the unit sits on a project — a
 * small chip that jumps straight to that project.
 */
function UnitRow({
  p,
  group,
  isAdmin,
  selected,
  onToggle,
  busyTag,
  isStorageAlias,
  requestUnit,
  myActive,
  myPending,
  onReturn,
  activeProjects,
}: {
  p: Doc<"parts">;
  group: Doc<"groups">;
  isAdmin: boolean;
  selected: boolean;
  onToggle: () => void;
  busyTag: string | null;
  isStorageAlias: boolean;
  requestUnit: (partId: string, tag: string) => void;
  myActive: boolean;
  myPending: boolean;
  onReturn: (tag: string, partId: string, amount?: number) => void;
  activeProjects: Doc<"projects">[] | undefined;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const groupsIndex = useQuery(api.catalog.childGroupOptions, editOpen ? {} : "skip");
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      {/* Top row: checkbox + QR + the text (wraps cleanly on phones). */}
      <div className="flex min-w-0 items-start gap-3">
        {isAdmin && (
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={`Select unit ${p.tag}`}
            className="mt-0.5 shrink-0"
          />
        )}
        <QrChip payload={unitQr(p.tag)} label={`${group.name} · ${p.tag}`} />
        <Link to={`/part/${p._id}`} className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm font-medium">{p.tag}</p>
          {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
        </Link>
      </div>
      {/* Chip rows: status/details first, action buttons on their own row —
          nothing squeezes against anything on phones or portrait windows. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={p.status} />
          {/* On a project? One click takes the admin to the project page. */}
          {p.status === "on_project" && p.currentProjectId && (
            <Link
              to={`/projects/${p.currentProjectId}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-400 hover:border-violet-400 hover:text-violet-300"
              title={
                (activeProjects ?? []).find((x) => x._id === p.currentProjectId)?.name ??
                "Open assigned project"
              }
            >
              <ExternalLink className="size-3" />
              {(activeProjects ?? []).find((x) => x._id === p.currentProjectId)?.name ?? "project"}
            </Link>
          )}
          {!isAdmin && p.status === "pending" && myPending && (
            <span className="text-xs text-muted-foreground">your request pending</span>
          )}
          {!isAdmin && myActive && p.status === "rented" && (
            <span className="text-xs text-muted-foreground">with you</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.status === "available" && (
            <Button
              size="sm"
              variant={isAdmin ? "outline" : "default"}
              disabled={busyTag === p.tag || isStorageAlias}
              onClick={() => requestUnit(p._id, p.tag)}
            >
              {busyTag === p.tag ? (
                <LoadingGifInline size={18} className="size-4" />
              ) : (
                <Package className="size-4" />
              )}
              Request
            </Button>
          )}
          {isAdmin && p.status === "rented" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReturn(p.tag, p._id)}
            >
              <RotateCcw className="size-4" /> Return
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)} title="Edit this unit">
              <Pencil className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {editOpen && (
        <UnitEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          units={[p]}
          groups={groupsIndex ?? []}
          activeProjects={activeProjects}
        />
      )}
    </li>
  );
}

function cnUnitRow(selected: boolean) {
  return `flex flex-wrap items-center gap-3 px-4 py-3${selected ? " bg-primary/5" : ""}`;
}
/** A group is a container while it has children (it may gain/lose them over time). */
function isContainer(g: Doc<"groups">): boolean {
  return g.quantityTotal === 0 && !g.measure;
}
