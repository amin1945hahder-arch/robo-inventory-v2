import { useEffect } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Floating left/right arrows to flip through a sibling list (units, groups,
 * storages, projects…). Fixed to the mid screen edges so they never disturb
 * the page layout; hidden entirely when the current item is the only one.
 * Navigation wraps around at both ends and ← / → on the keyboard work too.
 */
export function NavArrows({
  items,
  currentId,
  onNavigate,
}: {
  /** Ordered sibling list of ids. */
  items: string[];
  currentId?: string;
  onNavigate: (id: string) => void;
}) {
  const navigate = useNavigate();
  const idx = currentId ? items.indexOf(currentId) : -1;
  const wrap = items.length >= 2;

  useEffect(() => {
    if (!wrap) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Never hijack typing (search bars, editors, dialogs).
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, idx, items]);

  if (idx === -1 || !wrap) return null;

  const go = (delta: number) => {
    // Wrap around: the list is a cycle, so ←/→ always lead somewhere.
    const next = items[(idx + delta + items.length) % items.length];
    if (next) onNavigate(next);
    // NOTE: no navigate(0) here — that reloaded the whole page before the
    // route change could apply, which made the arrows feel dead. Each detail
    // page scrolls to the top on mount anyway.
  };

  const cls =
    "fixed top-1/2 z-40 size-10 -translate-y-1/2 rounded-full border-border bg-background/90 shadow-lg backdrop-blur transition-colors hover:border-primary/60 hover:text-primary";

  return (
    <>
      <Button
        aria-label="Previous item"
        variant="outline"
        size="icon"
        className={`${cls} left-2 md:left-3`}
        onClick={() => go(-1)}
      >
        <ChevronLeft className="size-5" />
      </Button>
      <Button
        aria-label="Next item"
        variant="outline"
        size="icon"
        className={`${cls} right-2 md:right-3`}
        onClick={() => go(1)}
      >
        <ChevronRight className="size-5" />
      </Button>
    </>
  );
}
