import { useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useAction, useQuery } from "convex/react";
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
import { PackageCardSheet, type PackageCardData } from "@/components/PackageCardPaper";
import { downloadCardPdf, elementToPdfBase64 } from "@/lib/rent-card-hifi";
import { prepareCardForPrint, cleanupCardPrint } from "@/lib/card-print-layout";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";

/**
 * Whole-package card dialog — the bundle-level twin of RentCardDialog. ONE
 * card for the entire package request: every unit listed, QR opens the
 * package. Same three actions: print, download the PDF, send to the group.
 * Print/PDF follow the admin's card print layout (Admin Settings → Card
 * print layout).
 */
export function PackageCardDialog({
  card,
  onClose,
}: {
  card: PackageCardData;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"" | "pdf" | "send">("");
  const deliverRentCardPdf = useAction(api.rentCardTelegram.deliverRentCardPdf);
  const layout = useQuery(api.settings.getCardLayout, {});
  // One field per line, same style as the unit card caption.
  const caption = [
    `🏷 Package card · ${card.lines.reduce((n, l) => n + l.units.length, 0)} unit(s)`,
    `👤 Student: ${card.holderName}${card.studentId ? ` · ${card.studentId}` : ""}`,
    `📌 Status: ${card.statusLabel}`,
    ...card.lines.map((l) => `• ${l.groupName}: ${l.units.map((u) => u.tag).join(", ")}`),
    card.note ? `📝 Note: ${card.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const getSheet = (): HTMLElement => {
    const el = document
      .getElementById("package-card-sheet")
      ?.querySelector<HTMLElement>("[data-qr-label]");
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
    setTimeout(done, 60_000);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Package card</DialogTitle>
        </DialogHeader>
        <div id="package-card-sheet" className="flex justify-center overflow-hidden rounded-lg">
          <PackageCardSheet card={card} />
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-2 [&>button]:w-full [&>span]:w-full">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("send");
              try {
                const { base64 } = await elementToPdfBase64(getSheet(), layout ?? undefined);
                const res = await deliverRentCardPdf({
                  pdfBase64: base64,
                  captionLines: caption,
                });
                if (res?.sent) toast.success("Package card sent to the club group");
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
                await downloadCardPdf(getSheet(), `package-card-${card.packageId.slice(-8)}.pdf`, layout ?? undefined);
                toast.success("PDF downloaded");
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
