import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { pageMm, placedCardMm, type CardPrintLayout } from "@/lib/card-print-layout";
import { DEFAULT_CARD_LAYOUT } from "@/convex/settings";

type Draft = CardPrintLayout;

const PAGE_PRESETS: { value: CardPrintLayout["pageSize"]; label: string }[] = [
  { value: "A4", label: "A4 — 210 × 297 mm" },
  { value: "A5", label: "A5 — 148 × 210 mm" },
  { value: "Letter", label: "Letter — 215.9 × 279.4 mm" },
  { value: "Legal", label: "Legal — 215.9 × 355.6 mm" },
  { value: "custom", label: "Custom size…" },
];

const PRESET_MM: Record<Exclude<CardPrintLayout["pageSize"], "custom">, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};

/** Millimetre input with clamping. */
function MmInput({
  id,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => {
        const n = e.target.value === "" ? 0 : Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      className="h-8"
    />
  );
}

/**
 * "Card print layout" settings section.
 *
 * Configure the PAGE (preset or custom mm), the CARD size in mm, and the
 * card's offset from the page's top-left. A live preview shows the paper
 * with the card exactly where it will print. This layout drives every card
 * print/download in the app (rent cards, badges, relay PDFs).
 */
export function CardLayoutSection() {
  const saved = useQuery(api.settings.getCardLayout, {});
  const setLayout = useMutation(api.settings.setCardLayout);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the draft from the server once.
  useEffect(() => {
    if (saved && draft === null) setDraft(saved);
  }, [saved, draft]);

  if (saved === undefined || draft === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoadingGifInline size={18} className="size-4" /> Loading…
      </p>
    );
  }

  const set = (over: Partial<Draft>) => setDraft({ ...draft, ...over });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    try {
      const next = await setLayout({ ...draft });
      setDraft(next);
      toast.success("Card print layout saved — used by every card print & download");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const page = pageMm(draft);
  const previewScale = 240 / page.h; // preview paper height ≈ 240px
  // The preview card mimics the real sheet's ratio (360×518px ≈ 95×138mm at
  // 96dpi) so the placement is faithful to an actual print.
  const previewCardMm = { w: 95.25, h: 137.05 };
  const placed = placedCardMm(draft, previewCardMm.w, previewCardMm.h);

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-5">
      <div>
        <h2 className="text-sm font-semibold">Card print layout</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          How every rent card / badge is placed on paper when printed or downloaded as PDF.
          Pick the page, set the card size and its position. The card is scaled to{" "}
          <b>fit</b> its box — never stretched.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        {/* ---------------- controls ---------------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-3 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Page</p>
            <div className="grid gap-1.5">
              <Label htmlFor="cl-page" className="text-xs">Paper size</Label>
              <Select
                value={draft.pageSize}
                onValueChange={(v) => {
                  const pageSize = v as Draft["pageSize"];
                  const p = PRESET_MM[pageSize as Exclude<Draft["pageSize"], "custom">];
                  set(p ? { pageSize, pageWidthMm: p[0], pageHeightMm: p[1] } : { pageSize });
                }}
              >
                <SelectTrigger id="cl-page" className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.pageSize === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="cl-pw" className="text-xs">Width (mm)</Label>
                  <MmInput id="cl-pw" value={draft.pageWidthMm} onChange={(n) => set({ pageWidthMm: n })} min={40} max={400} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cl-ph" className="text-xs">Height (mm)</Label>
                  <MmInput id="cl-ph" value={draft.pageHeightMm} onChange={(n) => set({ pageHeightMm: n })} min={40} max={400} />
                </div>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs">Print mode</Label>
              <Select
                value={draft.printMode}
                onValueChange={(v) => set({ printMode: v as Draft["printMode"] })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">Sheet paper — place card on the page</SelectItem>
                  <SelectItem value="thermal">Label roll — page = card size</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Label roll prints the card alone, sized exactly like the card.
              </p>
            </div>
          </div>

          <div className="grid content-start gap-3 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Card</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cl-cw" className="text-xs">Card width (mm)</Label>
                <MmInput id="cl-cw" value={draft.cardWidthMm} onChange={(n) => set({ cardWidthMm: n })} min={20} max={400} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cl-ch" className="text-xs">Card height (mm)</Label>
                <MmInput id="cl-ch" value={draft.cardHeightMm} onChange={(n) => set({ cardHeightMm: n })} min={20} max={400} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cl-ox" className="text-xs">Offset X — from left (mm)</Label>
                <MmInput id="cl-ox" value={draft.offsetXmm} onChange={(n) => set({ offsetXmm: n })} min={0} max={400} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cl-oy" className="text-xs">Offset Y — from top (mm)</Label>
                <MmInput id="cl-oy" value={draft.offsetYmm} onChange={(n) => set({ offsetYmm: n })} min={0} max={400} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Position is measured from the page's top-left corner to the card's top-left.
              If the card's shape doesn't match the box, it is centred inside it — never stretched.
            </p>
          </div>
        </div>

        {/* ---------------- live preview ---------------- */}
        <div className="grid content-start justify-items-center gap-2 rounded-lg border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Preview</p>
          <div
            className="relative overflow-hidden rounded-sm border-2 border-dashed border-neutral-400 bg-white shadow-sm"
            style={{ width: page.w * previewScale, height: page.h * previewScale }}
          >
            <div
              className="absolute overflow-hidden rounded-md border border-neutral-300 bg-white p-1.5 text-black"
              style={{
                left: placed.x * previewScale,
                top: placed.y * previewScale,
                width: placed.w * previewScale,
                height: placed.h * previewScale,
              }}
            >
              <div className="flex items-start justify-between gap-1">
                <div>
                  <p className="font-semibold uppercase tracking-widest text-neutral-400" style={{ fontSize: 3.5 }}>
                    Robotics Club · Rental Receipt
                  </p>
                  <p className="font-bold leading-tight" style={{ fontSize: 6 }}>Jumper wires M-M</p>
                  <p className="font-mono text-neutral-500" style={{ fontSize: 4 }}>RNT-0001</p>
                </div>
                <div className="flex shrink-0 items-center justify-center rounded-sm bg-neutral-900" style={{ width: 14, height: 14 }}>
                  <span className="font-mono text-white" style={{ fontSize: 3.5 }}>QR</span>
                </div>
              </div>
              <div className="mt-1.5 space-y-1">
                {[
                  ["Student", "Ali Hassan"],
                  ["Status", "Rented"],
                  ["Requested", "2026-09-28 14:02"],
                  ["Returned", "—"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between border-b border-dashed border-neutral-200 pb-0.5"
                    style={{ fontSize: 4.5 }}
                  >
                    <span className="text-neutral-500">{k}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {page.w.toFixed(0)} × {page.h.toFixed(0)} mm · card box {draft.cardWidthMm} × {draft.cardHeightMm} mm
            {draft.printMode === "thermal" ? " · label roll" : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
            Discard
          </Button>
        )}
        <Button size="sm" disabled={!dirty || busy} onClick={save}>
          {busy ? <LoadingGifInline size={16} className="size-4" /> : <Save className="size-4" />}
          Save layout
        </Button>
      </div>
    </section>
  );
}
