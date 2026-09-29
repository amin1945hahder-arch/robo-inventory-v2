import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQrScanner } from "@/hooks/use-qr-scanner";
import { Camera, ScanLine } from "lucide-react";

interface QrScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (text: string) => void;
  hint?: string;
}

/** Camera scanner dialog used everywhere QR codes are scanned. */
export function QrScanDialog({ open, onOpenChange, onResult, hint }: QrScanDialogProps) {
  const { videoRef, canvasRef, scanning, error } = useQrScanner(onResult, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="size-4" /> Scan QR code
          </DialogTitle>
          <DialogDescription>{hint ?? "Point the camera at a club QR label."}</DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden glass-3d rounded-lg border bg-black/90 aspect-square">
          <video ref={videoRef} className="absolute inset-0 size-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
          {scanning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="size-48 glass-3d rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
          {!scanning && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
              Starting camera…
            </div>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <Camera className="size-4" /> Restart camera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
