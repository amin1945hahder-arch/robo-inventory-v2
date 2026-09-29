/**
 * PaperPreview — a mm-accurate paper sheet for print previews.
 *
 * The WIDTH always fits the available container (no horizontal overflow):
 * the sheet is scaled so its page width equals the container width. The
 * HEIGHT follows dynamically from the paper ratio, so an A4 page renders
 * proportionally tall — exactly what will print, just smaller.
 *
 * Children are laid out with mm units mapped through the scale, so anything
 * drawn "on the paper" (labels, cards, tables) appears at true relative
 * scale. Use the injected CSS var via the mm() helper, e.g.
 * style={{ width: mm(95) }} draws a 95mm-wide card on the sheet.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type PaperSize = { w: number; h: number }; // mm

const ScaleContext = createContext<number>(1);

/** mm → preview px. Valid only inside a <PaperPreview>. */
export function mm(value: number): string {
  return `calc(${value} * var(--mm, 1px))`;
}

/** Current mm→preview-px factor (for font sizes etc.). */
export function usePaperScale(): number {
  return useContext(ScaleContext);
}

/** px per mm at true scale (CSS reference 96dpi) — for shrink math. */
export const TRUE_MM_PX = 96 / 25.4;

/**
 * ScaledCell — renders children at TRUE mm size, then shrinks them by the
 * sheet's preview scale so they occupy exactly their mm footprint on the
 * previewed paper. Use for print components authored in real mm/px
 * (MmLabel, PrintCard…): the internals keep their exact print proportions.
 */
export function ScaledCell({ wMm, hMm, children }: { wMm: number; hMm?: number; children: ReactNode }) {
  const s = usePaperScale();
  const shrink = s / TRUE_MM_PX;
  return (
    <div
      style={{
        width: `calc(${wMm} * var(--mm, 1px))`,
        height: hMm ? `calc(${hMm} * var(--mm, 1px))` : undefined,
        // Center the shrunk content when the natural height differs.
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        overflow: "visible",
      }}
    >
      <div
        style={{
          width: wMm * TRUE_MM_PX,
          height: hMm ? hMm * TRUE_MM_PX : undefined,
          transform: `scale(${shrink})`,
          transformOrigin: "top left",
          flex: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function PaperPreview({
  pageMm,
  marginMm = 0,
  orientation = "portrait",
  className,
  paperClassName,
  header,
  footer,
  children,
}: {
  pageMm: PaperSize;
  /** Visual dashed line showing the printer's unprintable margin (mm). */
  marginMm?: number;
  orientation?: "portrait" | "landscape";
  className?: string;
  paperClassName?: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Round to whole px: sub-pixel width changes caused measure→render→
    // measure loops (the "app freezes" bug) in zoomed/scroll containers.
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        for (const e of entries) {
          const w = Math.floor(e.contentRect.width);
          setContainerW((prev) => (prev === w ? prev : w));
        }
      });
    });
    ro.observe(el);
    setContainerW(Math.floor(el.getBoundingClientRect().width));
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const dims = orientation === "landscape" ? { w: pageMm.h, h: pageMm.w } : pageMm;
  const scale = containerW / dims.w; // mm → preview px
  const heightPx = Math.round(dims.h * scale);

  return (
    <ScaleContext.Provider value={scale}>
      <div className={className}>
        {header}
        <div ref={ref} className="relative w-full">
          <div
            className={cn(
              "relative mx-auto overflow-hidden rounded-md border border-neutral-300 bg-white text-black shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)]",
              paperClassName,
            )}
            style={{
              width: "100%",
              height: containerW > 0 ? heightPx : undefined,
              ["--mm" as string]: `${scale}px`,
            }}
          >
            {marginMm > 0 && (
              <div
                className="pointer-events-none absolute rounded-sm border border-dashed border-neutral-300"
                style={{
                  top: marginMm * scale,
                  left: marginMm * scale,
                  right: marginMm * scale,
                  bottom: marginMm * scale,
                }}
              />
            )}
            {containerW > 0 ? children : null}
          </div>
        </div>
        {footer}
      </div>
    </ScaleContext.Provider>
  );
}
