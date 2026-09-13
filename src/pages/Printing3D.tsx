import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Box, Droplets, Layers, Printer, Wrench } from "lucide-react";

/**
 * 3D Printing — placeholder module (filled in later).
 * The layout anticipates a print-job queue: printers, materials, and jobs.
 * Kept visually consistent with the rest of the app so the eventual module
 * drops straight into this shell.
 */
export default function Printing3D() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const placeholderCards = [
    {
      icon: Printer,
      title: "Printers",
      body: "Register the club's printers, track status (idle / printing / maintenance) and current job.",
    },
    {
      icon: Layers,
      title: "Print jobs",
      body: "Members submit a job with file, material and estimated time; admins approve the queue.",
    },
    {
      icon: Droplets,
      title: "Materials",
      body: "Filament spools and resin tied to the inventory's weight-tracked groups — usage deducts stock.",
    },
    {
      icon: Wrench,
      title: "Maintenance",
      body: "Nozzle changes, bed leveling and failure logs per printer.",
    },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Box className="size-6 text-primary" /> 3D Printing
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The club's print farm — printers, job queue and material tracking. Coming soon.
            </p>
          </div>
          {isAdmin && (
            <Button variant="outline" disabled title="Module in development">
              Configure printers
            </Button>
          )}
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {placeholderCards.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-2 rounded-lg border border-dashed p-5 text-muted-foreground"
            >
              <Icon className="size-5 text-primary/70" />
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs leading-5">{body}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
          <Box className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">The print farm module is on its way</p>
          <p className="max-w-md text-xs leading-5 text-muted-foreground">
            It will plug into the inventory you already manage — material usage will draw from
            weight-tracked stock (PLA, PETG, resin), and each job will get its own receipt like
            rentals do.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
