import { useState } from "react";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FONT_CATALOG, applyFont, stackFor } from "@/lib/fonts";

/**
 * Grid picker for the per-user font — every label renders in its own face so
 * the choice is WYSIWYG. Used inside Settings → App mode and the Profile's
 * App mode section; heading/copy belong to the parent section.
 */
export function FontPicker() {
  const current = useQuery(api.settings.getMyFont, {});
  const save = useMutation(api.settings.setMyFont);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pick = async (id: string) => {
    if (busyId) return;
    const prev = current ?? "";
    setBusyId(id);
    try {
      // Optimistic: apply instantly, roll back if the save fails.
      applyFont(id);
      await save({ font: id });
    } catch (e) {
      applyFont(prev);
      toast.error(asMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (current === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoadingGifInline size={18} className="size-4" /> Loading your font…
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {FONT_CATALOG.map((f) => {
        const on = current === f.id;
        return (
          <button
            key={f.id || "default"}
            type="button"
            disabled={busyId !== null}
            onClick={() => void pick(f.id)}
            title={f.script ? `${f.label} — good for Arabic + Latin` : f.label}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              on
                ? "border-primary/60 bg-primary/10"
                : "border-border text-foreground hover:border-primary/40 hover:bg-muted/40",
              busyId !== null && "opacity-60",
            )}
          >
            <span
              className="min-w-0 flex-1 truncate"
              style={{ fontFamily: stackFor(f.id) }}
            >
              {f.label}
            </span>
            {on && <Check className="size-3.5 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
