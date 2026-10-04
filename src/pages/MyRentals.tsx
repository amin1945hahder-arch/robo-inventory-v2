import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useSound } from "@/hooks/use-sound";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { StatusBadge } from "@/components/StatusBadge";
import { RentCardDialog, type CardRow } from "@/components/RentCardDialog";
import { EditRentalDialog } from "@/components/EditRentalDialog";
import { containerChainOf } from "@/lib/container-chain";
import { packageDisplayStatus } from "@/lib/package-status";
import { PackageBuilderDialog } from "@/components/PackageBuilderDialog";
import { formatLineAmount } from "@/lib/group-measure";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tabColor } from "@/lib/utils";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Activity, Boxes, History, Loader2, PackageSearch, Pencil, Printer, RotateCcw, X } from "lucide-react";

/** Per-tab hues for the colored tab bar (same treatment as the admin console). */
const MY_TAB_COLORS: Record<string, string> = {
  packages: "#a78bfa",
  active: "#34d399",
  history: "#94a3b8",
};

/** Count chip inside a tab trigger — stays legible on the colored tint. */
function TabChip({ n }: { n: number }) {
  return (
    <span className="rounded-full border bg-black/20 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
      {n}
    </span>
  );
}

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
  // Bar of tabs: package bundles, everything live, and the closed records —
  // one pane at a time like every other console page.
  const [tab, setTab] = useState<"packages" | "active" | "history">("active");
  // Group index for resolving container chains on the admin rent cards.
  const groupsIndex = useQuery(api.catalog.childGroupOptions, {});

  const groups: { title: string; statuses: string[] }[] = [
    { title: "Awaiting approval", statuses: ["pending"] },
    { title: "Active — with you", statuses: ["active"] },
    { title: "Assigned to projects", statuses: ["on_project"] },
    { title: "History", statuses: ["returned", "denied", "canceled"] },
  ];

  // Tab split + per-tab counts (package units are excluded: they render as
  // bundle cards on the Packages tab, keeping chips and lists in sync).
  const singles = (rentals ?? []).filter((r: any) => !r.rental.packageId);
  const activeSingles = singles.filter((r: any) =>
    ["pending", "approved", "active", "on_project"].includes(r.rental.status),
  );
  const historySingles = singles.filter((r: any) =>
    ["returned", "denied", "canceled"].includes(r.rental.status),
  );
  const pkgCount = (packages ?? []).length;

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
          <div className="flex flex-col items-center gap-3 glass-3d rounded-lg border border-dashed px-6 py-16 text-center">
            <PackageSearch className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No rentals yet. Browse the <Link to="/inventory" className="underline">inventory</Link> or
              scan a unit in the lab.
            </p>
          </div>
        ) : (
          <Tabs
            className="flex flex-col gap-8"
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
          >
            {/* Colored bar of tabs — same treatment as the admin console. */}
            <TabsList className="colored-tabs flex h-auto max-w-full flex-wrap justify-start gap-1.5 p-1">
              <TabsTrigger value="packages" className="flex-none gap-1.5" style={tabColor(MY_TAB_COLORS.packages)}>
                <Boxes className="size-3.5" />
                Packages
                {pkgCount > 0 && <TabChip n={pkgCount} />}
              </TabsTrigger>
              <TabsTrigger value="active" className="flex-none gap-1.5" style={tabColor(MY_TAB_COLORS.active)}>
                <Activity className="size-3.5" />
                Active
                {activeSingles.length > 0 && <TabChip n={activeSingles.length} />}
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-none gap-1.5" style={tabColor(MY_TAB_COLORS.history)}>
                <History className="size-3.5" />
                History
                {historySingles.length > 0 && <TabChip n={historySingles.length} />}
              </TabsTrigger>
            </TabsList>

            {/* Package bundles */}
            <TabsContent value="packages" className="flex flex-col gap-8">
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
                      <li key={pkg._id} className="glass-3d rounded-lg border p-4">
                        {/* Chip rows: info on top, actions on their own row —
                            side-by-side only with real width headroom. */}
                        <div className="flex items-start gap-3">
                          <Boxes className="size-5 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-sm font-medium">
                              {lines.map((l: any) => (
                                <span key={l.groupId} className="break-words">
                                  {formatLineAmount(l, groupsIndex?.find((g: any) => g._id === l.groupId))} {l.groupName}
                                </span>
                              ))}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Requested {new Date(pkg.requestedAt).toLocaleDateString()} ·{" "}
                              {totalUnits} unit(s)
                              {pkg.status === "approved"
                                ? ` · ${activeUnits} still out${approvedUnits > 0 ? `, ${approvedUnits} awaiting pick-up` : ""}, ${returnedUnits} processed${
                                    activeUnits === 0 && approvedUnits === 0 && returnedUnits > 0 ? " — fully returned" : ""
                                  }`
                                : ""}
                              {pkg.note ? ` · ${pkg.note}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <StatusBadge
                            status={
                              packageDisplayStatus(pkg.status, { approvedUnits, activeUnits, returnedUnits })
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
                                    toast.error(asMessage(e));
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
                                  toast.error(asMessage(e));
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

            {pkgCount === 0 && (
              <div className="flex flex-col items-center gap-3 glass-3d rounded-lg border border-dashed px-6 py-10 text-center">
                <PackageSearch className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No package requests yet — pick several units from the{" "}
                  <Link to="/inventory" className="underline">inventory</Link> to rent them as one bundle.
                </p>
              </div>
            )}
            </TabsContent>

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
              // Every group is its own tab panel: the first three groups are
              // live → the Active tab, the last one is the History tab.
              const tabKey = title === "History" ? "history" : "active";
              return (
                <TabsContent key={title} value={tabKey} className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold">{title === "Awaiting approval" ? "Requests & scheduled pickups" : title}</h2>
                  <ul className="divide-y glass-3d rounded-lg border">
                    {visible.map(({ rental, part, group, projectName }) => (
                      <li key={rental._id} className="flex flex-col gap-2 px-4 py-3 wide:flex-row wide:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium">
                            {group?.name ?? "Part"}
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
                        <div className="flex flex-wrap items-center gap-2 wide:ml-auto wide:justify-end">
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
                                toast.error(asMessage(e));
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
                                toast.error(asMessage(e));
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
                        </div>
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              );
            })}

            {/* Empty tabs explain where the content went. */}
            {activeSingles.length === 0 && (
              <TabsContent value="active" className="flex flex-col gap-3">
                <div className="flex flex-col items-center gap-3 glass-3d rounded-lg border border-dashed px-6 py-10 text-center">
                  <Activity className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Nothing pending or with you right now. Browse the{" "}
                    <Link to="/inventory" className="underline">inventory</Link> or scan a unit in the lab.
                  </p>
                </div>
              </TabsContent>
            )}
            {historySingles.length === 0 && (
              <TabsContent value="history" className="flex flex-col gap-3">
                <div className="flex flex-col items-center gap-3 glass-3d rounded-lg border border-dashed px-6 py-10 text-center">
                  <History className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No closed rentals yet — returned, denied and canceled requests collect here.
                  </p>
                </div>
              </TabsContent>
            )}
          </Tabs>
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
            dueAt: card.row.dueAt,
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
