/**
 * App-wide loading indicator — an animated GIF.
 *
 * Every loading state in the app (route navigation, auth guards, page data
 * fetches) shows this animation instead of a CSS spinner.
 *
 * ── WANT A DIFFERENT ANIMATION? ──────────────────────────────────────────
 * Just replace ONE file:  public/loading.gif
 * (64×64 px works best; it scales to whatever size is passed below.)
 * ─────────────────────────────────────────────────────────────────────────
 */
import { cn } from "@/lib/utils";

export function LoadingGif({
  size = 64,
  label = "Loading…",
}: {
  /** Rendered size in px (the source gif is 64×64). */
  size?: number;
  /** Text under the gif; pass "" to hide it. */
  label?: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2" role="status" aria-label="Loading">
      <img src="/loading.gif" alt="" width={size} height={size} aria-hidden draggable={false} />
      {label ? <p className="animate-pulse text-sm text-muted-foreground">{label}</p> : null}
    </div>
  );
}

/** Compact variant for tight spots (rows, cards, buttons, small panels). */
export function LoadingGifInline({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/loading.gif"
      alt="Loading"
      width={size}
      height={size}
      className={cn("inline-block shrink-0 align-middle", className)}
      draggable={false}
    />
  );
}
