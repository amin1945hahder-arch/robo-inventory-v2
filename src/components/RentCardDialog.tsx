import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Printer } from "lucide-react";

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

export type CardRow = {
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-neutral-200 pb-1">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

/** Printable rent card — a receipt with part, holder and dates. Renders as a
 *  dialog; the sheet itself (data-qr-label) is the only thing that prints. */
export function RentCardDialog({ r, onClose }: { r: CardRow; onClose: () => void }) {
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
