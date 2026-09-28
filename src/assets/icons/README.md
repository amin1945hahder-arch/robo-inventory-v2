# Custom icons — drop your .svg files here

Replace (or add) .svg files with these exact names. The app picks them up
automatically — **no code changes needed**. After adding brand-new files,
restart the dev server once so Vite's glob picks them up (replacing an
existing file needs nothing).

## 1. Categories → `src/assets/icons/categories/`

File name = category name, lowercase, kebab-case
(spaces & symbols become dashes: "MicroControllers" → `microcontrollers.svg`).

| Category name in the app | File to create |
|---|---|
| (example) 3D Printers | `3d-printers.svg` |
| (example) Arduino | `arduino.svg` |
| (example) Jumper wires | `jumper-wires.svg` |
| (example) Sensors | `sensors.svg` |

Add one file per category you want to customize — only those categories
change; the rest keep the built-in icons. Categories appear in the Inventory
section headers and on every GroupCard, storage pages and group pages.

## 2. Nav tabs → `src/assets/icons/nav/`

File name = the tab's route segment:

| Tab | File to create |
|---|---|
| Dashboard | `dashboard.svg` |
| Inventory | `inventory.svg` |
| Storages | `storages.svg` |
| Projects | `projects.svg` |
| My rentals | `my-rentals.svg` |
| 3D printing | `3d-printing.svg` |
| Courses | `courses.svg` |
| Requests (admin) | `requests.svg` |
| People (admin) | `people.svg` |
| Import CSV (admin) | `import.svg` |
| Print labels (admin) | `labels.svg` |
| Export (admin) | `export.svg` |
| Reports (admin) | `reports.svg` |
| Settings (admin) | `settings.svg` |

These render in the sidebar (desktop), the hamburger menu (mobile) and the
header quick icons.

## Other icon locations in the app (for reference)

| What | Where |
|---|---|
| Browser tab icon / app icon / PWA | `public/logo.svg` (referenced by `index.html` + `public/manifest.webmanifest`) |
| Landing page logo | `src/assets/logo.svg` |
| Loading animation | `public/loading.gif` (small inline spinners scale it via `src/components/LoadingGif.tsx`) |
| Cover background | `src/assets/cover.png` (or `.svg` — see `src/lib/cover.ts`) |
| Built-in UI icons (Lucide) | npm package `lucide-react` — not files |

## Tips

- Square artwork with a `viewBox` scales best (`<svg viewBox="0 0 24 24">`).
- Single-color icons: use `fill="currentColor"` — but note `<img>` rendering
  does NOT apply currentColor; if you want your icons tinted automatically,
  author them in a fixed color that reads well in both light/dark themes.
- The built-in icons are used at 16px (size-4) in nav and 14px (size-3.5) on
  group cards, so keep detail chunky enough to read at small sizes.
