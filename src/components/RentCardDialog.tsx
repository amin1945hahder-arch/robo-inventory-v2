import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Printer, SendHorizonal } from "lucide-react";
import QRCodeReact from "react-qr-code";
import { qrUrl } from "@/lib/qr";
import { downloadCardPdf, elementToPdfBase64 } from "@/lib/rent-card-hifi";
import { toast } from "sonner";

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
 *  (data-qr-label) is the only thing that prints. The PDF download and the
 *  "send to group" action capture THIS EXACT element, so what the admin sees
 *  is what Telegram receives — Arabic included, pixel-perfect. */
export function RentCardDialog({ r, onClose }: { r: CardRow; onClose: () => void }) {
  const [busy, setBusy] = useState<"" | "pdf" | "send">("");
  const deliverRentCardPdf = useAction(api.rentCardTelegram.deliverRentCardPdf);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rent card</DialogTitle>
        </DialogHeader>
        <div
          data-qr-label
          id="rent-card-sheet"
          className="rounded-lg border bg-white p-5 text-black">
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
          <Button
            variant="outline"
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("send");
              try {
                const el = document.getElementById("rent-card-sheet") as HTMLElement | null;
                if (!el) throw new Error("Card not rendered");
                const { base64 } = await elementToPdfBase64(el);
                const res = await deliverRentCardPdf({
                  pdfBase64: base64,
                  captionLines: [
                    `🏷 Item: ${r.groupName} (${r.tag})`,
                    `👤 Student: ${r.holderName}${r.studentId ? ` · ${r.studentId}` : ""}`,
                    `📌 Status: ${r.statusLabel}`,
                    ...(r.projectName ? [`🤖 Project: ${r.projectName}`] : []),
                    ...(r.requestedAt ? [`📅 Requested: ${new Date(r.requestedAt).toLocaleString("en-GB")}`] : []),
                    ...(r.decidedAt ? [`✅ Decided: ${new Date(r.decidedAt).toLocaleString("en-GB")}`] : []),
                    ...(r.pickedUpAt ? [`📦 Picked up: ${new Date(r.pickedUpAt).toLocaleString("en-GB")}`] : []),
                    ...(r.returnedAt ? [`↩️ Returned: ${new Date(r.returnedAt).toLocaleString("en-GB")}`] : []),
                    ...(r.conditionReport ? [`📝 Condition: ${r.conditionReport}`] : []),
                  ].join("\n"),
                });
                if (res?.sent) toast.success("PDF sent to the club group");
                else toast.error(`Not sent: ${res?.reason ?? "unknown"}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
            Send PDF to group
          </Button>
          <Button
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("pdf");
              try {
                const el = document.getElementById("rent-card-sheet") as HTMLElement | null;
                if (!el) throw new Error("Card not rendered");
                await downloadCardPdf(el, `rent-card-${r.tag}.pdf`);
                toast.success("PDF downloaded — identical to what the group receives");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
            Download PDF
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
