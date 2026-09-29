import { useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv } from "@/lib/csv";
import { toast } from "sonner";
import { FileDown, FileUp, Loader2 } from "lucide-react";

const SAMPLE = `group,category,closet,quantity,brand,model,description
Arduino Uno,Boards,Storage 1,8,Arduino,A000066,ATmega328P board
HC-SR04 Ultrasonic,Sensors,Storage 2,10,Generic,,Distance sensor 2-400cm`;

// Importer template: the exact columns importCsv accepts, with one example
// row and a comment row describing each column. Fill it in Excel/Sheets and
// re-import — missing categories/storages/groups are created automatically.
const TEMPLATE_ROWS: (string | number)[][] = [
  ["group", "category", "closet", "quantity", "brand", "model", "description"],
  [
    "(required) component name, e.g. Arduino Uno",
    "(required) category — created if missing",
    "(required) storage/shelf — created if missing",
    "units to create (1-200)",
    "brand",
    "model number",
    "description",
  ],
  ["Arduino Uno", "Boards", "Storage 1", 8, "Arduino", "A000066", "ATmega328P board"],
  ["HC-SR04 Ultrasonic", "Sensors", "Storage 2", 10, "Generic", "", "Distance sensor 2-400cm"],
];

export default function ImportCSV() {
  const importCsv = useMutation(api.importer.importCsv);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);

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
            Paste CSV rows — missing categories, storages and groups are created automatically, and
            every unit gets its own QR tag. The CSV column is still named <code>closet</code> for
            backwards compatibility, but its values are your storage names.
          </p>
        </header>

        <div className="glass-3d rounded-lg border">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-sm font-semibold">Format</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `inventory-import-template-${new Date().toISOString().slice(0, 10)}.csv`,
                  TEMPLATE_ROWS.map((r) => r.join(",")).join("\n"),
                )
              }
            >
              <FileDown className="size-4" /> Download CSV template
            </Button>
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
            {busy ? <LoadingGifInline size={18} className="size-4" /> : <FileUp className="size-4" />}
            {busy ? "Importing…" : "Import CSV"}
          </Button>
          <Button variant="outline" onClick={() => setCsv(SAMPLE)}>
            Fill sample
          </Button>
        </div>

      </div>
    </AppShell>
  );
}
