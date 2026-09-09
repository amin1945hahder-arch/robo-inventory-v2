import { useState } from "react";
import QRCode from "react-qr-code";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { qrUrl } from "@/lib/qr";

/** Inline QR chip that expands to a printable label. Shown next to names everywhere.
 *  The code encodes the absolute app URL so ANY phone camera opens the app;
 *  the in-app scanner normalizes it back to the payload. */
export function QrChip({ payload, label }: { payload: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const value = qrUrl(payload);
  return (
    <>
      <button
        type="button"
        title="Show QR code"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 rounded border bg-white p-0.5 hover:opacity-80 transition-opacity"
      >
        <QRCode value={value} size={22} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>QR label</DialogTitle>
            <DialogDescription>
              Print this and attach it to the item. Scanning opens it in the app.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            <div data-qr-label className="rounded-lg border bg-white p-4">
              <QRCode value={value} size={180} />
            </div>
            <div className="text-center">
              {label && <p className="text-sm font-medium">{label}</p>}
              <p className="font-mono text-xs text-muted-foreground">{payload}</p>
              <p className="font-mono text-[10px] text-muted-foreground">{url}/qr?p=…</p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => window.print()}>
              Print label
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
