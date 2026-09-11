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
import { PackageBuilderDialog } from "@/components/PackageBuilderDialog";
import { groupQr, unitQr } from "@/lib/qr";
import { toast } from "sonner";
import { ArrowLeft, Loader2, PackagePlus, Package, RotateCcw } from "lucide-react";

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
  const playSound = useSound();

  const [returnFor, setReturnFor] = useState<{ rentalId: string; partId: string; tag: string } | null>(null);
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
              <QrChip payload={groupQr(group.name)} label={group.name} />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[group.brand, group.model].filter(Boolean).join(" · ") || "Component group"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await addPart({ groupId: group._id, count: 1 });
                      playSound("assigned");
                      toast.success("Unit added with a new QR tag");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  <PackagePlus className="size-4" /> Add unit
                </Button>
              )}
              {!isAdmin && (
                <div className="flex flex-col items-end gap-2">
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
                      disabled={availableUnits.length === 0 || qtyBusy}
                      onClick={requestQuantity}
                    >
                      {qtyBusy ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
                      {availableUnits.length > 0 ? `Request ${qty} unit${qty > 1 ? "s" : ""}` : "No units available"}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={availableUnits.length === 0}
                    onClick={() => setPkgOpen(true)}
                  >
                    <PackagePlus className="size-4" /> Build a package (multiple items)
                  </Button>
                </div>
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

          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-5">
            {[
              ["Total", total, ""],
              ["Available", s?.available ?? 0, "text-emerald-400"],
              ["Rented", s?.rented ?? 0, "text-sky-400"],
              ["On projects", s?.onProject ?? 0, "text-violet-400"],
              ["Broken", s?.broken ?? 0, "text-rose-400"],
            ].map(([label, value, cls]) => (
              <div key={label as string} className="bg-background px-5 py-5">
                <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {label}
                </p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls ?? ""}`}>
                  {value as number}
                </p>
              </div>
            ))}
          </section>

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
                      {!isAdmin && p.status === "available" && (
                        <Button
                          size="sm"
                          disabled={busyTag === p.tag}
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
                              setReturnFor({ rentalId: hit.rental._id, partId: p._id, tag: p.tag });
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
        />
      )}

      <PackageBuilderDialog
        open={pkgOpen}
        onOpenChange={setPkgOpen}
        presetGroupId={group?._id}
        onDone={() => playSound("rental_request")}
      />
    </AppShell>
  );
}