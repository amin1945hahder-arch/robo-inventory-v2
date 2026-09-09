import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface ScanState {
  scanning: boolean;
  error: string | null;
}

/**
 * Camera QR scanning via jsQR. Opens the camera with getUserMedia, decodes
 * frames on a canvas. Callback fires once per detected code until it changes.
 */
export function useQrScanner(onResult: (text: string) => void, active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [state, setState] = useState<ScanState>({ scanning: false, error: null });

  useEffect(() => {
    if (!active) {
      // cleanup when dialog closes
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setState({ scanning: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ scanning: true, error: null });

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera scanning is not available in this browser. Make sure the app is served over HTTPS or localhost, then try again.",
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play().catch(() => undefined);

        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
            const w = v.videoWidth;
            const h = v.videoHeight;
            if (w && h) {
              c.width = w;
              c.height = h;
              const g = c.getContext("2d");
              if (g) {
                g.drawImage(v, 0, 0, w, h);
                const img = g.getImageData(0, 0, w, h);
                const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
                if (code?.data) {
                  const now = Date.now();
                  if (code.data !== lastRef.current.text || now - lastRef.current.at > 2500) {
                    lastRef.current = { text: code.data, at: now };
                    onResult(code.data);
                  }
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access in your browser settings and try again."
              : err.name === "NotFoundError"
                ? "No camera was found on this device."
                : err.message
            : "Could not start the camera";
        setState({ scanning: false, error: message });
      }
    };
    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { videoRef, canvasRef, ...state };
}
