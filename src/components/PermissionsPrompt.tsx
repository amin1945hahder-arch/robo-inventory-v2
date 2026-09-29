import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Camera, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STORAGE_KEY = "roboShelf.permissions.camera";

type Phase = "idle" | "asking" | "granted" | "denied" | "unavailable";

/**
 * One-time startup prompt: right after the app loads it asks the user to grant
 * camera access (required for QR scanning). The decision is remembered in
 * localStorage so it never nags again; if the browser later blocks it, the
 * scan dialog's own error messaging takes over.
 */
export function PermissionsPrompt() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    // Only run once per browser, and never inside iframes that can't show
    // their own permission UI (the toolbar preview) — guard by checking that
    // the Permissions API exists at all.
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      /* private mode: fall through and still ask once */
    }
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  const remember = (status: "granted" | "dismissed") => {
    try {
      window.localStorage.setItem(STORAGE_KEY, status);
    } catch {
      /* ignore */
    }
  };

  const askCamera = async () => {
    setPhase("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      // Got permission — release the stream immediately, the scan dialog will
      // open its own stream when needed.
      stream.getTracks().forEach((t) => t.stop());
      setPhase("granted");
      remember("granted");
      setTimeout(() => setOpen(false), 900);
    } catch {
      setPhase("denied");
      remember("dismissed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) remember("dismissed"); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary neon-ring">
            {phase === "granted" ? (
              <ShieldCheck className="size-6" />
            ) : (
              <Camera className="size-6" />
            )}
          </div>
          <DialogTitle>Enable camera for QR scanning</DialogTitle>
          <DialogDescription>
            RoboShelf scans part, unit, storage and project QR labels with your
            device camera. Granting access once lets every scan flow — renting,
            returning, browsing — work instantly.
          </DialogDescription>
        </DialogHeader>

        {phase === "denied" && (
          <div className="glass-3d rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
            Camera access was denied. You can still browse everything; when you
            open a scanner you can allow the camera from your browser's address
            bar.
          </div>
        )}
        {phase === "granted" && (
          <div className="glass-3d rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
            Camera ready — scanning is enabled everywhere.
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={phase === "asking"}>
            Not now
          </Button>
          <Button onClick={askCamera} disabled={phase === "asking" || phase === "granted"}>
            {phase === "asking" && <LoadingGifInline size={18} className="size-4" />}
            {phase === "granted" ? "You're all set" : "Allow camera"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
