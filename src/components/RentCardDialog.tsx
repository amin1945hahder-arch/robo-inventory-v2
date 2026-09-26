import { useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
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
import { RentCardSheet, type RentCardData } from "@/components/RentCardPaper";
import { buildCardCaption } from "@/lib/rent-card-caption";
import { downloadCardPdf, elementToPdfBase64 } from "@/lib/rent-card-hifi";
import { toast } from "sonner";

export type CardRow = RentCardData;

/** Manual rent-card dialog: print, download the PDF, or send it to the club
 *  group. All three operate on the SAME RentCardSheet element, so the PDF is
 *  always exactly what the admin sees — identical to the automated bot posts
 *  (which render this same sheet via the relay). */
export function RentCardDialog({ r, onClose }: { r: CardRow; onClose: () => void }) {
  const [busy, setBusy] = useState<"" | "pdf" | "send">("");
  const deliverRentCardPdf = useAction(api.rentCardTelegram.deliverRentCardPdf);
  const caption = buildCardCaption(r, `🏷 Rent card · ${r.groupName} (${r.tag})`);

  const getSheet = (): HTMLElement => {
    const el = document.getElementById("rent-card-sheet");
    if (!el) throw new Error("Card not rendered");
    return el as HTMLElement;
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rent card</DialogTitle>
        </DialogHeader>
        <div id="rent-card-sheet" className="overflow-hidden rounded-lg">
          <RentCardSheet card={r} />
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2 [&>button]:w-full [&>span]:w-full">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant="outline"
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("send");
              try {
                const { base64 } = await elementToPdfBase64(getSheet());
                const res = await deliverRentCardPdf({ pdfBase64: base64, captionLines: caption });
                if (res?.sent) toast.success("PDF sent to the club group");
                else toast.error(`Not sent: ${res?.reason ?? "unknown"}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
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
                await downloadCardPdf(getSheet(), `rent-card-${r.tag}.pdf`);
                toast.success("PDF downloaded — identical to what the group receives");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "pdf" ? <LoadingGifInline size={18} className="size-4" /> : <Printer className="size-4" />}
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
