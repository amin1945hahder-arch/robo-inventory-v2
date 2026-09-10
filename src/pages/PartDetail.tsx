import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
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
import { toast } from "sonner";
import { ArrowLeft, History, Pencil, Printer, Trash2 } from "lucide-react";

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

/** Printable rent card — a receipt with the club logo mark, part, holder and dates. */
function RentCard({ r, onClose }: { r: CardRow; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rent card</DialogTitle>
        </DialogHeader>
        <div data-qr-label className="rounded-lg border bg-white p-5 text-black">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Robotics Club · Rental Receipt
          </p>
          <p className="mt-1 text-lg font-bold leading-tight">{r.groupName}</p>
          <p className="font-mono text-xs text-neutral-600">{r.tag}</p>
          <dl className="mt-4 space-y-1.5 text-[13px]">
            <Row k="Student" v={r.holderName} />
            {r.studentId && <Row k="Student ID" v={r.studentId} />}
            <Row k="Status" v={r.statusLabel} />
            <Row k="Requested" v={fmt(r.requestedAt)} />
            <Row k="Approved / picked up" v={fmt(r.decidedAt ?? r.pickedUpAt)} />
            <Row k="Returned" v={fmt(r.returnedAt)} />
            {r.projectName && <Row k="Project" v={r.projectName} />}
            {r.conditionReport && <Row k="Condition" v={r.conditionReport} />}
          </dl>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Print rent card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-neutral-200 pb-1">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

type RentRow = {
  rental: any;
  part: any;
  group: any;
  student: any;
  projectName?: string;
};

// Projection handed to the printable rent card.
type CardRow = {
  groupName: string;
  tag: string;
  holderName: string;
  studentId?: string;
  statusLabel: string;
  requestedAt?: number;
  decidedAt?: number;
  pickedUpAt?: number;
  returnedAt?: number;
  conditionReport?: string;
  projectName?: string;
};

export default function PartDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const part = useQuery(api.parts.getPart, id ? { id: id as any } : "skip");
  const group = useQuery(api.catalog.getGroup, part ? { id: part.groupId } : "skip");
  const detail = useQuery(api.parts.getPartWithRental, id ? { id: id as any } : "skip");
  const rentals = useQuery(api.parts.listAllRentals, isAdmin ? {} : "skip");
  const myRentals = useQuery(api.parts.listMyRentals, {});

  const requestRental = useMutation(api.parts.requestRental);
  const updatePart = useMutation(api.parts.updatePart);
  const deletePart = useMutation(api.parts.deletePart);
  const returnDirect = useMutation(api.parts.setPartStatusDirect);

  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTag, setEditTag] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editStatus, setEditStatus] = useState<string>("available");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<RentRow | null>(null);

  const partRentals: RentRow[] = ((rentals ?? []) as RentRow[])
    .filter((r) => r.part?._id === part?._id)
    .map((r) => ({ ...r, projectName: undefined }));
  // The live rental card to surface next to unit details (own, or latest for admins).
  const currentRental = detail?.shownRental ?? null;
  const currentRentRow = currentRental
    ? (rentals ?? []).find((r) => r.rental._id === currentRental._id) ?? null
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
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
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

  const request = async () => {
    if (!part || !group) return;
    setBusy(true);
    try {
      await requestRental({ partId: part._id, groupId: group._id, note: note.trim() || undefined });
      toast.success("Request sent — the lab admin has been notified by email and dashboard");
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/group/${part.groupId}`)}>
            <ArrowLeft className="size-4" /> {group?.name ?? "Group"}
          </Button>
        </div>

        <header className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
          <div className="flex items-start gap-3">
            <QrChip payload={unitQr(part.tag)} label={`${group?.name ?? "Unit"} · ${part.tag}`} />
            <div>
              <p className="font-mono text-xs text-muted-foreground">{part.tag}</p>
              <h1 className="text-2xl font-semibold tracking-tight">{group?.name ?? "Unit"}</h1>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={part.status} />
                {part.currentProjectId && (
                  <Link to={`/projects/${part.currentProjectId}`} className="text-xs text-muted-foreground underline">
                    assigned project
                  </Link>
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
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          )}
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border">
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
                ["Note", part.note ?? "—"],
                ["Description", group?.description ?? "—"],
              ].map(([label, value]) => (
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
            {currentRentRow && (
              <div className="rounded-lg border border-primary/30">
                <div className="flex items-center justify-between border-b px-5 py-4">
                  <h2 className="text-sm font-semibold">Rental card</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCard(currentRentRow as RentRow)}

                    disabled={currentRentRow.rental.status === "pending"}
                  >
                    <Printer className="size-3.5" />
                    {currentRentRow.rental.status === "pending" ? "Print after approval" : "Print rent card"}
                  </Button>
                </div>
                <dl className="divide-y text-sm">
                  <div className="flex items-center justify-between gap-6 px-5 py-3">
                    <dt className="text-muted-foreground">Holder</dt>
                    <dd className="text-right font-medium">
                      {currentRental!.holderName}
                      {currentRental!.mine ? " (you)" : ""}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-6 px-5 py-3">
                    <dt className="text-muted-foreground">Rental state</dt>
                    <dd><StatusBadge status={currentRental!.status} /></dd>
                  </div>
                  <div className="flex items-center justify-between gap-6 px-5 py-3">
                    <dt className="text-muted-foreground">Requested</dt>
                    <dd>{fmt(currentRental!.requestedAt)}</dd>
                  </div>
                  {currentRental!.projectName && (
                    <div className="flex items-center justify-between gap-6 px-5 py-3">
                      <dt className="text-muted-foreground">Project</dt>
                      <dd>
                        {currentRental!.holderId && currentRental!.projectName ? (
                          <Link to={`/projects/${part.currentProjectId ?? ""}`} className="underline">
                            {currentRental!.projectName}
                          </Link>
                        ) : (
                          currentRental!.projectName
                        )}
                      </dd>
                    </div>
                  )}
                  {currentRental!.note && (
                    <div className="flex items-start justify-between gap-6 px-5 py-3">
                      <dt className="text-muted-foreground">Note</dt>
                      <dd className="text-right">{currentRental!.note}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <div className="rounded-lg border">
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
                              toast.error(e instanceof Error ? e.message : "Failed");
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
                              toast.error(e instanceof Error ? e.message : "Failed");
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
                {part.status === "broken" && (
                  <p className="text-sm text-muted-foreground">
                    Marked broken — waiting on repair. An admin can change the status via Edit.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg border">
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
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {row.student?.name ?? row.student?.email ?? "Member"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(row.rental.requestedAt).toLocaleDateString()}
                          {row.rental.conditionReport ? ` · ${row.rental.conditionReport}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {row.rental.status !== "pending" && (
                          <Button size="sm" variant="ghost" onClick={() => setCard(row)}>
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

      {card && (
        <RentCard
          r={{
            groupName: group?.name ?? "Unit",
            tag: part.tag,
            holderName: card.student?.name ?? card.student?.email ?? "Member",
            studentId: card.student?.studentId || undefined,
            statusLabel: card.rental.status,
            requestedAt: card.rental.requestedAt,
            decidedAt: card.rental.decidedAt,
            pickedUpAt: card.rental.pickedUpAt,
            returnedAt: card.rental.returnedAt,
            conditionReport: card.rental.conditionReport,
          }}
          onClose={() => setCard(null)}
        />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
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
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
              >
                {["available", "pending", "rented", "on_project", "broken"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  await updatePart({
                    id: part._id,
                    tag: editTag,
                    note: editNote,
                    status: editStatus as any,
                  });
                  toast.success("Unit updated");
                  setEditOpen(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
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
