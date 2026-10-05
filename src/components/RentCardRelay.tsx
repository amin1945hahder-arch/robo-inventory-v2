import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { useOfflineQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { RentCardSheet } from "@/components/RentCardPaper";
import { elementToPdfBase64 } from "@/lib/rent-card-hifi";

/**
 * Automated rent-card relay.
 *
 * Every automated bot post (approve / return / assign / package return) is
 * queued server-side; THIS component — mounted once, app-wide — renders the
 * queued card OFF-SCREEN with the same RentCardSheet the admin dialog shows,
 * rasterizes it to the hi-fi PDF and uploads it. The Node action then posts
 * it to the club group. Result: the automated PDF is pixel-identical to the
 * manual "Send PDF to group" PDF, Arabic included.
 */
export function RentCardRelay() {
  const job = useQuery(api.rentCardRelay.nextQueuedPublic, {});
  const layout = useOfflineQuery(api.settings.getCardLayout, {});
  const claim = useMutation(api.rentCardRelay.claim);
  const release = useMutation(api.rentCardRelay.release);
  const submitPdf = useMutation(api.rentCardRelay.submitPdf);
  const [jobId, setJobId] = useState<Id<"rentCardJobs"> | null>(null);
  const [card, setCard] = useState<Parameters<typeof RentCardSheet>[0]["card"] | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!job || layout === undefined || busy.current) return;
    busy.current = true;
    setJobId(job._id);
    setCard(job.card);
    void (async () => {
      try {
        const claimed = await claim({ jobId: job._id });
        if (!claimed.ok) return;
        // Wait one paint so the off-screen card is fully rendered before
        // rasterizing (fonts, QR, RTL shaping all settle).
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const el = document.getElementById("rent-card-relay-sheet");
        if (!el) throw new Error("relay sheet missing");
        const { base64 } = await elementToPdfBase64(
          (el as HTMLElement).querySelector<HTMLElement>("[data-qr-label]") ?? (el as HTMLElement),
          layout ?? undefined,
        );
        await submitPdf({ jobId: job._id, pdfBase64: base64 });
      } catch {
        try {
          await release({ jobId: job._id });
        } catch {
          /* job will be swept */
        }
      } finally {
        busy.current = false;
        setJobId(null);
        setCard(null);
      }
    })();
  }, [job, layout, claim, release, submitPdf]);

  return createPortal(
    // Off-screen but rendered (never display:none — snapdom needs layout).
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -10000,
        top: 0,
        width: 0,
        height: 0,
        overflow: "visible",
      }}
    >
      {card && jobId && <RentCardSheet card={card} qrMm={layout?.qrMm} />}
    </div>,
    document.body,
  );
}
