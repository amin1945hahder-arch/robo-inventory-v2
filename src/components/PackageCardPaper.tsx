import QRCodeReact from "react-qr-code";
import { qrUrl } from "@/lib/qr";

/** Data for one printable package card (whole bundle, all units listed). */
export type PackageCardData = {
  packageId: string;
  /** One row per line of the package: group + every unit tag. */
  lines: { groupName: string; units: { tag: string; status: string }[] }[];
  holderName: string;
  studentId?: string;
  statusLabel: string;
  requestedAt?: number;
  decidedAt?: number;
  pickupAt?: number;
  note?: string;
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

/**
 * Package card — the bundle-level twin of the per-unit RentCardSheet. ONE
 * printed card for the whole package request: every unit is listed (so the
 * physical checklist travels with the bundle) and the QR opens the package
 * in the app. Same white-card aesthetic as the unit card.
 */
export function PackageCardSheet({ card }: { card: PackageCardData }) {
  const unitCount = card.lines.reduce((n, l) => n + l.units.length, 0);
  return (
    <div
      data-qr-label
      className="w-full max-w-[360px] rounded-lg border bg-white p-5 text-black sm:w-[360px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Robotics Club · Package Receipt
          </p>
          <p className="mt-1 text-lg font-bold leading-tight">
            Package · {unitCount} unit{unitCount === 1 ? "" : "s"}
          </p>
          <p className="font-mono text-xs text-neutral-600">
            {card.packageId.slice(-8).toUpperCase()}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <QRCodeReact
            value={qrUrl(`package:${card.packageId}`)}
            size={80}
            style={{ height: "auto", maxWidth: "100%" }}
          />
          <span className="font-mono text-[8px] text-neutral-400">scan to open</span>
        </div>
      </div>
      <dl className="mt-4 space-y-1.5 text-[13px]">
        <Row k="Student" v={card.holderName} />
        {card.studentId && <Row k="Student ID" v={card.studentId} />}
        <Row k="Status" v={card.statusLabel} />
        {card.lines.map((l, i) => (
          <div key={i} className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {l.groupName} · {l.units.length}
            </p>
            {l.units.map((u, j) => (
              <div key={j} className="flex items-center justify-between font-mono text-[11px] leading-5">
                <span>• {u.tag}</span>
                <span className="text-neutral-400">{u.status}</span>
              </div>
            ))}
          </div>
        ))}
        <Row k="Requested" v={fmt(card.requestedAt)} />
        <Row k="Approved" v={fmt(card.decidedAt)} />
        {card.pickupAt && <Row k="Pick-up" v={fmt(card.pickupAt)} />}
        {card.note && <Row k="Note" v={card.note} />}
      </dl>
    </div>
  );
}
