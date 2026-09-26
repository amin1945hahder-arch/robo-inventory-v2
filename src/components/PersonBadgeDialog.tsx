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

export type PersonBadgeData = {
  userId: string;
  name: string;
  email?: string;
  image?: string;
  role?: string;
  studentId?: string;
  clubRoles?: string[];
  academicState?: string;
  major?: string;
  phone?: string;
  telegramUsername?: string;
};

/** Printable member badge: photo, info, and a QR that opens their profile. */
export function PersonBadgeDialog({
  p,
  onClose,
}: {
  p: PersonBadgeData;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"" | "pdf" | "send">("");
  const deliverBadgePdf = useAction(api.rentCardTelegram.deliverRentCardPdf);

  const caption = [
    `🪪 Club member badge: ${p.name}`,
    p.role ? `👤 Role: ${p.role}` : "",
    p.clubRoles?.length ? `🏅 Positions: ${p.clubRoles.join(", ")}` : "",
    p.studentId ? `🆔 Student ID: ${p.studentId}` : "",
    p.academicState ? `🎓 ${p.academicState}` : "",
    p.major ? `📚 ${p.major}` : "",
    p.telegramUsername ? `✈️ @${p.telegramUsername}` : "",
    p.email ? `✉️ ${p.email}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Member badge</DialogTitle>
        </DialogHeader>
        <div
          id="person-badge-sheet"
          className="rounded-lg border bg-white p-5 text-black"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            Robotics Club · Member Badge
          </p>
          <div className="mt-3 flex items-start gap-3">
            {p.image ? (
              <img src={p.image} alt={p.name} className="size-16 rounded-md object-cover" />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-md bg-neutral-100 text-xl font-bold text-neutral-500">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold leading-tight">{p.name}</p>
              {p.role && <p className="text-xs font-medium text-neutral-600">{p.role}</p>}
              {p.clubRoles && p.clubRoles.length > 0 && (
                <p className="truncate text-[11px] text-neutral-500">{p.clubRoles.join(" · ")}</p>
              )}
              {p.studentId && (
                <p className="font-mono text-[11px] text-neutral-500">ID {p.studentId}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <QRCodeReact
                value={qrUrl(`person:${p.userId}`)}
                size={72}
                style={{ height: "auto", maxWidth: "100%" }}
              />
              <span className="font-mono text-[8px] text-neutral-400">scan profile</span>
            </div>
          </div>
          <dl className="mt-3 space-y-1 border-t border-dashed border-neutral-200 pt-3 text-[12px]">
            {p.academicState && (
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Academic</dt>
                <dd className="text-right font-medium">{p.academicState}</dd>
              </div>
            )}
            {p.major && (
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Major</dt>
                <dd className="text-right font-medium">{p.major}</dd>
              </div>
            )}
            {p.phone && (
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Phone</dt>
                <dd className="text-right font-medium">{p.phone}</dd>
              </div>
            )}
            {p.telegramUsername && (
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Telegram</dt>
                <dd className="text-right font-medium">@{p.telegramUsername}</dd>
              </div>
            )}
            {p.email && (
              <div className="flex justify-between gap-2">
                <dt className="text-neutral-500">Email</dt>
                <dd className="truncate text-right font-medium">{p.email}</dd>
              </div>
            )}
          </dl>
        </div>
        <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-3 [&>button]:w-full [&>span]:w-full">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            variant="outline"
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("send");
              try {
                const el = document.getElementById("person-badge-sheet") as HTMLElement | null;
                if (!el) throw new Error("Badge not rendered");
                const { base64 } = await elementToPdfBase64(el);
                const res = await deliverBadgePdf({ pdfBase64: base64, captionLines: caption });
                if (res?.sent) toast.success("Badge PDF sent to the club group");
                else toast.error(`Not sent: ${res?.reason ?? "unknown"}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
            Send to group
          </Button>
          <Button
            disabled={busy !== ""}
            onClick={async () => {
              setBusy("pdf");
              try {
                const el = document.getElementById("person-badge-sheet") as HTMLElement | null;
                if (!el) throw new Error("Badge not rendered");
                await downloadCardPdf(el, `badge-${p.name.replace(/\s+/g, "_")}.pdf`);
                toast.success("Badge PDF downloaded");
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
