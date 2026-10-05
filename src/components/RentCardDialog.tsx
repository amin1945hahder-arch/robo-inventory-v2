import { useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useAction, useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Printer, SendHorizonal } from "lucide-react";
import { RentCardSheet, type RentCardData } from "@/components/RentCardPaper";
import { buildCardCaption } from "@/lib/rent-card-caption";
import { downloadCardPdf, elementToPdfBase64 } from "@/lib/rent-card-hifi";
import { prepareCardForPrint, cleanupCardPrint } from "@/lib/card-print-layout";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";

export type CardRow = RentCardData;

/** Manual rent-card dialog: print, download the PDF, or send it to the club
 *  group. All three operate on the SAME RentCardSheet element, so the PDF is
 *  always exactly what the admin sees — identical to the automated bot posts
 *  (which render this same sheet via the relay).
 *
 *  Printing and PDF generation follow the admin's card print layout
 *  (Admin Settings → Card print layout): page size, card size, position. */
export function RentCardDialog({ r, onClose }: { r: CardRow; onClose: () => void }) {
  const [busy, setBusy] = useState<"" | "pdf" | "send">("");
  const deliverRentCardPdf = useAction(api.rentCardTelegram.deliverRentCardPdf);
  const layout = useQuery(api.settings.getCardLayout, {});
  const caption = buildCardCaption(r, `🏷 Rent card · ${r.groupName} (${r.tag})`);

  const getSheet = (): HTMLElement => {
    const el = document.getElementById("rent-card-sheet")?.querySelector<HTMLElement>("[data-qr-label]");
    if (!el) throw new Error("Card not rendered");
    return el;
  };

  const printCard = () => {
    const el = getSheet();
    if (layout) prepareCardForPrint(layout, el);
    const done = () => cleanupCardPrint(el);
    window.removeEventListener("afterprint", done);
    window.addEventListener("afterprint", done, { once: true });
    window.print();
    // Fallback cleanup for browsers that never fire afterprint on cancel.
    setTimeout(done, 60_000);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rent card</DialogTitle>
        </DialogHeader>
        <div id="rent-card-sheet" className="flex justify-center overflow-hidden rounded-lg">
          <RentCardSheet card={r} qrMm={layout?.qrMm} />
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2 [&>button]:w-full [&>span]:w-full">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant="outline"
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("send");
              try {
                const { base64 } = await elementToPdfBase64(getSheet(), layout ?? undefined);
                const res = await deliverRentCardPdf({ pdfBase64: base64, captionLines: caption });
                if (res?.sent) toast.success("PDF sent to the club group");
                else toast.error(`Not sent: ${res?.reason ?? "unknown"}`);
              } catch (e) {
                toast.error(asMessage(e));
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "send" ? <LoadingGifInline size={18} className="size-4" /> : <SendHorizonal className="size-4" />}
            Send PDF to group
          </Button>
          <Button
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("pdf");
              try {
                await downloadCardPdf(getSheet(), `rent-card-${r.tag}.pdf`, layout ?? undefined);
                toast.success("PDF downloaded — identical to what the group receives");
              } catch (e) {
                toast.error(asMessage(e));
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "pdf" ? <LoadingGifInline size={18} className="size-4" /> : <Printer className="size-4" />}
            Download PDF
          </Button>
          <Button onClick={printCard}>
            <Printer className="size-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
