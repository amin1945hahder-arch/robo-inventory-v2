import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { categoryQr, closetQr, groupQr, projectQr, qrUrl, unitQr } from "@/lib/qr";
import { Printer, Loader2, QrCode } from "lucide-react";

/**
 * Bulk QR label sheets with physical sizing:
 *  - every section (closets, categories, projects, groups, units) has its own
 *    label size in millimetres — sub-units of a group can get their own size
 *  - labels are laid out on the chosen paper (A4/A3/Letter) in mm, so what you
 *    see is the physical sheet you print; rows never split mid-label
 */

const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  a4: { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
  a3: { label: "A3 (297 × 420 mm)", w: 297, h: 420 },
  letter: { label: "US Letter (216 × 279 mm)", w: 216, h: 279 },
};

// CSS px per mm at 96dpi — QR rendered at this px prints at the right mm size.
const MM = 96 / 25.4;

type SectionKey = "all" | "closets" | "categories" | "projects" | "groups" | "units";

const SIZE_OPTIONS = [12, 15, 18, 20, 25, 30, 40, 50] as const;

function MmLabel({
  value,
  title,
  sub,
  sizeMm,
}: {
  value: string;
  title: string;
  sub?: string;
  sizeMm: number;
}) {
  // label = QR + text, laid out horizontally when big, stacked when small
  const horizontal = sizeMm >= 18;
  const qrPx = Math.round(sizeMm * MM);
  return (
    <div
      className="print-label flex items-center gap-1.5 rounded-[2px] border border-neutral-300 bg-white p-1 text-black"
      style={{ width: `${sizeMm + (horizontal ? sizeMm * 1.35 : 0)}mm`, minHeight: `${sizeMm + 4}mm` }}
    >
      <div className="shrink-0" style={{ width: qrPx, height: qrPx }}>
        <QRCode value={qrUrl(value)} size={qrPx} style={{ width: "100%", height: "100%" }} />
      </div>
      {horizontal && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[9px] font-semibold">{title}</p>
          {sub && <p className="truncate font-mono text-[7px] text-neutral-600">{sub}</p>}
          <p className="truncate font-mono text-[7px] text-neutral-400">{value}</p>
        </div>
      )}
    </div>
  );
}

export default function Labels() {
  const data = useQuery(api.labels.getLabelData, {});
  const [section, setSection] = useState<SectionKey>("all");

  // per-section label size in mm — units (the many small tags) default smaller
  const [sizes, setSizes] = useState<Record<string, number>>({
    closets: 30,
    categories: 25,
    projects: 25,
    groups: 20,
    units: 15,
  });

  // sheet setup
  const [paper, setPaper] = useState("a4");
  const [orientation, setOrientation] = useState("portrait");
  const [margin, setMargin] = useState(8);

  useEffect(() => {
    const p = PAPERS[paper];
    const style = document.createElement("style");
    style.id = "labels-print-style";
    style.textContent = `
      @media print {
        @page { size: ${p.w}mm ${p.h}mm ${orientation}; margin: ${margin}mm; }
      }
    `;
    const old = document.getElementById("labels-print-style");
    if (old) old.remove();
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper, orientation, margin]);

  const show = (key: Exclude<SectionKey, "all">) => (section === "all" ? true : section === key);

  const sizeControl = (key: string, label: string) => (
    <div className="grid gap-1" key={key}>
      <Label className="text-[11px] text-muted-foreground">{label} (mm)</Label>
      <Select
        value={String(sizes[key])}
        onValueChange={(v) => setSizes((s) => ({ ...s, [key]: Number(v) }))}
      >
        <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
        <SelectContent>
          {SIZE_OPTIONS.map((mm) => (
            <SelectItem key={mm} value={String(mm)}>{mm}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  // Column basis adapts to the sections actually shown — when a single section
  // is selected, its own size drives the grid instead of the global minimum.
  const gridStyle = useMemo(
    () => {
      const shown =
        section === "all"
          ? Object.values(sizes)
          : [sizes[section] ?? 20];
      const basis = Math.min(...shown) + 22;
      return {
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${basis}mm, 1fr))`,
        gap: "2mm",
      };
    },
    [sizes, section],
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Print QR labels</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Physical sizes in mm, mapped onto the paper — pick a size per section, including a
              separate size for the many individual unit tags.
            </p>
          </div>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Print sheet
          </Button>
        </header>

        {/* controls (not printed) */}
        <div className="no-print flex flex-col gap-3 rounded-lg border bg-card/40 p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "Everything"],
                ["closets", "Closets"],
                ["categories", "Categories"],
                ["projects", "Projects"],
                ["groups", "Groups"],
                ["units", "Units"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={section === key ? "default" : "outline"}
                onClick={() => setSection(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4 border-t pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <QrCode className="size-3.5" /> Label size
            </p>
            {(section === "all" || section === "closets") && sizeControl("closets", "Closets")}
            {(section === "all" || section === "categories") && sizeControl("categories", "Categories")}
            {(section === "all" || section === "projects") && sizeControl("projects", "Projects")}
            {(section === "all" || section === "groups") && sizeControl("groups", "Groups")}
            {(section === "all" || section === "units") && sizeControl("units", "Units")}
            <div className="ml-auto flex flex-wrap items-end gap-4">
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">Paper</Label>
                <Select value={paper} onValueChange={setPaper}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAPERS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">Orientation</Label>
                <Select value={orientation} onValueChange={setOrientation}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">Margin (mm)</Label>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={margin}
                  onChange={(e) => setMargin(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                  className="w-20"
                />
              </div>
            </div>
          </div>
        </div>

        {data === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading labels…
          </p>
        ) : (
          <div id="print-area" className="flex flex-col gap-6 bg-white p-3 text-black">
            {show("closets") && data.closets.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Closets
                </h2>
                <div style={gridStyle}>
                  {data.closets.map((c) => (
                    <MmLabel
                      key={c._id}
                      value={closetQr(c._id)}
                      title={c.name}
                      sub={c.location ?? undefined}
                      sizeMm={sizes.closets}
                    />
                  ))}
                </div>
              </section>
            )}

            {show("categories") && data.categories.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Categories
                </h2>
                <div style={gridStyle}>
                  {data.categories.map((c) => (
                    <MmLabel key={c._id} value={categoryQr(c.name)} title={c.name} sizeMm={sizes.categories} />
                  ))}
                </div>
              </section>
            )}

            {show("projects") && data.projects.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Projects
                </h2>
                <div style={gridStyle}>
                  {data.projects.map((p) => (
                    <MmLabel key={p._id} value={projectQr(p._id)} title={p.name} sizeMm={sizes.projects} />
                  ))}
                </div>
              </section>
            )}

            {show("groups") && data.groups.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Groups
                </h2>
                <div style={gridStyle}>
                  {data.groups.map(({ group }) => (
                    <MmLabel key={group._id} value={groupQr(group.name)} title={group.name} sizeMm={sizes.groups} />
                  ))}
                </div>
              </section>
            )}

            {show("units") && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Individual units
                </h2>
                <div style={gridStyle}>
                  {data.groups.flatMap(({ group, parts }) =>
                    parts.map((p) => (
                      <MmLabel
                        key={p._id}
                        value={unitQr(p.tag)}
                        title={p.tag}
                        sub={group.name}
                        sizeMm={sizes.units}
                      />
                    )),
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
