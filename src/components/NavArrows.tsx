import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Floating left/right arrows to flip through a sibling list (units, groups,
 * storages…). Fixed to the mid screen edges so they never disturb the page
 * layout; hidden entirely when the current item is the only one, and disabled
 * ends simply don't render.
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
  if (idx === -1 || items.length < 2) return null;
  const go = (delta: number) => {
    const next = items[idx + delta];
    if (next) {
      navigate(0); // reset scroll so the next page starts at the top
      onNavigate(next);
    }
  };
  return (
    <>
      {idx > 0 && (
        <Button
          aria-label="Previous item"
          variant="outline"
          size="icon"
          className="fixed left-3 top-1/2 z-30 size-9 -translate-y-1/2 rounded-full border-border/80 bg-background/80 shadow-lg backdrop-blur transition-colors hover:border-primary/50 hover:text-primary"
          onClick={() => go(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
      )}
      {idx < items.length - 1 && (
        <Button
          aria-label="Next item"
          variant="outline"
          size="icon"
          className="fixed right-3 top-1/2 z-30 size-9 -translate-y-1/2 rounded-full border-border/80 bg-background/80 shadow-lg backdrop-blur transition-colors hover:border-primary/50 hover:text-primary"
          onClick={() => go(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      )}
    </>
  );
}
