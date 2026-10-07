import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { AppearanceSection, MySoundsSection } from "@/pages/AdminSettings";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  BUILTIN_THEMES,
  isScheduledThemeLive,
  swatchColors,
  type AppTheme,
} from "@/lib/appTheme";
import { cn } from "@/lib/utils";
import { Award, Palette, Settings as SettingsIcon, Sparkles, Volume2 } from "lucide-react";

/**
 * Per-user theme choice. The member picks any built-in preset (or a custom
 * theme the admin saved), or "Follow club theme" to track whatever the admin
 * publishes. A scheduled club theme is forced for everyone while its window
 * is live — shown here so the choice never looks broken.
 */
function MyThemeSection() {
  const state = useQuery(api.appThemes.get, {});
  const myTheme = useQuery(api.settings.getMyTheme, {});
  const setMyTheme = useMutation(api.settings.setMyTheme);

  const customThemes: AppTheme[] = (state?.themes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    mode: t.mode,
    colors: t.colors,
    radius: (t as AppTheme).radius ?? 0.625,
  }));
  const scheduledLive = isScheduledThemeLive(state);

  const choose = async (id: string | null) => {
    try {
      await setMyTheme({ id });
      toast.success(id ? "Your theme is applied on all your devices" : "Following the club theme");
    } catch {
      toast.error("Could not save your theme");
    }
  };

  const Card = ({ theme, selected }: { theme: AppTheme; selected: boolean }) => (
    <button
      type="button"
      onClick={() => void choose(theme.id)}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary/10" : "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-1.5">
        {swatchColors(theme).map((c, i) => (
          <span
            key={i}
            className="size-3.5 rounded-full border border-black/20"
            style={{ backgroundColor: c }}
          />
        ))}
      </span>
      <span className="text-sm font-medium">{theme.name}</span>
      <span className="text-[11px] capitalize text-muted-foreground">{theme.mode} theme</span>
    </button>
  );

  return (
    <section className="flex flex-col gap-4 glass-3d rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4" /> Theme — my choice
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick the colors YOU see. Choose “Follow club theme” to keep whatever the admins publish,
          or set your own below.
        </p>
      </div>

      {scheduledLive && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          A scheduled club theme is live right now — it applies to everyone until the event ends,
          then your own choice returns.
        </p>
      )}

      {state === undefined || myTheme === undefined ? (
        <p className="text-sm text-muted-foreground">Loading themes…</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void choose(null)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
              myTheme === ""
                ? "border-primary bg-primary/10 font-medium"
                : "hover:border-primary/40 hover:bg-muted/40",
            )}
          >
            <Palette className="size-4 text-primary" /> Follow club theme
            {myTheme === "" && <span className="ml-auto text-xs text-primary">Active</span>}
          </button>

          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[...BUILTIN_THEMES, ...customThemes].map((t) => (
              <Card key={t.id} theme={t} selected={myTheme === t.id} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Member Settings — the general settings page every NON-admin member gets.
 *
 * It deliberately contains only personal, per-account choices (theme,
 * appearance, notification sounds, promotions), never lab-wide admin
 * controls. The admin console (AdminSettings) is still shown to admins at the
 * same route, chosen by src/pages/Settings.tsx.
 */
export default function MemberSettings() {
  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <SettingsIcon className="size-6 text-primary" /> Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your personal preferences — these apply to your account on every device.
          </p>
        </header>

        {/* Per-user theme (overrides the published club theme). */}
        <MyThemeSection />

        {/* Appearance: dark/light/system + the typeface for this member. */}
        <section aria-labelledby="member-appearance">
          <h2
            id="member-appearance"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            <Palette className="size-4" /> Appearance
          </h2>
          <AppearanceSection />
        </section>

        {/* Notification sounds — per-user tones/alarms. */}
        <section aria-labelledby="member-sounds">
          <h2
            id="member-sounds"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            <Volume2 className="size-4" /> Sounds
          </h2>
          <MySoundsSection />
        </section>

        {/* Promotions & ranks live on the profile page (request + status). */}
        <section aria-labelledby="member-promotions">
          <h2
            id="member-promotions"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            <Award className="size-4" /> Promotions &amp; ranks
          </h2>
          <div className="flex flex-col gap-3 glass-3d rounded-lg border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Request a promotion</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ask the admins to upgrade your access level or club rank. Your request opens on your
                profile, where you can also track its status.
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link to="/profile">Open my profile</Link>
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
