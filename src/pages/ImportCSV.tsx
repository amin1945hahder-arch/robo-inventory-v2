import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileUp, Loader2, Sparkles } from "lucide-react";

const SAMPLE = `group,category,closet,quantity,brand,model,description
Arduino Uno,Boards,Closet 1,8,Arduino,A000066,ATmega328P board
HC-SR04 Ultrasonic,Sensors,Closet 2,10,Generic,,Distance sensor 2-400cm`;

export default function ImportCSV() {
  const importCsv = useMutation(api.importer.importCsv);
  const seedClub = useMutation(api.seedClub.seedClubData);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await importCsv({ csv });
      toast.success(`Imported ${res.groupsCreated} groups · ${res.partsCreated} units`);
      setCsv("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Import inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste CSV rows — missing categories, closets and groups are created automatically, and
            every unit gets its own QR tag.
          </p>
        </header>

        <div className="rounded-lg border">
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-semibold">Format</h2>
          </div>
          <div className="px-5 py-4 text-sm text-muted-foreground">
            <p className="font-mono text-xs">
              group, category, closet, quantity, brand, model, description
            </p>
            <p className="mt-2 text-xs">
              A header row is optional. Quantity is capped at 200 per row.
            </p>
          </div>
        </div>

        <Textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          placeholder={SAMPLE}
          className="font-mono text-xs"
        />

        <div className="flex gap-2">
          <Button onClick={run} disabled={busy || !csv.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {busy ? "Importing…" : "Import CSV"}
          </Button>
          <Button variant="outline" onClick={() => setCsv(SAMPLE)}>
            Fill sample
          </Button>
        </div>

        <div className="rounded-lg border border-dashed px-5 py-4">
          <p className="text-sm font-medium">Import the full club dataset</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Closets 1–8, your real component groups (working/broken per closet), the 14 club
            projects with assigned parts, all members with roles, and the complete loan history.
            Re-running wipes inventory tables and rebuilds them cleanly — user accounts are kept.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              try {
                const res = await seedClub({});
                toast.success(
                  `Club dataset loaded — ${res.groups} groups, ${res.parts} tagged units, ${res.projects} projects, ${res.members} members`,
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              } finally {
                setSeeding(false);
              }
            }}
          >
            <Sparkles className="size-4" /> Import club dataset
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
