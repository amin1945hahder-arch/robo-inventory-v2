/**
 * COVER BACKGROUND image — how to customize:
 *
 * 1. Drop ONE image into `src/assets/` named `cover.png` (or `cover.svg`,
 *    `cover.jpg`, `cover.webp` — any of these works).
 * 2. That's it. Replace the file and the new cover shows up everywhere the
 *    cover is used (currently the landing page backdrop). No code changes
 *    needed — the file is resolved automatically, whatever the extension.
 *
 * A repository placeholder ships at `src/assets/cover.png` — just overwrite
 * that file with your own artwork (any resolution; it renders with
 * object-cover so wide 16:9-ish images look best).
 *
 * When no cover.* file exists, `coverUrl` is "" and the page falls back to
 * the built-in gradient/grid backdrop.
 */
const glob = import.meta.glob<string>("../assets/cover.*", {
  eager: true,
  query: "?url",
  import: "default",
});

export const coverUrl: string =
  Object.entries(glob).sort(([a], [b]) => a.localeCompare(b))[0]?.[1] ?? "";
