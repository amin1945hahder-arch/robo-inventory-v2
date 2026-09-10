import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { RentCardDialog, type CardRow } from "@/components/RentCardDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PackageSearch, Printer, RotateCcw, X } from "lucide-react";

export default function MyRentals() {
  const { user } = useAuth();
  const rentals = useQuery(api.parts.listMyRentals, {});
  const cooldownHours = useQuery(api.settings.getReturnCooldown, {});
  const cancel = useMutation(api.parts.cancelMyRequest);
  const requestReturn = useMutation(api.parts.requestReturn);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [card, setCard] = useState<{ row: any; tag: string; groupName: string } | null>(null);

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
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rentals.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
            <PackageSearch className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No rentals yet. Browse the <Link to="/inventory" className="underline">inventory</Link> or
              scan a unit in the lab.
            </p>
          </div>
        ) : (
          groups.map(({ title, statuses }) => {
            const rows = rentals.filter((r) => statuses.includes(r.rental.status));
            if (rows.length === 0) return null;
            return (
              <section key={title} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">{title}</h2>
                <ul className="divide-y rounded-lg border">
                  {rows.map(({ rental, part, group, projectName }) => (
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
                          {projectName ? ` · ${projectName}` : ""}
                          {rental.conditionReport ? ` · ${rental.conditionReport}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={rental.status} />
                      {rental.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === rental._id}
                          onClick={async () => {
                            setBusyId(rental._id);
                            try {
                              await cancel({ rentalId: rental._id });
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
          })
        )}
      </div>

      {card && (
        <RentCardDialog
          r={{
            rentalId: card.row._id ?? card.row.rental?._id,
            groupName: card.groupName,
            tag: card.tag,
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
    </AppShell>
  );
}
