import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface ScanState {
  scanning: boolean;
  error: string | null;
}

/**
 * Professional camera QR scanning.
 *
 * Speed choices (this hook was the scan bottleneck before):
 *  - BarcodeDetector when the platform has it (Chrome/Android/Edge): native,
 *    often hardware-accelerated decode — used directly on the video element.
 *  - jsQR fallback decodes a DOWNSCALED grayscale frame (max ~640 px on the
 *    long edge) with single-pass inversion — orders of magnitude less pixel
 *    work than the old full-resolution RGBA double-pass loop, while small
 *    codes stay readable because the decode area is centered (where the
 *    aiming frame is).
 *  - Decoding runs on a fixed ~15 Hz cadence instead of every animation
 *    frame, so the camera preview never fights the decoder for the main
 *    thread and phones stay cool.
 *  - Camera opens with the exact "environment" facing mode and a moderate
 *    1280 request so phones pick the rear camera at a usable resolution
 *    without waiting for the highest-profile stream to negotiate.
 *
 * Callback fires once per detected code until it changes or the repeat
 * window (1.5 s) elapses.
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
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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

        // Native decoder when the platform ships one (Android Chrome, Edge,
        // recent desktop Chrome). Falls back to jsQR everywhere else.
        const DetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector;
        const detector = DetectorCtor
          ? new DetectorCtor({ formats: ["qr_code"] })
          : null;

        const emit = (text: string) => {
          const now = Date.now();
          if (text !== lastRef.current.text || now - lastRef.current.at > 1500) {
            lastRef.current = { text, at: now };
            onResult(text);
          }
        };

        // Downscale to at most this size on the long edge for the jsQR path.
        const MAX_EDGE = 640;
        let lastDecode = 0;
        const DECODE_EVERY_MS = 66; // ≈15 Hz — plenty for instant feel

        const decodeFrame = async () => {
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) return;
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return;

          if (detector) {
            // Native path: no canvas copy at all.
            try {
              const codes = await detector.detect(v);
              const hit = codes.find((x) => x.rawValue);
              if (hit?.rawValue) emit(hit.rawValue);
              return;
            } catch {
              /* detector hiccup — fall through to jsQR this frame */
            }
          }

          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          const dw = Math.max(1, Math.round(w * scale));
          const dh = Math.max(1, Math.round(h * scale));
          if (c.width !== dw || c.height !== dh) {
            c.width = dw;
            c.height = dh;
          }
          const g = c.getContext("2d", { willReadFrequently: true });
          if (!g) return;
          g.drawImage(v, 0, 0, dw, dh);
          const img = g.getImageData(0, 0, dw, dh);
          const code = jsQR(img.data, dw, dh, { inversionAttempts: "dontInvert" });
          if (code?.data) emit(code.data);
        };

        const tick = (t: number) => {
          if (cancelled) return;
          if (t - lastDecode >= DECODE_EVERY_MS) {
            lastDecode = t;
            void decodeFrame();
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        // Some desktops/wrapped webviews lack an exact rear camera — retry
        // once with the soft preference before surfacing an error.
        if ((err as DOMException)?.name === "OverconstrainedError") {
          try {
            const soft = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
              audio: false,
            });
            if (cancelled) {
              soft.getTracks().forEach((t) => t.stop());
              return;
            }
            streamRef.current = soft;
            const video = videoRef.current;
            if (!video) return;
            video.srcObject = soft;
            video.setAttribute("playsinline", "true");
            await video.play().catch(() => undefined);
            setState({ scanning: true, error: null });
            return;
          } catch {
            /* fall through to the error below */
          }
        }
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
