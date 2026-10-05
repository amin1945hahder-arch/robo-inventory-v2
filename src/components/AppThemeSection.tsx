import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { clamp, parseHex, rgbaToHex } from "@/lib/color";
import { TOKEN_GROUPS, type ThemeMode, type ThemeTokenKey } from "@/lib/themeTokens";
import {
  applyThemeState,
  beginThemePreview,
  BUILTIN_THEMES,
  createThemeFrom,
  defaultColors,
  DEFAULT_RADIUS,
  effectiveThemeId,
  endThemePreview,
  resolveTheme,
  swatchColors,
  updateThemePreview,
  type AppTheme,
} from "@/lib/appTheme";
import { THEME_ICON_NAMES, resolveThemeIcon } from "@/lib/theme-icons";
import { categoryIconSlot, navIconSlot } from "@/lib/custom-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarClock,
  Check,
  Copy,
  Globe,
  Moon,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";

/* ========================================================================= */
/* Color field: swatch + picker + HEX + RGB + opacity, with live swatch       */
/* ========================================================================= */

const CHECKER = {
  backgroundImage:
    "conic-gradient(color-mix(in oklab, var(--muted-foreground) 35%, transparent) 0 25%, transparent 0 50%, color-mix(in oklab, var(--muted-foreground) 35%, transparent) 0 75%, transparent 0)",
  backgroundSize: "8px 8px",
} as const;

function ColorField({
  label,
  hint,
  value,
  onChange,
  onReset,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
  onReset: () => void;
}) {
  const rgba = parseHex(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const [hexText, setHexText] = useState(value.toUpperCase());
  useEffect(() => {
    setHexText(value.toUpperCase());
  }, [value]);

  const commitHex = () => {
    const parsed = parseHex(hexText);
    if (parsed) onChange(rgbaToHex(parsed));
    else setHexText(value.toUpperCase());
  };
  const setChannel = (k: "r" | "g" | "b", raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(rgbaToHex({ ...rgba, [k]: clamp(n, 0, 255) }));
  };
  const setAlpha = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(rgbaToHex({ ...rgba, a: clamp(n, 0, 100) / 100 }));
  };
  const pickerHex = rgbaToHex({ ...rgba, a: 1 });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/50 px-2.5 py-2">
      {/* Swatch = native color picker (click it). The checker shows opacity. */}
      <label
        className="relative block size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border"
        style={CHECKER}
        title={`Pick ${label.toLowerCase()} color`}
      >
        <span className="absolute inset-0" style={{ background: value }} />
        <input
          type="color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={pickerHex}
          aria-label={`${label} color picker`}
          onChange={(e) => {
            const picked = parseHex(e.target.value);
            if (picked) onChange(rgbaToHex({ ...picked, a: rgba.a }));
          }}
        />
      </label>

      <div className="min-w-32 flex-1">
        <p className="text-xs font-medium leading-tight">{label}</p>
        <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>
      </div>

      <Input
        value={hexText}
        onChange={(e) => setHexText(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitHex();
          if (e.key === "Escape") setHexText(value.toUpperCase());
        }}
        spellCheck={false}
        aria-label={`${label} hex`}
        className="h-8 w-24 shrink-0 px-2 font-mono text-xs uppercase"
      />

      {(["r", "g", "b"] as const).map((k) => (
        <Input
          key={k}
          type="number"
          min={0}
          max={255}
          value={rgba[k]}
          onChange={(e) => setChannel(k, e.target.value)}
          aria-label={`${label} ${k === "r" ? "red" : k === "g" ? "green" : "blue"}`}
          className="h-8 w-14 shrink-0 px-1.5 text-xs tabular-nums"
        />
      ))}

      <div className="relative shrink-0">
        <Input
          type="number"
          min={0}
          max={100}
          value={Math.round(rgba.a * 100)}
          onChange={(e) => setAlpha(e.target.value)}
          aria-label={`${label} opacity percent`}
          className="h-8 w-16 px-1.5 pr-6 text-xs tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground">
          %
        </span>
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-muted-foreground"
        title={`Reset ${label.toLowerCase()} to the theme default`}
        onClick={onReset}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}

