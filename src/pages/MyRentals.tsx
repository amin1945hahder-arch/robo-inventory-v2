import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useSound } from "@/hooks/use-sound";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { StatusBadge } from "@/components/StatusBadge";
import { RentCardDialog, type CardRow } from "@/components/RentCardDialog";
import { EditRentalDialog } from "@/components/EditRentalDialog";
import { containerChainOf } from "@/lib/container-chain";
import { PackageBuilderDialog } from "@/components/PackageBuilderDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Boxes, Loader2, PackageSearch, Pencil, Printer, RotateCcw, X } from "lucide-react";

export default function MyRentals() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const rentals = useQuery(api.parts.listMyRentals, {});
  const packages = useQuery(api.parts.listPackages, {});
  const cooldownHours = useQuery(api.settings.getReturnCooldown, {});
  const cancel = useMutation(api.parts.cancelMyRequest);
  const requestReturn = useMutation(api.parts.requestReturn);
  const cancelPkg = useMutation(api.parts.cancelPackage);
  const returnPkg = useMutation(api.parts.requestPackageReturn);
  const playSound = useSound();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [card, setCard] = useState<{
    row: any;
    tag: string;
    groupName: string;
    container?: string;
  } | null>(null);
  const [editPkgId, setEditPkgId] = useState<string | null>(null);
  const [editRentalFor, setEditRentalFor] = useState<any>(null);
  // Group index for resolving container chains on the admin rent cards.
  const groupsIndex = useQuery(api.catalog.childGroupOptions, {});

  const groups: { title: string; statuses: string[] }[] = [
    { title: "Awaiting approval", statuses: ["pending"] },
    { title: "Active — with you", statuses: ["active"] },
    { title: "Assigned to projects", statuses: ["on_project"] },
    { title: "History", statuses: ["returned", "denied", "canceled"] },
  ];

  // Cooldown: one return request per rental per configured period.
  const cooldownMs = (cooldownHours ?? 24) * 36e5;
  const returnPending = (r: any) =>
    r.returnRequestedAt !== undefined && Date.now() - r.returnRequestedAt < cooldownMs;
  const hoursLeft = (r: any) =>
    Math.max(0, Math.ceil((cooldownMs - (Date.now() - r.returnRequestedAt)) / 36e5));

  // Packages not yet decided get pulled out of the single list so they render
  // once as a bundle card (their units are pending rentals with packageId).
  const pkgById = new Map<string, any>();
  for (const p of packages ?? []) pkgById.set(p.package._id, p);
  const pendingSingle = (rentals ?? []).filter(
    (r) => r.rental.status === "pending" && !r.rental.packageId,
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">My rentals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you've requested, hold, or had assigned to projects.
          </p>
        </header>

        {rentals === undefined ? (
          <LoadingGif size={48} label={null} />
        ) : rentals.length === 0 && (packages ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
            <PackageSearch className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No rentals yet. Browse the <Link to="/inventory" className="underline">inventory</Link> or
              scan a unit in the lab.
            </p>
          </div>
        ) : (
          <>
            {/* Package bundles */}
            {(packages ?? []).length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Package requests</h2>
                <ul className="flex flex-col gap-3">
                  {(packages ?? []).map(({ package: pkg, lines, openUnits, totalUnits, returnedUnits, approvedUnits, activeUnits }) => {
                    const isPending = pkg.status === "pending";
                    const returnFlagged =
                      pkg.returnRequestedAt !== undefined &&
                      Date.now() - pkg.returnRequestedAt < cooldownMs;
                    return (
                      <li key={pkg._id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <Boxes className="size-5 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {lines.map((l: any) => `${l.requested}× ${l.groupName}`).join(" · ")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Requested {new Date(pkg.requestedAt).toLocaleDateString()} ·{" "}
                              {totalUnits} unit(s)
                              {pkg.status === "approved"
                                ? ` · ${activeUnits} still out${approvedUnits > 0 ? `, ${approvedUnits} awaiting pick-up` : ""}, ${returnedUnits} processed`
                                : ""}
                              {pkg.note ? ` · ${pkg.note}` : ""}
                            </p>
                          </div>
                          <StatusBadge
                            status={
                              pkg.status === "canceled"
                                ? "canceled"
                                : pkg.status === "pending"
                                  ? "pending"
                                  : activeUnits > 0
                                    ? "active"
                                    : "approved"
                            }
                          />
                          {isPending && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditPkgId(pkg._id)}
                                title="Change items or quantities while it's pending"
                              >
                                <Pencil className="size-4" /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyId === pkg._id}
                                onClick={async () => {
                                  setBusyId(pkg._id);
                                  try {
                                    await cancelPkg({ packageId: pkg._id });
                                    playSound("notification");
                                    toast.success("Package canceled — units released");
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : "Failed");
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                              >
                                <X className="size-4" /> Cancel
                              </Button>
                            </>
                          )}
                          {pkg.status === "approved" && activeUnits > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === pkg._id || returnFlagged}
                              title={
                                returnFlagged
                                  ? `Return already requested.${hoursLeft(pkg) > 0 ? ` You can send another in ${hoursLeft(pkg)}h.` : ""}`
                                  : "Ask the admins to process the return of the whole package"
                              }
                              onClick={async () => {
                                setBusyId(pkg._id);
                                try {
                                  await returnPkg({ packageId: pkg._id });
                                  playSound("returned");
                                  toast.success("Return request sent — bring the package to the lab");
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Failed");
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              <RotateCcw className="size-4" />
                              {returnFlagged ? "Return requested" : "I want to return"}
                            </Button>
                          )}
                        </div>
                        {/* Per-unit lines */}
                        <ul className="mt-3 flex flex-col gap-1 border-t pt-3">
                          {lines.map((l: any) =>
                            l.units.length === 0 ? (
                              <li key={l.groupId} className="text-xs text-muted-foreground">
                                {l.groupName}: waiting for admin processing
                              </li>
                            ) : (
                              l.units.map((u: any) => (
                                <li key={u.rentalId} className="flex flex-wrap items-center gap-2 text-xs">
                                  <Link to={`/part/${u.partId}`} className="font-mono underline-offset-2 hover:underline">
                                    {u.tag}
                                  </Link>
                                  <StatusBadge status={u.status} />
                                  {isAdmin && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-5 px-1.5 text-[10px]"
                                      title="Edit or delete this record"
                                      onClick={() => setEditRentalFor({ ...u, _id: u.rentalId })}
                                    >
                                      <Pencil className="size-3" />
                                    </Button>
                                  )}
                                  {u.rentBroken && (
                                    <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                                      rented as broken
                                    </span>
                                  )}
                                </li>
                              ))
                            ),
                          )}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Single-unit rentals — package units render once above as
                bundle cards, so they are filtered out here and the pending
                section shows only true singles (badge counts stay in sync). */}
            {groups.map(({ title, statuses }) => {
              const visible = title === "Awaiting approval"
                ? rentals.filter(
                    (r) =>
                      !r.rental.packageId &&
                      (r.rental.status === "pending" || r.rental.status === "approved"),
                  )
                : rentals.filter((r) => !r.rental.packageId && statuses.includes(r.rental.status));
              if (visible.length === 0) return null;
              return (
                <section key={title} className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold">{title === "Awaiting approval" ? "Requests & scheduled pickups" : title}</h2>
                  <ul className="divide-y rounded-lg border">
                    {visible.map(({ rental, part, group, projectName }) => (
                      <li key={rental._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {group?.name ?? "Part"}{" "}
                            {part && (
                              <span className="font-mono text-xs text-muted-foreground">{part.tag}</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Requested {new Date(rental.requestedAt).toLocaleDateString()}
                            {rental.status === "approved" && rental.pickupAt
                              ? ` · 📅 pick-up ${new Date(rental.pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                              : ""}
                            {rental.amount !== undefined
                              ? ` · ${rental.amount} ${group?.measureUnit ?? ""}`
                              : ""}
                            {projectName ? ` · ${projectName}` : ""}
                            {rental.conditionReport ? ` · ${rental.conditionReport}` : ""}
                          </p>
                        </div>
                        <StatusBadge status={rental.status} />
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Edit or delete this record"
                            onClick={() => setEditRentalFor(rental)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        {rental.status === "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === rental._id}
                            onClick={async () => {
                              setBusyId(rental._id);
                              try {
                                await cancel({ rentalId: rental._id });
                                playSound("notification");
                                toast.success("Request canceled");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed");
                              } finally {
                                setBusyId(null);
                              }
                            }}
                          >
                            <X className="size-4" /> Cancel
                          </Button>
                        )}
                        {rental.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === rental._id || returnPending(rental)}
                            title={
                              returnPending(rental)
                                ? `You already asked to return this — the admin has been notified.${hoursLeft(rental) > 0 ? ` You can send another one in ${hoursLeft(rental)}h.` : ""}`
                                : "Notify the admins that you want to return this part"
                            }
                            onClick={async () => {
                              setBusyId(rental._id);
                              try {
                                await requestReturn({ rentalId: rental._id });
                                playSound("returned");
                                toast.success("Return request sent — bring the part to the lab");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed");
                              } finally {
                                setBusyId(null);
                              }
                            }}
                          >
                            <RotateCcw className="size-4" />
                            {returnPending(rental) ? "Return requested" : "I want to return"}
                          </Button>
                        )}
                        {rental.status !== "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Print rent card"
                            onClick={() =>
                              setCard({
                                row: rental,
                                tag: part?.tag ?? "—",
                                groupName: group?.name ?? "Part",
                                container: containerChainOf(group, groupsIndex ?? []),
                              })
                            }
                          >
                            <Printer className="size-4" /> Card
                          </Button>
                        )}
                        {part && (
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/part/${part._id}`}>Details</Link>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>

      {card && (
        <RentCardDialog
          r={{
            rentalId: card.row._id ?? card.row.rental?._id,
            groupName: card.groupName,
            tag: card.tag,
            containerChain: card.container || undefined,
            holderName: user?.name ?? user?.email ?? "Member",
            studentId: user?.studentId || undefined,
            statusLabel: card.row.status,
            requestedAt: card.row.requestedAt,
            decidedAt: card.row.decidedAt,
            pickedUpAt: card.row.pickedUpAt,
            returnedAt: card.row.returnedAt,
            conditionReport: card.row.conditionReport,
            projectName: card.row.projectName,
          } as CardRow}
          onClose={() => setCard(null)}
        />
      )}

      {editRentalFor && (
        <EditRentalDialog
          open={Boolean(editRentalFor)}
          onOpenChange={(v) => !v && setEditRentalFor(null)}
          rental={editRentalFor}
        />
      )}

      <PackageBuilderDialog
        open={editPkgId !== null}
        onOpenChange={(v) => !v && setEditPkgId(null)}
        editPackageId={editPkgId}
      />
    </AppShell>
  );
}
