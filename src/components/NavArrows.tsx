import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Floating left/right arrows to flip through a sibling list (units, groups,
 * storages, projects…). Fixed to the vertical center of the screen edges so
 * they stay in place while the page scrolls; hidden entirely when the current
 * item is the only one. At the ends of the list the arrow is DISABLED (not
 * wrapped around) — there is simply nothing before the first or after the
 * last item. ← / → on the keyboard work too (never while typing).
 */
export function NavArrows({
  items,
  currentId,
  onNavigate,
}: {
  /** Ordered sibling list of ids (stable, precomputed by the caller). */
  items: string[];
  currentId?: string;
  onNavigate: (id: string) => void;
}) {
  const idx = currentId ? items.indexOf(currentId) : -1;
  const active = idx !== -1 && items.length >= 2;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Never hijack typing (search bars, editors, dialogs).
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (idx > 0 && e.key === "ArrowLeft") {
        e.preventDefault();
        onNavigate(items[idx - 1]);
      } else if (idx < items.length - 1 && e.key === "ArrowRight") {
        e.preventDefault();
        onNavigate(items[idx + 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx, items, onNavigate]);

  if (!active) return null;

  const go = (delta: -1 | 1) => {
    const next = items[idx + delta];
    if (next) onNavigate(next);
  };

  // Vertically centered, pinned to the screen edges (fixed → the buttons stay
  // at the sides of the viewport even when the page is scrolled). On desktop
  // the LEFT arrow is offset past the floating sidebar (14.75rem) so it never
  // covers the tab panel; on phones both arrows sit at the true edges, sized
  // to fit (size-9) so they never overlap each other or the content.
  const base =
    "fixed top-1/2 z-40 -translate-y-1/2 rounded-full border-border bg-background/90 shadow-lg backdrop-blur transition-colors max-md:size-9 md:size-10";
  const enabled = "hover:border-primary/60 hover:text-primary";
  const disabledCls = "opacity-40 pointer-events-none";

  return (
    <>
      {idx > 0 ? (
        <Button
          aria-label="Previous item"
          variant="outline"
          size="icon"
          className={`${base} ${enabled} left-1 md:left-[calc(14.75rem+0.75rem)]`}
          onClick={() => go(-1)}
        >
          <ChevronLeft className="size-5" />
        </Button>
      ) : (
        <Button
          aria-label="No previous item"
          variant="outline"
          size="icon"
          disabled
          title="You are at the first item"
          className={`${base} ${disabledCls} left-1 md:left-[calc(14.75rem+0.75rem)]`}
        >
          <ChevronLeft className="size-5" />
        </Button>
      )}
      {idx < items.length - 1 ? (
        <Button
          aria-label="Next item"
          variant="outline"
          size="icon"
          className={`${base} ${enabled} right-1 md:right-3`}
          onClick={() => go(1)}
        >
          <ChevronRight className="size-5" />
        </Button>
      ) : (
        <Button
          aria-label="No next item"
          variant="outline"
          size="icon"
          disabled
          title="You are at the last item"
          className={`${base} ${disabledCls} right-1 md:right-3`}
        >
          <ChevronRight className="size-5" />
        </Button>
      )}
    </>
  );
}
