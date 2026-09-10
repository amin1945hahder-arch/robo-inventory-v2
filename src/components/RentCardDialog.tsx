import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Printer } from "lucide-react";
import QRCodeReact from "react-qr-code";
import { qrUrl } from "@/lib/qr";

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

export type CardRow = {
  rentalId: string;
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

/** Printable rent card — a receipt with part, holder, dates and a QR that
 *  re-opens this rental (rental:<id>). Renders as a dialog; the sheet itself
 *  (data-qr-label) is the only thing that prints. */
export function RentCardDialog({ r, onClose }: { r: CardRow; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rent card</DialogTitle>
        </DialogHeader>
        <div data-qr-label className="rounded-lg border bg-white p-5 text-black">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                Robotics Club · Rental Receipt
              </p>
              <p className="mt-1 text-lg font-bold leading-tight">{r.groupName}</p>
              <p className="font-mono text-xs text-neutral-600">{r.tag}</p>
            </div>
            {r.rentalId && (
              <div className="flex shrink-0 flex-col items-center gap-1">
                <QRCodeReact
                  value={qrUrl(`rental:${r.rentalId}`)}
                  size={80}
                  style={{ height: "auto", maxWidth: "100%" }}
                />
                <span className="font-mono text-[8px] text-neutral-400">scan to open</span>
              </div>
            )}
          </div>
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
