import QRCodeReact from "react-qr-code";
import { qrUrl } from "@/lib/qr";

/** Data for one printable rent card (shared by the dialog, downloads and
 *  the automated Telegram relay — everyone renders THIS component). */
export type RentCardData = {
  rentalId?: string;
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
  /** Bulk (weight/length) rentals carry the amount + unit, e.g. 0.25 kg. */
  amount?: number;
  amountUnit?: string;
  projectName?: string;
  /** Package rentals list every unit of the bundle on the card itself. */
  extraUnits?: { tag: string; groupName: string }[];
  /** "Box A > Box B" — where the unit lives (when it is inside containers). */
  containerChain?: string;
};

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-neutral-200 pb-1">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

/** Printable rent card — a receipt with part, holder, dates and a QR that
 *  re-opens the rental (rental:<id>). This EXACT element is what becomes the
 *  PDF for downloads, manual sends AND every automated bot post, so the
 *  group always receives the identical card — Arabic included, pixel-perfect.
 *  Wrap it in an element with `data-qr-label` when printing.
 *
 *  The card keeps its 360px print layout on paper/desktop, but scales down
 *  to fit narrow phone screens (width 100% of its container) so nothing is
 *  ever trimmed from the right in the mobile dialog. */
export function RentCardSheet({ card }: { card: RentCardData }) {
  return (
    <div
      data-qr-label
      className="w-full max-w-[360px] rounded-lg border bg-white p-5 text-black sm:w-[360px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Robotics Club · Rental Receipt
          </p>
          <p className="mt-1 text-lg font-bold leading-tight">{card.groupName}</p>
          <p className="font-mono text-xs text-neutral-600">{card.tag}</p>
        </div>
        {card.rentalId && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <QRCodeReact
              value={qrUrl(`rental:${card.rentalId}`)}
              size={80}
              style={{ height: "auto", maxWidth: "100%" }}
            />
            <span className="font-mono text-[8px] text-neutral-400">scan to open</span>
          </div>
        )}
      </div>
      <dl className="mt-4 space-y-1.5 text-[13px]">
        <Row k="Student" v={card.holderName} />
        {card.studentId && <Row k="Student ID" v={card.studentId} />}
        {card.containerChain && (
          <Row k="Container" v={card.containerChain} />
        )}
        <Row k="Status" v={card.statusLabel} />
        {card.extraUnits && card.extraUnits.length > 0 && (
          <div className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5">
            {card.extraUnits.map((u, i) => (
              <div key={`${u.tag}-${i}`} className="font-mono text-[11px] leading-5">
                • {u.groupName} ({u.tag})
              </div>
            ))}
          </div>
        )}
        <Row k="Requested" v={fmt(card.requestedAt)} />
        <Row k="Approved / picked up" v={fmt(card.decidedAt ?? card.pickedUpAt)} />
        <Row k="Returned" v={fmt(card.returnedAt)} />
        {card.projectName && <Row k="Project" v={card.projectName} />}
        {card.conditionReport && <Row k="Condition" v={card.conditionReport} />}
      </dl>
    </div>
  );
}
