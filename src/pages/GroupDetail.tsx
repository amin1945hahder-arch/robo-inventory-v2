import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useSound } from "@/hooks/use-sound";
import { AppShell } from "@/components/AppShell";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReturnDialog } from "@/components/ReturnDialog";
import { GroupCard } from "@/components/GroupCard";
import { PackageBuilderDialog } from "@/components/PackageBuilderDialog";
import { GroupDetailUnits, isBulkGroup, ConsumeBulkDialog } from "@/components/GroupDetailUnits";
import { BulkUnitDialog } from "@/components/BulkUnitDialog";
import { GroupFormDialog } from "@/components/GroupFormDialog";
import { groupQr, unitQr } from "@/lib/qr";
import { toast } from "sonner";
import { ArrowLeft, Box, Loader2, PackagePlus, Package, RotateCcw, Scale } from "lucide-react";
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
  const [busyTag, setBusyTag] = useState<string | null>(null);
  // Quantity picker for the "request N units" flow.
  const [qty, setQty] = useState(1);
  const [qtyBusy, setQtyBusy] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);

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
  const availableUnits = (parts ?? []).filter((p) => p.status === "available");
  // Bulk stock group (weight/length): rentals deduct an amount, not units.
  const isBulk = isBulkGroup(group);
  const stock = Number(group?.measureStock ?? 0);
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
      toast.error(e instanceof Error ? e.message : "Failed");
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
      toast.success(`${res.created} unit(s) requested — the lab admin has been notified`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send request");
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
      toast.error(e instanceof Error ? e.message : "Failed to send request");
    } finally {
      setBusyTag(null);
    }
  };

  return (
    <AppShell>
      {!group ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/inventory")}>
              <ArrowLeft className="size-4" /> Inventory
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
                      // Bulk units need their amount up front — open the dialog.
                      setBulkUnitEdit(null);
                      setBulkUnitOpen(true);
                    } else {
                      addPart({ groupId: group._id, count: 1 })
                        .then(() => {
                          playSound("assigned");
                          toast.success("Unit added with a new QR tag");
                        })
                        .catch((e: unknown) =>
                          toast.error(e instanceof Error ? e.message : "Failed"),
                        );
                    }
                  }}
                >
                  <PackagePlus className="size-4" /> Add unit
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
                  Masters hold groups only — no lending UI. */}
              {isMaster ? null : isBulk ? (
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
                      {qtyBusy ? <Loader2 className="size-4 animate-spin" /> : <Scale className="size-4" />}
                      Request amount
                    </Button>
                  </div>
                  {isAdmin && (
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
                      {qtyBusy ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
                      {availableUnits.length > 0 ? `Request ${qty} unit${qty > 1 ? "s" : ""}` : "No units available"}
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
              className="h-44 w-full rounded-lg border object-cover"
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
                            toast.error(e instanceof Error ? e.message : "Failed");
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
            <section className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
              {[
                ["Stock", `${stock} ${group.measureUnit}`, ""],
                ["Low-stock at", group.measureLowAt ? `${group.measureLowAt} ${group.measureUnit}` : "—", ""],
                [
                  "Status",
                  group.measureLowAt && stock <= Number(group.measureLowAt) ? "⚠️ LOW" : "OK",
                  group.measureLowAt && stock <= Number(group.measureLowAt) ? "text-rose-400" : "text-emerald-400",
                ],
              ].map(([label, value, cls]) => (
                <div key={label as string} className="bg-background px-5 py-5">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{value}</p>
                </div>
              ))}
            </section>
          ) : (
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
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
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Units · each with its own QR</h2>
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
            {parts === undefined ? (
              <p className="text-sm text-muted-foreground">Loading units…</p>
            ) : parts.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                No units yet.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {parts.map((p) => {
                  const iHold = myActivePartIds.has(p._id);
                  const iPending = myPendingPartIds.has(p._id);
                  return (
                    <li key={p._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <QrChip payload={unitQr(p.tag)} label={`${group.name} · ${p.tag}`} />
                      <Link to={`/part/${p._id}`} className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-medium">{p.tag}</p>
                        {p.note && <p className="truncate text-xs text-muted-foreground">{p.note}</p>}
                      </Link>
                      <StatusBadge status={p.status} />
                      {p.status === "available" && (
                        <Button
                          size="sm"
                          variant={isAdmin ? "outline" : "default"}
                          disabled={busyTag === p.tag || isStorageAlias}
                          onClick={() => requestUnit(p._id, p.tag)}
                        >
                          {busyTag === p.tag ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Package className="size-4" />
                          )}
                          Request
                        </Button>
                      )}
                      {!isAdmin && p.status === "pending" && iPending && (
                        <span className="text-xs text-muted-foreground">your request pending</span>
                      )}
                      {isAdmin && p.status === "rented" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const hit = (activeRentals ?? []).find((r) => r.part?._id === p._id);
                            if (hit) {
                              setReturnFor({ rentalId: hit.rental._id, partId: p._id, tag: p.tag, amount: hit.rental.amount });
                            } else {
                              toast.info("No active rental found for this unit");
                            }
                          }}
                        >
                          <RotateCcw className="size-4" /> Return
                        </Button>
                      )}
                      {!isAdmin && iHold && p.status === "rented" && (
                        <span className="text-xs text-muted-foreground">with you</span>
                      )}
                    </li>
                  );
                })}
              </ul>
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
    </AppShell>
  );
}