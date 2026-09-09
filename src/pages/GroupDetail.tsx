import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ReturnDialog } from "@/components/ReturnDialog";
import { groupQr, unitQr } from "@/lib/qr";
import { toast } from "sonner";
import { ArrowLeft, PackagePlus, RotateCcw } from "lucide-react";

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

  const [returnFor, setReturnFor] = useState<{ rentalId: string; partId: string; tag: string } | null>(null);

  // active rental ids for this user (to show return/assign options)
  const myActivePartIds = new Set(
    (myRentals ?? [])
      .filter((r) => r.rental.status === "active" && r.part)
      .map((r) => r.part!._id),
  );

  const s = stats?.[id ?? ""];
  const total = s?.total ?? 0;

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
            <div className="flex gap-2 hidden sm:inline-flex">
              {isAdmin && (
                <Button variant="outline" onClick={async () => {
                  try {
                    await addPart({ groupId: group._id, count: 1 });
                    toast.success("Unit added with a new QR tag");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}>
                  <PackagePlus className="size-4" /> Add unit
                </Button>
              )}
              <Button asChild>
                <Link to={`/group/${group._id}/rent`}>Request rental</Link>
              </Button>
            </div>
          </header>

          {group.description && (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{group.description}</p>
          )}

          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-5">
            {[
              ["Total", total, ""],
              ["Available", s?.available ?? 0, "text-emerald-600"],
              ["Rented", s?.rented ?? 0, "text-sky-600"],
              ["On projects", s?.onProject ?? 0, "text-violet-600"],
              ["Broken", s?.broken ?? 0, "text-rose-600"],
            ].map(([label, value, cls]) => (
              <div key={label as string} className="bg-background px-5 py-5">
                <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{value as number}</p>
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
                  return (
                    <li key={p._id} className="flex items-center gap-3 px-4 py-3">
                      <QrChip payload={unitQr(p.tag)} label={`${group.name} · ${p.tag}`} />
                      <Link to={`/part/${p._id}`} className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-medium">{p.tag}</p>
                        {p.note && <p className="truncate text-xs text-muted-foreground">{p.note}</p>}
                      </Link>
                      <StatusBadge status={p.status} />
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
                      {iHold && p.status === "rented" && (
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
    </AppShell>
  );
}