/* ========================================================================= */
/* Per-theme icon picker — one choice per app icon slot                       */
/* ========================================================================= */

/** Sidebar slots (keep in sync with NAV / ADMIN_LINKS in AppShell). */
const NAV_ICON_SLOTS: Array<[route: string, label: string]> = [
  ["/dashboard", "Dashboard"],
  ["/inventory", "Inventory"],
  ["/closets", "Storages"],
  ["/projects", "Projects"],
  ["/rentals", "My rentals"],
  ["/3d-printing", "3D printing"],
  ["/admin/requests", "Requests"],
  ["/people", "People"],
  ["/import", "Import CSV"],
  ["/labels", "Print labels"],
  ["/export", "Export"],
  ["/admin/reports", "Reports"],
  ["/settings", "Settings"],
];

function IconSlotField({
  label,
  value,
  published,
  disabled,
  onChange,
}: {
  label: string;
  value: string | undefined;
  /** The live (published) override — previewed when the draft has none. */
  published?: string;
  disabled?: boolean;
  onChange: (name: string | undefined) => void;
}) {
  const Current = resolveThemeIcon(value ?? published);
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card/50 px-2.5 py-1.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background/60">
        {Current ? (
          <Current className="size-4" />
        ) : (
          <span className="text-[9px] font-semibold text-muted-foreground">auto</span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={label}>
        {label}
      </span>
      <Select
        value={value ?? "__default__"}
        onValueChange={(v) => onChange(v === "__default__" ? undefined : v)}
        disabled={disabled}
      >
        <SelectTrigger className="h-7 w-36 shrink-0 text-xs" aria-label={`${label} icon`}>
          <SelectValue placeholder="Default" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="__default__">Default (current)</SelectItem>
          {THEME_ICON_NAMES.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IconPicker({
  icons,
  published,
  categories,
  disabled,
  onChange,
}: {
  icons: Record<string, string>;
  published?: Record<string, string> | null;
  categories: string[];
  disabled?: boolean;
  onChange: (icons: Record<string, string>) => void;
}) {
  const set = (slot: string, name: string | undefined) => {
    const next = { ...icons };
    if (name) next[slot] = name;
    else delete next[slot];
    onChange(next);
  };
  const count = Object.keys(icons).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 border-b pb-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          App icons
        </p>
        <p className="text-[11px] text-muted-foreground">
          {count > 0
            ? `${count} slot${count === 1 ? "" : "s"} overridden`
            : "every slot keeps its current icon"}
        </p>
      </div>
      <div className="grid gap-1.5 xl:grid-cols-2">
        {NAV_ICON_SLOTS.map(([route, label]) => {
          const slot = navIconSlot(route);
          return (
            <IconSlotField
              key={slot}
              label={label}
              value={icons[slot]}
              published={published?.[slot]}
              disabled={disabled}
              onChange={(name) => set(slot, name)}
            />
          );
        })}
        {categories.map((name) => {
          const slot = categoryIconSlot(name);
          return (
            <IconSlotField
              key={slot}
              label={`Category · ${name}`}
              value={icons[slot]}
              published={published?.[slot]}
              disabled={disabled}
              onChange={(name2) => set(slot, name2)}
            />
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        <b className="text-foreground">Default (current)</b> keeps whatever the slot uses today
        (custom .svg, else the built-in icon). Overrides publish with the theme — every member
        sees them.
      </p>
    </div>
  );
}

/* ========================================================================= */
/* Theme card — mini live preview + actions                                   */
/* ========================================================================= */

function ThemeCard({
  theme,
  active,
  disabled,
  isDefault,
  isClubDefault,
  defaultTitle,
  onActivate,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  theme: AppTheme;
  active: boolean;
  disabled: boolean;
  isDefault?: boolean;
  /** The theme chosen as the club-wide DEFAULT (starred). */
  isClubDefault?: boolean;
  /** Star tooltip (defaults to "Set as the default theme"). */
  defaultTitle?: string;
  onActivate: () => void;
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Star click — makes this the default theme (or clears it). */
  onSetDefault?: () => void;
}) {
  const c = theme.colors;
  const strip = swatchColors(theme);

  return (
    <div
      className={cn(
        "glass-3d flex w-60 shrink-0 snap-start flex-col gap-2.5 rounded-lg border p-3 transition-all",
        active
          ? "border-primary/70 shadow-[0_0_0_1px_var(--primary)]"
          : "hover:border-primary/40",
      )}
    >
      {/* Mini UI preview rendered with the theme's own colors */}
      <div
        className="rounded-md border p-2"
        style={{ background: c.background, borderColor: c.border }}
      >
        <div
          className="rounded-md border p-2"
          style={{ background: c.card, borderColor: c.border, color: c["card-foreground"] }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold">Panel title</span>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: c["chart-1"] }}
            />
          </div>
          <p
            className="mt-0.5 truncate text-[10px]"
            style={{ color: c["muted-foreground"] }}
          >
            Secondary text sample
          </p>
          <div className="mt-2 flex items-center gap-1">
            <span
              className="rounded px-2 py-1 text-[10px] font-semibold"
              style={{ background: c.primary, color: c["primary-foreground"] }}
            >
              Button
            </span>
            <span
              className="rounded border px-2 py-1 text-[10px]"
              style={{ borderColor: c.border, color: c.foreground }}
            >
              Ghost
            </span>
            <span
              className="ml-auto size-3 rounded-sm"
              style={{ background: c["chart-2"] }}
              aria-hidden
            />
          </div>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
          {strip.map((s, i) => (
            <span key={`${s}-${i}`} className="flex-1" style={{ background: s }} />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={theme.name}>
          {theme.name}
        </p>
        {theme.mode === "dark" ? (
          <Moon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Sun className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
            active
              ? "border-transparent bg-primary text-primary-foreground"
              : "border-border text-muted-foreground",
          )}
        >
          {active
            ? "Live"
            : isClubDefault
              ? "Default"
              : isDefault
                ? "Shipped"
                : theme.builtin
                  ? "Preset"
                  : "Custom"}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {!active ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1 px-2 text-xs"
            disabled={disabled}
            onClick={onActivate}
            title="Publish this theme to every member"
          >
            <Globe className="size-3.5" /> Publish
          </Button>
        ) : (
          <span className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-primary/40 bg-primary/10 text-xs font-medium text-primary">
            <Check className="size-3.5" /> In use
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={isDefault ? "Customize as a new theme" : "Edit colors"}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        {onDuplicate && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            title="Duplicate"
            disabled={disabled}
            onClick={onDuplicate}
          >
            <Copy className="size-3.5" />
          </Button>
        )}
        {onSetDefault && (
          <Button
            size="icon"
            variant="ghost"
            className={cn("size-7", isClubDefault && "text-primary")}
            title={defaultTitle ?? "Set as the default theme"}
            disabled={disabled}
            onClick={onSetDefault}
          >
            <Star className={cn("size-3.5", isClubDefault && "fill-current")} />
          </Button>
        )}
        {onDelete && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            title="Delete theme"
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* The App theme settings tab                                                */
/* ========================================================================= */

export function AppThemeSection() {
  const state = useQuery(api.appThemes.get, {});
  const saveTheme = useMutation(api.appThemes.save);
  const removeTheme = useMutation(api.appThemes.remove);
  const setActiveTheme = useMutation(api.appThemes.setActive);
  const setDefaultTheme = useMutation(api.appThemes.setDefault);
  const setScheduleTheme = useMutation(api.appThemes.setSchedule);
  // Category names → their icon slots in the picker.
  const categories = useQuery(api.catalog.listCategories, {});

  const [editor, setEditor] = useState<{ theme: AppTheme; isNew: boolean } | null>(null);
  // Optimistic "who is live" while the publish round-trip is in flight.
  const [pendingActiveId, setPendingActiveId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // Schedule draft: theme id + datetime-local strings (local time).
  const [sched, setSched] = useState<{ themeId: string; from: string; to: string }>({
    themeId: "",
    from: "",
    to: "",
  });

  // ---- live preview: draft edits repaint the whole app, cancel restores ---
  const editing = editor !== null;
  useEffect(() => {
    if (!editing || !editor) return;
    beginThemePreview(editor.theme);
    return () => endThemePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Clear the optimistic publish flag once the server confirms it.
  useEffect(() => {
    if (pendingActiveId !== undefined && state && state.activeId === pendingActiveId) {
      setPendingActiveId(undefined);
    }
  }, [state, pendingActiveId]);

  const activeId = pendingActiveId !== undefined ? pendingActiveId : (state?.activeId ?? null);
  const defaultId = state?.defaultId ?? null;
  const schedule = state?.schedule ?? null;
  // What members actually see right now (schedule window > published > default).
  const liveId = state
    ? effectiveThemeId({
        themes: state.themes,
        activeId,
        defaultId,
        schedule,
      })
    : null;

  const toLocalInput = (ms: number) => {
    const d = new Date(ms);
    return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  // Keep the schedule form in sync with the stored schedule (structural sharing
  // keeps the object identity stable while it is unchanged).
  useEffect(() => {
    if (schedule) {
      setSched({
        themeId: schedule.themeId,
        from: toLocalInput(schedule.from),
        to: toLocalInput(schedule.to),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  const defaultPreview: AppTheme = {
    id: "default",
    name: "App default",
    mode: "dark",
    radius: DEFAULT_RADIUS,
    colors: defaultColors("dark"),
  };
  const publishedTheme = state
    ? (resolveTheme({ themes: state.themes, activeId, defaultId, schedule }) ??
      (liveId === null ? defaultPreview : null))
    : null;

  // ---- actions ------------------------------------------------------------

  const startNew = () => {
    setEditor({ theme: createThemeFrom(publishedTheme, "New theme"), isNew: true });
  };

  const openEditor = (theme: AppTheme) => {
    if (theme.builtin || theme.id === "default") {
      setEditor({
        theme: createThemeFrom(theme, theme.id === "default" ? "New theme" : `${theme.name} (custom)`),
        isNew: true,
      });
    } else {
      setEditor({ theme: { ...theme, colors: { ...theme.colors } }, isNew: false });
    }
  };

  const patch = (next: AppTheme) => {
    setEditor((e) => (e ? { ...e, theme: next } : e));
    updateThemePreview(next);
  };

  const activate = async (theme: AppTheme | null) => {
    if (busy || editing) return;
    const id = theme?.id === "default" ? null : (theme?.id ?? null);
    setPendingActiveId(id);
    // Paint + cache instantly; the subscription confirms it for everyone.
    if (state)
      applyThemeState({
        themes: state.themes,
        activeId: id,
        defaultId: state.defaultId ?? null,
        schedule: state.schedule ?? null,
      });
    setBusy(true);
    try {
      await setActiveTheme({ id });
      toast.success(
        theme && theme.id !== "default"
          ? `“${theme.name}” published to every member`
          : "Back to the app default theme",
      );
    } catch (e) {
      setPendingActiveId(undefined);
      if (state) applyThemeState(state);
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** Star: choose (or clear) the club-wide default theme. */
  const makeDefault = async (theme: AppTheme | null) => {
    if (busy || editing) return;
    const id = theme?.id === "default" ? null : (theme?.id ?? null);
    setBusy(true);
    try {
      await setDefaultTheme({ id });
      toast.success(
        id === null
          ? "Back to the shipped app default theme"
          : `“${theme?.name}” is now the default — it applies whenever no theme is published`,
      );
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    if (!sched.themeId || !sched.from || !sched.to) {
      toast.error("Pick a theme, a start and an end time for the schedule");
      return;
    }
    const from = new Date(sched.from).getTime();
    const to = new Date(sched.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      toast.error("The end time must be after the start time");
      return;
    }
    setBusy(true);
    try {
      await setScheduleTheme({ themeId: sched.themeId, from, to });
      toast.success("Theme scheduled — it applies automatically inside the window");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const clearSchedule = async () => {
    setBusy(true);
    try {
      await setScheduleTheme({ themeId: null });
      toast.success("Schedule cleared");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (publish: boolean) => {
    if (!editor) return;
    setBusy(true);
    try {
      const t = editor.theme;
      const saved = await saveTheme({
        id: editor.isNew ? undefined : t.id,
        name: t.name.trim() || "Untitled theme",
        mode: t.mode,
        colors: t.colors,
        radius: t.radius,
        icons: t.icons,
      });
      const baseThemes = state?.themes ?? [];
      // Never let a stale server echo drop the corner radius we just edited:
      // the published theme must carry exactly what the slider showed.
      const safeSaved: AppTheme = {
        ...saved,
        radius: Number.isFinite(saved.radius) ? saved.radius : t.radius,
      };
      const upserted = editor.isNew
        ? [...baseThemes, safeSaved]
        : baseThemes.map((x) => (x.id === safeSaved.id ? safeSaved : x));
      const nextActive = publish ? saved.id : (state?.activeId ?? null);
      // Update the source of truth BEFORE the editor unmounts so the
      // preview rollback restores the just-saved theme, not the old one.
      applyThemeState({
        themes: upserted,
        activeId: nextActive,
        defaultId: state?.defaultId ?? null,
        schedule: state?.schedule ?? null,
      });
      if (publish) setPendingActiveId(saved.id);
      setEditor(null);
      toast.success(
        publish
          ? `“${saved.name}” saved & published to every member`
          : `“${saved.name}” saved — publish it when you're ready`,
      );
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (theme: AppTheme) => {
    setBusy(true);
    try {
      const copy = await saveTheme({
        name: `${theme.name} copy`.slice(0, 40),
        mode: theme.mode,
        colors: theme.colors,
        radius: theme.radius,
        icons: theme.icons,
      });
      toast.success(`“${copy.name}” created`);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (theme: AppTheme) => {
    if (!window.confirm(`Delete the theme “${theme.name}”? This cannot be undone.`)) return;
    try {
      await removeTheme({ id: theme.id });
      if (editor?.theme.id === theme.id) setEditor(null);
      toast.success(`“${theme.name}” deleted`);
    } catch (e) {
      toast.error(asMessage(e));
    }
  };

  // ---- editor helpers -----------------------------------------------------

  const modeDefaults = editor ? defaultColors(editor.theme.mode) : null;

  const setColor = (key: ThemeTokenKey, hex: string) => {
    if (!editor) return;
    patch({ ...editor.theme, colors: { ...editor.theme.colors, [key]: hex } });
  };

  const setMode = (mode: ThemeMode) => {
    if (!editor || editor.theme.mode === mode) return;
    patch({ ...editor.theme, mode, colors: defaultColors(mode) });
    toast.info(`Base mode: ${mode} — colors reset to the ${mode} defaults`);
  };

  const resetAll = () => {
    if (!editor) return;
    patch({ ...editor.theme, colors: defaultColors(editor.theme.mode) });
    toast.success("All colors reset to the theme defaults");
  };

  // ---- render -------------------------------------------------------------

  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
      {editor ? (
        <>
          {/* ===== editor ===== */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                title="Back to themes"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                <X className="size-4" />
              </Button>
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Palette className="size-4" />
                  {editor.isNew ? "Create a theme" : "Edit theme"} — live preview
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The whole app repaints as you edit, so you see exactly what members will get.
                  Nothing is saved until you press Save.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={resetAll}>
                <RotateCcw className="size-4" /> Reset colors
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void save(false)}>
                {busy ? <LoadingGifInline size={18} className="size-4" /> : <Save className="size-4" />}
                Save
              </Button>
              <Button disabled={busy} onClick={() => void save(true)}>
                <Globe className="size-4" /> Save &amp; publish
              </Button>
            </div>
          </div>

          {/* name / mode / radius */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="theme-name" className="text-xs">
                Theme name
              </Label>
              <Input
                id="theme-name"
                value={editor.theme.name}
                maxLength={40}
                onChange={(e) => patch({ ...editor.theme, name: e.target.value })}
                placeholder="e.g. Workshop Amber"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Base mode</Label>
              <div className="flex gap-1.5">
                {(
                  [
                    ["dark", "Dark", Moon],
                    ["light", "Light", Sun],
                  ] as const
                ).map(([m, lbl, Icon]) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={editor.theme.mode === m ? "default" : "outline"}
                    className="flex-1 gap-1.5"
                    disabled={busy}
                    onClick={() => setMode(m)}
                  >
                    <Icon className="size-3.5" /> {lbl}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">
                Corner radius — {editor.theme.radius.toFixed(2).replace(/\.?0+$/, "")} rem
              </Label>
              <Slider
                min={0}
                max={1.5}
                step={0.05}
                value={[editor.theme.radius]}
                onValueChange={([v]) =>
                  patch({ ...editor.theme, radius: clamp(v, 0, 1.5) })
                }
                className="mt-2"
              />
            </div>
          </div>

          {/* per-theme app icons */}
          <IconPicker
            icons={editor.theme.icons ?? {}}
            published={publishedTheme?.icons ?? null}
            categories={(categories ?? []).map((c) => c.name)}
            disabled={busy}
            onChange={(icons) => patch({ ...editor.theme, icons })}
          />

          {/* token groups */}
          {TOKEN_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2 border-b pb-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {group.label}
                </p>
                <p className="text-[11px] text-muted-foreground">{group.hint}</p>
              </div>
              <div className="grid gap-1.5 xl:grid-cols-2">
                {group.tokens.map((tok) => (
                  <ColorField
                    key={tok.key}
                    label={tok.label}
                    hint={tok.hint}
                    value={editor.theme.colors[tok.key] ?? modeDefaults?.[tok.key] ?? "#808080"}
                    onChange={(hex) => setColor(tok.key, hex)}
                    onReset={() => setColor(tok.key, modeDefaults?.[tok.key] ?? "#808080")}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button variant="ghost" disabled={busy} onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void save(false)}>
              <Save className="size-4" /> Save
            </Button>
            <Button disabled={busy} onClick={() => void save(true)}>
              <Globe className="size-4" /> Save &amp; publish
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* ===== header ===== */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Palette className="size-4" /> App theme — published to every member
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a theme for the whole club or build your own: every color in the app is
                yours to set. Publishing applies instantly on every device and is cached, so
                members never wait for it to load — even offline.
              </p>
            </div>
            <Button className="shrink-0 gap-1.5" disabled={busy} onClick={startNew}>
              <Plus className="size-4" /> New theme
            </Button>
          </div>

          {/* published summary */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <Palette className="size-3.5 shrink-0 text-primary" />
            <span>
              Currently live:{" "}
              <b className="text-foreground">{publishedTheme?.name ?? "App default"}</b>
            </span>
            <span className="text-muted-foreground">
              — applies to all members, cached on each device.
            </span>
            {state?.defaultId && (
              <span className="text-muted-foreground">
                Default when nothing is published:{" "}
                <b className="text-foreground">
                  {BUILTIN_THEMES.find((t) => t.id === state.defaultId)?.name ??
                    state.themes.find((t) => t.id === state.defaultId)?.name ??
                    "App default"}
                </b>
              </span>
            )}
            {schedule && (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <CalendarClock className="mr-1 inline size-3" />
                {new Date(schedule.from).toLocaleDateString()} →{" "}
                {new Date(schedule.to).toLocaleDateString()}
                {Date.now() >= schedule.from && Date.now() < schedule.to
                  ? " · live now"
                  : ""}
              </span>
            )}
          </div>

          {/* ===== scheduled theme: start → end auto-apply ===== */}
          <div className="flex flex-col gap-2 rounded-md border border-dashed px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <CalendarClock className="size-3.5 text-primary" /> Schedule a theme
                <span className="font-normal text-muted-foreground">
                  — e.g. Christmas colors from Dec 15 → Jan 6, then it reverts automatically
                </span>
              </p>
              {schedule && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => void clearSchedule()}
                >
                  <X className="size-3.5" /> Clear schedule
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-44 gap-1">
                <Label className="text-[11px]">Theme</Label>
                <Select
                  value={sched.themeId}
                  onValueChange={(v) => setSched((s) => ({ ...s, themeId: v }))}
                  disabled={busy}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Pick a theme…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {BUILTIN_THEMES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} (preset)
                      </SelectItem>
                    ))}
                    {state?.themes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px]" htmlFor="sched-from">
                  Starts
                </Label>
                <Input
                  id="sched-from"
                  type="datetime-local"
                  className="h-8 w-44 text-xs"
                  value={sched.from}
                  onChange={(e) => setSched((s) => ({ ...s, from: e.target.value }))}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px]" htmlFor="sched-to">
                  Ends
                </Label>
                <Input
                  id="sched-to"
                  type="datetime-local"
                  className="h-8 w-44 text-xs"
                  value={sched.to}
                  onChange={(e) => setSched((s) => ({ ...s, to: e.target.value }))}
                />
              </div>
              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                disabled={busy}
                onClick={() => void saveSchedule()}
              >
                <CalendarClock className="size-3.5" /> {schedule ? "Update" : "Schedule"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Inside the window the scheduled theme wins for every member; outside it the
              published (or default) theme returns on its own — no re-publish needed.
            </p>
          </div>

          {/* ===== horizontal theme list ===== */}
          {state === undefined ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoadingGifInline size={18} className="size-4" /> Loading themes…
            </p>
          ) : (
            <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
              <ThemeCard
                theme={defaultPreview}
                isDefault
                active={liveId === null}
                disabled={busy}
                onActivate={() => void activate(defaultPreview)}
                onEdit={() => openEditor(defaultPreview)}
                onSetDefault={defaultId !== null ? () => void makeDefault(null) : undefined}
                defaultTitle="Back to the shipped app default"
                isClubDefault={defaultId === null}
              />
              {BUILTIN_THEMES.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  active={liveId === t.id}
                  isClubDefault={defaultId === t.id}
                  disabled={busy}
                  onActivate={() => void activate(t)}
                  onEdit={() => openEditor(t)}
                  onDuplicate={() => void duplicate(t)}
                  onSetDefault={() => void makeDefault(t)}
                />
              ))}
              {state.themes.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  active={liveId === t.id}
                  isClubDefault={defaultId === t.id}
                  disabled={busy}
                  onActivate={() => void activate(t)}
                  onEdit={() => openEditor(t)}
                  onDuplicate={() => void duplicate(t)}
                  onDelete={() => void del(t)}
                  onSetDefault={() => void makeDefault(t)}
                />
              ))}
              {/* create-new tile */}
              <button
                type="button"
                onClick={startNew}
                className="flex w-60 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              >
                <span className="flex size-10 items-center justify-center rounded-full border border-dashed">
                  <Plus className="size-5" />
                </span>
                <span className="text-sm font-semibold">Create new theme</span>
                <span className="text-center text-[11px]">
                  Set every color yourself — picker, HEX or RGB
                </span>
              </button>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2.5 text-[11px] text-muted-foreground">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              <b className="text-foreground">How it works:</b> the published theme overrides the
              built-in colors for everyone — members keep their own dark/light preference even
              while a theme is live (the theme owns the colors, you own dark/light). Star a
              theme to make it the club <b className="text-foreground">default</b>, and use{' "'}
              Schedule a theme{' "'}
              for holidays: it turns itself on and off between the two times. Custom themes are
              stored in the club database, so they sync across every admin account and device.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
