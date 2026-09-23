import { useEffect, useState } from "react";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { unitQr } from "@/lib/qr";
import { Link } from "react-router";
import { Beaker, PackageOpen, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel";

export function isBulkGroup(
  group: Doc<"groups"> | null | undefined,
): boolean {
  return group?.measure === "weight" || group?.measure === "length";
}

function fmtAmount(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * Routine-consumption dialog (NOT a rental): log that some amount of this
 * reel/spool was used up in the lab, or write the whole unit off in one
 * click. The per-unit minimum does not apply — this is an inventory-truth
 * adjustment, so the ledger always matches what is physically left.
 */
export function ConsumeBulkDialog({
  open,
  onOpenChange,
  group,
  unit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: Doc<"groups">;
  unit: Doc<"parts">;
}) {
  const consume = useMutation(api.catalog.consumeBulkUnit);
  const log = useQuery(api.catalog.consumptionLog, open ? { partId: unit._id } : "skip");

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setNote("");
    }
  }, [open]);

  const remaining = Number(unit.amountRemaining ?? 0);
  const unitLabel = group.measureUnit ?? "units";

  const submit = async (fully: boolean) => {
    if (busy) return;
    const num = Number(amount);
    if (!fully && (!Number.isFinite(num) || num <= 0)) {
      toast.error(`Enter the consumed amount (in ${unitLabel})`);
      return;
    }
    setBusy(true);
    try {
      const res = await consume({
        partId: unit._id,
        ...(fully ? { fully: true } : { amount: num }),
        note: note.trim() || undefined,
      });
      toast.success(
        fully
          ? `Fully consumed — ${res.consumed} ${unitLabel} written off`
          : `${res.consumed} ${unitLabel} logged as consumed`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update consumption — {unit.tag}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <p className="text-sm text-muted-foreground">
            Currently holding <b className="text-foreground">{fmtAmount(remaining)} {unitLabel}</b>. This
            is a routine inventory write — no rental, no minimum applies.
          </p>
          <div className="grid gap-2">
            <Label>Consumed amount ({unitLabel})</Label>
            <Input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`e.g. 0.5 ${unitLabel}`}
            />
          </div>
          <div className="grid gap-2">
            <Label>Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. monthly stock check, used for line follower build"
            />
          </div>
          <Button variant="outline" onClick={() => submit(false)} disabled={busy || remaining <= 0}>
            <Beaker className="size-4" /> Log consumption
          </Button>
          <Button variant="destructive" onClick={() => submit(true)} disabled={busy || remaining <= 0}>
            <PackageOpen className="size-4" /> Fully consumed — write off the whole unit
          </Button>
          {(log ?? []).length > 0 && (
            <div className="mt-1">
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Recent consumption entries
              </p>
              <ul className="flex flex-col gap-1">
                {(log ?? []).slice(0, 6).map((entry: any, i: number) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className={entry.amount < 0 ? "text-rose-400" : "text-emerald-400"}>
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount} {unitLabel}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.via} · {entry.byName ?? "—"} · {new Date(entry.at).toLocaleDateString()}
                      {entry.note ? ` · ${entry.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Unit list for weight/length (bulk) groups: every physical reel/spool/tube
 * with its remaining amount, per-unit minimum, own QR tag and status. Admins
 * can re-measure a unit (amount + minimum) after a partial use in the lab,
 * and log routine consumption (partial or full) without a rental.
 */
export function GroupDetailUnits({
  group,
  parts,
  isAdmin,
  onEdit,
  onConsume,
}: {
  group: Doc<"groups">;
  parts: Doc<"parts">[] | undefined;
  isAdmin: boolean;
  onEdit: (unit: Doc<"parts">) => void;
  onConsume: (unit: Doc<"parts">) => void;
}) {
  const unitLabel = group.measureUnit ?? "";
  const units = (parts ?? []).filter((p) => p.tag !== "BULK");
  const total = units.reduce((s, p) => s + Number(p.amountRemaining ?? 0), 0);
  const available = units.filter((p) => p.status === "available");
  const availableTotal = available.reduce((s, p) => s + Number(p.amountRemaining ?? 0), 0);
  const outTotal = total - availableTotal;
  const consumedCount = units.filter((p) => p.consumedAt !== undefined).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Units · {units.length} reel{units.length === 1 ? "" : "s"}/spool{units.length === 1 ? "" : "s"}, each with its own QR
        </h2>
        <p className="text-xs text-muted-foreground">
          {fmtAmount(total)} {unitLabel} total · {fmtAmount(availableTotal)} on the shelf
          {outTotal > 0 ? ` · ${fmtAmount(outTotal)} out` : ""}
          {consumedCount > 0 ? ` · ${consumedCount} fully consumed` : ""}
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
              const consumed = p.consumedAt !== undefined;
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
                  {consumed && (
                    <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-400">
                      fully consumed
                    </span>
                  )}
                  <StatusBadge status={p.status} />
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={p.status === "rented"}
                      title={p.status === "rented" ? "Process the rental return first" : "Log routine consumption"}
                      onClick={() => onConsume(p)}
                    >
                      <Beaker className="size-3.5" /> Update consumption
                    </Button>
                  )}
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
