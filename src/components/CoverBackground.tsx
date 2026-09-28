import { coverUrl } from "@/lib/cover";

/**
 * Global cover background — rendered once, above <body>, behind every page.
 *
 * The cover file (src/assets/cover.png / cover.svg — see src/lib/cover.ts)
 * is an A4-ratio artwork, so it must NEVER be stretched to the window shape.
 * The crisp layer is sized to the FULL WINDOW HEIGHT with an automatic width
 * (intrinsic A4 ratio preserved) and centered; on wider windows the sides are
 * filled with a heavily blurred, overscaled copy of the same image so there
 * are no hard empty bands. A readability veil keeps app content crisp.
 *
 * To change the artwork: replace src/assets/cover.png (or cover.svg). No code
 * changes needed — see src/lib/cover.ts.
 */
export function CoverBackground() {
  if (!coverUrl) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      {/* Side fill: same image, overscaled + blurred, only visible beyond
          the crisp layer's auto width (e.g. landscape monitors). */}
      <img
        src={coverUrl}
        alt=""
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
      />
      {/* Crisp layer: window height 100%, width AUTO → intrinsic ratio
          preserved (no stretching), centered horizontally. */}
      <img
        src={coverUrl}
        alt=""
        className="absolute inset-y-0 left-1/2 h-full w-auto max-w-none -translate-x-1/2"
      />
      {/* Readability veil: content stays readable over any artwork. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/75 to-background/90" />
    </div>
  );
}
