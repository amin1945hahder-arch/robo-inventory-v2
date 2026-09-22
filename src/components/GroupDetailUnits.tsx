import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import type { Doc } from "@/convex/_generated/dataModel";
import { unitQr } from "@/lib/qr";
import { Link } from "react-router";
import { Pencil } from "lucide-react";

export function isBulkGroup(
  group: Doc<"groups"> | null | undefined,
): boolean {
  return group?.measure === "weight" || group?.measure === "length";
}

function fmtAmount(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * Unit list for weight/length (bulk) groups: every physical reel/spool/tube
 * with its remaining amount, per-unit minimum, own QR tag and status. Admins
 * can re-measure a unit (amount + minimum) after a partial use in the lab.
 */
export function GroupDetailUnits({
  group,
  parts,
  isAdmin,
  onEdit,
}: {
  group: Doc<"groups">;
  parts: Doc<"parts">[] | undefined;
  isAdmin: boolean;
  onEdit: (unit: Doc<"parts">) => void;
}) {
  const unitLabel = group.measureUnit ?? "";
  const units = (parts ?? []).filter((p) => p.tag !== "BULK");
  const total = units.reduce((s, p) => s + Number(p.amountRemaining ?? 0), 0);
  const available = units.filter((p) => p.status === "available");
  const availableTotal = available.reduce((s, p) => s + Number(p.amountRemaining ?? 0), 0);
  const outTotal = total - availableTotal;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Units · {units.length} reel{units.length === 1 ? "" : "s"}/spool{units.length === 1 ? "" : "s"}, each with its own QR
        </h2>
        <p className="text-xs text-muted-foreground">
          {fmtAmount(total)} {unitLabel} total · {fmtAmount(availableTotal)} on the shelf
          {outTotal > 0 ? ` · ${fmtAmount(outTotal)} out` : ""}
        </p>
      </div>
      {parts === undefined ? (
        <p className="text-sm text-muted-foreground">Loading units…</p>
      ) : units.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No units yet — add the first reel/spool with its amount.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {units
            .slice()
            .sort((a, b) => a.tag.localeCompare(b.tag))
            .map((p) => {
              const remaining = Number(p.amountRemaining ?? 0);
              const lowAt = Number(p.lowAt ?? group.measureLowAt ?? 0);
              const low = remaining > 0 && remaining <= lowAt;
              return (
                <li key={p._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <QrChip payload={unitQr(p.tag)} label={`${group.name} · ${p.tag}`} />
                  <Link to={`/part/${p._id}`} className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium">{p.tag}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtAmount(remaining)} {unitLabel}
                      {lowAt > 0 ? ` · min ${fmtAmount(lowAt)}` : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </Link>
                  {low && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                      at minimum
                    </span>
                  )}
                  {remaining <= 0 && (
                    <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
                      empty
                    </span>
                  )}
                  <StatusBadge status={p.status} />
                  {isAdmin && p.status !== "rented" && (
                    <Button size="sm" variant="outline" onClick={() => onEdit(p)}>
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}
