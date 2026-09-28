/**
 * App-wide loading indicator — an animated GIF.
 *
 * Every loading state in the app (route navigation, auth guards, page data
 * fetches) shows this animation instead of a CSS spinner.
 *
 * ── WANT A DIFFERENT ANIMATION? ──────────────────────────────────────────
 * Just replace ONE file:  public/loading.gif
 * (64×64 px source works best; the gif scales up — see sizes below.)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sizing rules (aspect ratio is ALWAYS preserved — never stretched):
 *  - LoadingGif: the HEIGHT is 30% of the window's smaller dimension
 *    (30vmin ≈ 30% of viewport height on typical screens); the width follows
 *    automatically, so a non-square gif would keep its true shape too.
 *    The `size` prop is only a fallback for environments without vw/vh units.
 *  - LoadingGifInline (buttons, rows, chips): stays a small fixed pixel size.
 */
import { cn } from "@/lib/utils";

export function LoadingGif({
  size = 64,
  label = "Loading…",
}: {
  /** Fallback rendered size in px (used only when vmin units are ignored). */
  size?: number;
  /** Text under the gif; pass "" to hide it. */
  label?: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2" role="status" aria-label="Loading">
      <img
        src="/loading.gif"
        alt=""
        // 30% of the window's smaller side; width auto keeps the ratio.
        style={{ height: "30vmin", width: "auto" }}
        width={size}
        height={size}
        aria-hidden
        draggable={false}
      />
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
