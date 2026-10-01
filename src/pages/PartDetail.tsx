import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useSound } from "@/hooks/use-sound";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { NavArrows } from "@/components/NavArrows";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RentCardDialog, type CardRow } from "@/components/RentCardDialog";
import { EditRentalDialog } from "@/components/EditRentalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { unitQr } from "@/lib/qr";
import { describePackSize, isPackGroup } from "@/lib/group-measure";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { ArrowLeft, ExternalLink, History, Pencil, Printer, Trash2 } from "lucide-react";
import { SquarePen } from "lucide-react";

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

type RentRow = {
  rental: any;
  part: any;
  group: any;
  student: any;
  projectName?: string;
};

// Projection handed to the printable rent card lives in RentCardDialog.tsx.
export default function PartDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const part = useQuery(api.parts.getPart, id ? { id: id as any } : "skip");
  const group = useQuery(api.catalog.getGroup, part ? { id: part.groupId } : "skip");
  // Sibling units for the ← → arrows (same group, sorted by tag).
  const siblings = useQuery(
    api.parts.listPartsOfGroup,
    part ? { groupId: part.groupId } : "skip",
  );
  const detail = useQuery(api.parts.getPartWithRental, id ? { id: id as any } : "skip");
  // Where the unit is held right now (live rental + package) — powers the
  // "open the request" jump for non-available units.
  const holding = useQuery(api.parts.holdingOfPart, part ? { partId: part._id } : "skip");
  // This unit's rental history only — subscribing to the entire ledger here
  // made every rental anywhere re-render the unit page.
  const rentals = useQuery(
    api.parts.rentalsOfPart,
    part ? { partId: part._id } : "skip",
  );
  const myRentals = useQuery(api.parts.listMyRentals, {});
  // Full-control editing: pick an active project and/or a holder member.
  const activeProjects = useQuery(api.projects.listProjects, isAdmin ? { status: "active" } : "skip");
  const people = useQuery(api.notifications.listPeople, isAdmin ? {} : "skip");

  const requestRental = useMutation(api.parts.requestRental);
  const rentBroken = useMutation(api.parts.rentBrokenPart);
  const updatePart = useMutation(api.parts.updatePart);
  const deletePart = useMutation(api.parts.deletePart);
  const returnDirect = useMutation(api.parts.setPartStatusDirect);
  const playSound = useSound();

  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  // Admin rental-record editor (dates/status/delete).
  const [editRentalFor, setEditRentalFor] = useState<any>(null);
  const [editTag, setEditTag] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editStatus, setEditStatus] = useState<string>("available");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editProjectId, setEditProjectId] = useState<string>("");
  const [editHolderId, setEditHolderId] = useState<string>("");
  const [editTakenAt, setEditTakenAt] = useState(""); // date, YYYY-MM-DD
  const [editDueAt, setEditDueAt] = useState(""); // date, YYYY-MM-DD
  // Move this unit into a different group ("" = keep its current group).
  const [editMoveGroupId, setEditMoveGroupId] = useState("");
  // Transferred state: where the unit went (shown only for transferred).
  const [editTransferName, setEditTransferName] = useState("");
  // Full group index: used by the unit editor AND to resolve the container
  // chain printed on the rent card (needed when the group sits in containers).
  const allGroups = useQuery(
    api.catalog.childGroupOptions,
    editOpen || group?.parentGroupId ? {} : "skip",
  );
  const [busy, setBusy] = useState(false);
  // Print-card projection handed to <RentCardDialog/>.
  const [card, setCard] = useState<CardRow | null>(null);

  // "Box A > Box B" — shown on the rent card so the unit can be re-shelved.
  const containerChain = useMemo(() => {
    if (!group?.parentGroupId) return "";
    const idx = new Map<string, Doc<"groups">>((allGroups ?? []).map((g) => [g._id, g]));
    const parts: string[] = [];
    let cur = idx.get(group.parentGroupId);
    let depth = 0;
    while (cur && depth < 10) {
      parts.unshift(cur.name);
      cur = cur.parentGroupId ? idx.get(cur.parentGroupId) : undefined;
      depth += 1;
    }
    return parts.join(" > ");
  }, [group, allGroups]);

  const partRentals: RentRow[] = ((rentals ?? []) as RentRow[])
    .filter((r) => r.part?._id === part?._id)
    .map((r) => ({ ...r, projectName: undefined }));
  // The live rental card to surface next to unit details (own, or latest for admins).
  const currentRental = detail?.shownRental ?? null;
  // Full row for the current rental: admins from listAllRentals, members from
  // their own rentals (which carry the real timestamps + student id).
  const currentRentRow: { rental: any; student?: { studentId?: string } | null } | null =
    currentRental
      ? ((rentals ?? []) as any[]).find((r) => r.rental._id === currentRental._id) ??
        ((myRentals ?? []) as any[]).find((r) => r.rental._id === currentRental._id) ??
        null
      : null;

  const iHoldIt = (myRentals ?? []).some(
    (r) => r.part?._id === part?._id && r.rental.status === "active",
  );
  const myPending = (myRentals ?? []).some(
    (r) => r.part?._id === part?._id && r.rental.status === "pending",
  );

  if (part === undefined) {
    return (
      <AppShell>
        <LoadingGif size={48} label={null} />
      </AppShell>
    );
  }
  if (part === null) {
    return (
      <AppShell>
        <p className="py-16 text-center text-sm text-muted-foreground">This unit no longer exists.</p>
      </AppShell>
    );
  }

  const siblingIds = (siblings ?? []).map((p) => p._id);

  // Weight/length units carry their own amount + minimum in the group's unit.
  const isBulkUnit = group?.measure === "weight" || group?.measure === "length";
  const bulkRemaining = part.amountRemaining !== undefined ? Number(part.amountRemaining) : undefined;
  const bulkLowAt = part.lowAt !== undefined ? Number(part.lowAt) : undefined;

  const request = async () => {
    if (!part || !group) return;
    setBusy(true);
    try {
      await requestRental({ partId: part._id, groupId: group._id, note: note.trim() || undefined });
      playSound("rental_request");
      toast.success("Request sent — the lab admin has been notified by email and dashboard");
      setNote("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <NavArrows
        items={siblingIds}
        currentId={part._id}
        onNavigate={(nid) => navigate(`/part/${nid}`)}
      />
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/group/${part.groupId}`)}>
            <ArrowLeft className="size-4" /> {group?.name ?? "Group"}
          </Button>
        </div>

        <header className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
          <div className="flex items-start gap-3">
            <QrChip payload={unitQr(part.tag)} label={`${group?.name ?? "Unit"} · ${part.tag}`} />
            {(part.imageUrl || group?.imageUrl) && (
              <img
                src={part.imageUrl || group?.imageUrl}
                alt={part.tag}
                className="size-14 shrink-0 glass-3d rounded-md border object-cover"
              />
            )}
            <div>
              <p className="font-mono text-xs text-muted-foreground">{part.tag}</p>
              <h1 className="text-2xl font-semibold tracking-tight">{group?.name ?? "Unit"}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={part.status} />
                {part.currentProjectId && (
                  <Link to={`/projects/${part.currentProjectId}`} className="text-xs text-muted-foreground underline">
                    assigned project
                  </Link>
                )}
                {/* Non-available unit → jump straight to its live request
                    (or the package it belongs to) in the Requests console. */}
                {holding && isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-[11px]"
                    title={`Open the ${holding.status} record${holding.packageId ? " (inside its package)" : ""} in Requests`}
                    onClick={() =>
                      navigate(
                        holding.packageId
                          ? `/admin/requests?tab=packages&package=${holding.packageId}`
                          : `/admin/requests?tab=pending&rental=${holding.rentalId}`,
                      )
                    }
                  >
                    <ExternalLink className="size-3" />
                    Open request
                  </Button>
                )}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditTag(part.tag);
                  setEditNote(part.note ?? "");
                  setEditStatus(part.status);
                  setEditImageUrl(part.imageUrl ?? "");
                  setEditProjectId(part.currentProjectId ?? "");
                  setEditHolderId(part.currentHolderId ?? "");
                  setEditTakenAt(part.rentedAt ? new Date(part.rentedAt).toISOString().slice(0, 10) : "");
                  setEditDueAt(part.dueAt ? new Date(part.dueAt).toISOString().slice(0, 10) : "");
                  setEditMoveGroupId("");
                  setEditTransferName(part.transferToName ?? "");
                  setEditOpen(true);
                }}
              >
                <Pencil className="size-4" /> Edit
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={async () => {
                  if (!confirm(`Delete unit ${part.tag}?`)) return;
                  try {
                    await deletePart({ id: part._id });
                    toast.success("Unit deleted");
                    navigate(`/group/${part.groupId}`);
                  } catch (e) {
                    toast.error(asMessage(e));
                  }
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          )}
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="glass-3d rounded-lg border">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Unit details</h2>
            </div>
            <dl className="divide-y text-sm">
              {[
                ["Group", group?.name],
                ["Brand", group?.brand],
                ["Model", group?.model],
                ["Tag", part.tag],
                ["Status", undefined],
                isBulkUnit
                  ? ["Amount on unit", bulkRemaining !== undefined ? `${bulkRemaining} ${group?.measureUnit ?? ""}` : "—"]
                  : null,
                isBulkUnit
                  ? ["Minimum kept", bulkLowAt !== undefined ? `${bulkLowAt} ${group?.measureUnit ?? ""}` : "—"]
                  : null,
                isPackGroup(group)
                  ? ["Pack size", describePackSize(group) || "—"]
                  : null,
                ["Note", part.note ?? "—"],
                part.status === "rented" && part.rentedAt
                  ? ["Taken on", new Date(part.rentedAt).toLocaleDateString()]
                  : null,
                part.status === "rented" && part.dueAt
                  ? ["Return by", new Date(part.dueAt).toLocaleDateString()]
                  : null,
                ["Description", group?.description ?? "—"],
              ]
                .filter((row): row is [string, string | undefined] => row !== null)
                .map(([label, value]) => (
                <div key={label as string} className="flex items-start justify-between gap-6 px-5 py-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">
                    {label === "Status" ? <StatusBadge status={part.status} /> : (value ?? "—")}
                  </dd>
                </div>
              ))}
              {group?.datasheetUrl && (
                <div className="flex items-center justify-between px-5 py-3">
                  <dt className="text-muted-foreground">Datasheet</dt>
                  <dd>
                    <a href={group.datasheetUrl} target="_blank" rel="noreferrer" className="underline">
                      Open
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="flex flex-col gap-6">
            {/* Rental card — surfaces the live rental (request or active loan) next to the unit. */}
            {currentRental && (
              <div className="glass-3d rounded-lg border border-primary/30">
                <div className="flex items-center justify-between border-b px-5 py-4">
                  <h2 className="text-sm font-semibold">Rental card</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCard({
                        rentalId: currentRental._id,
                        groupName: group?.name ?? "Unit",
                        tag: part.tag,
                        containerChain: containerChain || undefined,
                        holderName: currentRental.holderName,
                        studentId:
                          currentRentRow?.student?.studentId || user?.studentId || undefined,
                        statusLabel: currentRental.status,
                        requestedAt: currentRentRow?.rental.requestedAt ?? currentRental.requestedAt,
                        decidedAt: currentRentRow?.rental.decidedAt,
                        pickedUpAt: currentRentRow?.rental.pickedUpAt,
                        returnedAt: currentRentRow?.rental.returnedAt,
                        dueAt: currentRental.dueAt ?? currentRentRow?.rental.dueAt,
                        conditionReport:
                          currentRentRow?.rental.conditionReport ?? currentRental.note,
                        projectName: currentRental.projectName,
                      })
                    }
                    disabled={currentRental.status === "pending"}
                  >
                    <Printer className="size-3.5" />
                    {currentRental.status === "pending" ? "Print after approval" : "Print rent card"}
                  </Button>
                </div>
                <dl className="divide-y text-sm">
                  <div className="flex items-center justify-between gap-6 px-5 py-3">
                    <dt className="text-muted-foreground">Holder</dt>
                    <dd className="text-right font-medium">
                      {currentRental.holderName}
                      {currentRental.mine ? " (you)" : ""}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-6 px-5 py-3">
                    <dt className="text-muted-foreground">Rental state</dt>
                    <dd><StatusBadge status={currentRental.status} /></dd>
                  </div>
                  <div className="flex items-center justify-between gap-6 px-5 py-3">
                    <dt className="text-muted-foreground">Requested</dt>
                    <dd>{fmt(currentRental.requestedAt)}</dd>
                  </div>
                  {currentRental.status === "active" && currentRental.takenAt && (
                    <div className="flex items-center justify-between gap-6 px-5 py-3">
                      <dt className="text-muted-foreground">Taken on</dt>
                      <dd>{new Date(currentRental.takenAt).toLocaleDateString()}</dd>
                    </div>
                  )}
                  {currentRental.status === "active" && currentRental.dueAt && (
                    <div className="flex items-center justify-between gap-6 px-5 py-3">
                      <dt className="text-muted-foreground">Return by</dt>
                      <dd className={currentRental.dueAt < Date.now() ? "font-semibold text-red-400" : ""}>
                        {new Date(currentRental.dueAt).toLocaleDateString()}
                        {currentRental.dueAt < Date.now() ? " · overdue" : ""}
                      </dd>
                    </div>
                  )}
                  {currentRental.projectName && (
                    <div className="flex items-center justify-between gap-6 px-5 py-3">
                      <dt className="text-muted-foreground">Project</dt>
                      <dd>
                        {currentRental.projectName}
                      </dd>
                    </div>
                  )}
                  {currentRental.note && (
                    <div className="flex items-start justify-between gap-6 px-5 py-3">
                      <dt className="text-muted-foreground">Note</dt>
                      <dd className="text-right">{currentRental.note}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <div className="glass-3d rounded-lg border">
              <div className="border-b px-5 py-4">
                <h2 className="text-sm font-semibold">Rental</h2>
              </div>
              <div className="flex flex-col gap-3 px-5 py-4">
                {part.status === "available" && (
                  <>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional note for the admin (why you need it, for how long…)"
                      rows={2}
                    />
                    <Button onClick={request} disabled={busy}>
                      {busy ? "Sending…" : "Request rental"}
                    </Button>
                  </>
                )}
                {part.status === "pending" && (
                  <p className="text-sm text-muted-foreground">
                    A rental request for this unit is awaiting the admin's decision.
                    {myPending && " This is your request."}
                  </p>
                )}
                {part.status === "rented" && (iHoldIt || isAdmin) && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">
                      {isAdmin
                        ? "Process the return from the Rentals page or scan this unit there."
                        : "Once you bring it back, the admin confirms the return."}
                    </p>
                    {isAdmin && (
                      <>
                        <Label>Admin quick return</Label>
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await returnDirect({ partId: part._id, functional: true });
                              toast.success("Returned to shelf");
                            } catch (e) {
                              toast.error(asMessage(e));
                            }
                          }}
                        >
                          Return to shelf (works)
                        </Button>
                        <Button
                          variant="outline"
                          onClick={async () => {
                            try {
                              await returnDirect({ partId: part._id, functional: false });
                              toast.success("Marked broken");
                            } catch (e) {
                              toast.error(asMessage(e));
                            }
                          }}
                        >
                          Mark broken
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {part.status === "on_project" && (
                  <p className="text-sm text-muted-foreground">
                    This unit is checked out to a project until the project is dismantled.
                  </p>
                )}
                {part.status === "transferred" && (
                  <p className="text-sm text-muted-foreground">
                    📤 Transferred out of the club inventory — kept on record with its QR. An admin
                    can bring it back via Edit → available.
                  </p>
                )}
                {part.status === "consumed" && (
                  <p className="text-sm text-muted-foreground">
                    Fully consumed — written off during routine inventory. An admin can restock it
                    via Edit → available.
                  </p>
                )}
                {part.status === "broken" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">
                      Marked broken — waiting on repair. An admin can change the status via Edit.
                    </p>
                    {!myPending && (
                      <>
                        <Textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Why do you need the broken unit? (repair, spare parts, refurb project…)"
                          rows={2}
                        />
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await rentBroken({ partId: part._id, note: note.trim() || undefined });
                              playSound("rental_request");
                              toast.success("Broken-unit request sent — an admin will review it");
                              setNote("");
                            } catch (e) {
                              toast.error(asMessage(e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Request this broken unit
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Broken units can only be requested from the unit's own page — the admin
                          sees the broken flag when deciding. Admins can request too (e.g. to send
                          a unit out for repair with a tracked loan record).
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="glass-3d rounded-lg border">
              <div className="flex items-center gap-2 border-b px-5 py-4">
                <History className="size-4" />
                <h2 className="text-sm font-semibold">History</h2>
              </div>
              {partRentals.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No rental history yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {partRentals.slice(0, 8).map((row) => (
                    <li key={row.rental._id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <Avatar className="size-7 shrink-0">
                        <AvatarImage src={row.student?.image} />
                        <AvatarFallback className="text-[11px] font-semibold">
                          {(row.student?.name ?? row.student?.email ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {row.student?.name ?? row.student?.email ?? "Member"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(row.rental.requestedAt).toLocaleDateString()}
                          {row.rental.conditionReport ? ` · ${row.rental.conditionReport}` : ""}
                        </p>
                        {row.rental.returnDestination === "transferred" && (
                          <p className="text-xs font-medium text-orange-400">
                            📤 Transferred to {row.rental.transferToName ?? "—"}
                            {row.rental.recoveredAmount !== undefined
                              ? ` · recovered ${row.rental.recoveredAmount}`
                              : ""}
                            {row.rental.transferDocName &&
                              row.rental.transferDocUrl && (
                                <>
                                  {" · "}
                                  {row.rental.transferDocMime?.startsWith("image/") ? (
                                    <a
                                      href={row.rental.transferDocUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline"
                                    >
                                      view doc photo
                                    </a>
                                  ) : (
                                    <a
                                      href={row.rental.transferDocUrl}
                                      download={row.rental.transferDocName}
                                      className="underline"
                                    >
                                      download {row.rental.transferDocName}
                                    </a>
                                  )}
                                </>
                              )}
                          </p>
                        )}
                        {row.rental.recoveredAmount !== undefined &&
                          row.rental.returnDestination === "shelf" && (
                            <p className="text-xs text-muted-foreground">
                              Recovered {row.rental.recoveredAmount} of the taken amount — the
                              difference was consumed.
                            </p>
                          )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditRentalFor(row.rental)}
                            title="Edit or delete this record"
                          >
                            <SquarePen className="size-3.5" />
                          </Button>
                        )}
                        {row.rental.status !== "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setCard({
                                rentalId: row.rental._id,
                                groupName: group?.name ?? "Unit",
                                tag: part.tag,
                                containerChain: containerChain || undefined,
                                holderName: row.student?.name ?? row.student?.email ?? "Member",
                                studentId: row.student?.studentId || undefined,
                                statusLabel: row.rental.status,
                                requestedAt: row.rental.requestedAt,
                                decidedAt: row.rental.decidedAt,
                                pickedUpAt: row.rental.pickedUpAt,
                                returnedAt: row.rental.returnedAt,
                                conditionReport: row.rental.conditionReport,
                              })
                            }
                          >
                            <Printer className="size-3.5" /> Card
                          </Button>
                        )}
                        <StatusBadge status={row.rental.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      {card && <RentCardDialog r={card} onClose={() => setCard(null)} />}

      {editRentalFor && (
        <EditRentalDialog
          open={Boolean(editRentalFor)}
          onOpenChange={(v) => !v && setEditRentalFor(null)}
          rental={editRentalFor}
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>          <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit unit</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Tag</Label>
              <Input value={editTag} onChange={(e) => setEditTag(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <select
                className="h-9 glass-3d rounded-md border bg-background px-3 text-sm"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
              >
                {["available", "rented", "on_project", "transferred", "broken", "consumed"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {/* Transferred state: destination settings (mutually exclusive
                with project / holder — a unit is either transferred away or
                checked out, never both). */}
            {editStatus === "transferred" && (
              <div className="grid gap-2 glass-3d rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <Label>Transferred to *</Label>
                <Input
                  value={editTransferName}
                  onChange={(e) => setEditTransferName(e.target.value)}
                  placeholder="e.g. Mechatronics dept., a donated school lab…"
                />
                <p className="text-xs text-muted-foreground">
                  The unit leaves the circulating inventory and stays on record
                  with this destination. A transferred unit cannot be on a
                  project or rented at the same time.
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Assigned project</Label>
              <select
                className="h-9 glass-3d rounded-md border bg-background px-3 text-sm"
                value={editProjectId}
                onChange={(e) => setEditProjectId(e.target.value)}
              >
                <option value="">— None (not on a project) —</option>
                {(activeProjects ?? []).map((p: any) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Picking a project checks the unit out to it until the project is dismantled.
              </p>
            </div>
            {editStatus === "rented" && (
              <div className="grid gap-2">
                <Label>Rented by (holder)</Label>
                <select
                  className="h-9 glass-3d rounded-md border bg-background px-3 text-sm"
                  value={editHolderId}
                  onChange={(e) => setEditHolderId(e.target.value)}
                >
                  <option value="">— Pick a member —</option>
                  {(people ?? []).map((p: any) => (
                    <option key={p.user._id} value={p.user._id}>
                      {p.user.name ?? p.user.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {editStatus === "rented" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Taken on</Label>
                  <Input
                    type="date"
                    value={editTakenAt}
                    onChange={(e) => setEditTakenAt(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Return by</Label>
                  <Input
                    type="date"
                    value={editDueAt}
                    onChange={(e) => setEditDueAt(e.target.value)}
                  />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Optional lend dates — when the member got the unit and when it should come back.
                  Both are shown on the unit page and tracked in the rental ledger.
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2} />
            </div>
            <div className="grid gap-2">
              <Label>Move to group</Label>
              <select
                className="h-9 glass-3d rounded-md border bg-background px-3 text-sm"
                value={editMoveGroupId}
                onChange={(e) => setEditMoveGroupId(e.target.value)}
              >
                <option value="">— Keep in {group?.name ?? "current group"} —</option>
                {(allGroups ?? [])
                  .filter((g) => g._id !== part.groupId)
                  .filter((g) => !g.measure || g.measure === "count")
                  .map((g) => (
                    <option key={g._id} value={g._id}>{g.name}</option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The unit keeps its QR tag and history — only its home card
                changes. Shelf units only (available / broken).
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Unit image URL</Label>
              <Input
                value={editImageUrl}
                onChange={(e) => setEditImageUrl(e.target.value)}
                placeholder="https://… (falls back to the group image)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  const isTransfer = editStatus === "transferred";
                  const wantsProject = !isTransfer && editProjectId !== "";
                  const wantsHolder = !isTransfer && editStatus === "rented";
                  if (wantsProject && wantsHolder) {
                    toast.error("A unit is either on a project or rented — pick one");
                    return;
                  }
                  if (wantsHolder && editHolderId === "") {
                    toast.error("Pick the member who holds the unit");
                    return;
                  }
                  if (isTransfer && !editTransferName.trim()) {
                    toast.error("Enter where the unit was transferred to");
                    return;
                  }
                  await updatePart({
                    id: part._id,
                    tag: editTag,
                    note: editNote,
                    status: editStatus as any,
                    imageUrl: editImageUrl.trim() || "",
                    // Transferred excludes project + holder; leaving the
                    // transferred state clears the destination too.
                    projectId: isTransfer ? null : wantsProject ? (editProjectId as any) : null,
                    holderId: isTransfer ? null : wantsHolder ? (editHolderId as any) : null,
                    transferToName: isTransfer ? editTransferName.trim() : "",
                    rentedAt: wantsHolder && editTakenAt ? new Date(editTakenAt).getTime() : null,
                    dueAt: wantsHolder && editDueAt ? new Date(editDueAt).getTime() : null,
                    moveGroupId: editMoveGroupId ? (editMoveGroupId as any) : undefined,
                  });
                  toast.success("Unit updated");
                  setEditOpen(false);
                } catch (e) {
                  toast.error(asMessage(e));
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
