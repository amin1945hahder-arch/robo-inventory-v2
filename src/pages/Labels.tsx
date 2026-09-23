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
import { categoryQr, closetQr, groupQr, personQr, projectQr, qrUrl, unitQr } from "@/lib/qr";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  computeColumns,
  DEFAULT_SIZES,
  labelHeightMm,
  labelWidthMm,
  PAPERS,
  SIZE_OPTIONS,
  STACKED_TEXT_STRIP_MM,
  type SectionKey,
  type SectionSizes,
} from "@/lib/label-layout";
import { Printer, Loader2, QrCode, Grid2x2, Download } from "lucide-react";

/**
 * Bulk QR label sheets with physical sizing:
 *  - every section (storages, categories, projects, groups, units) has its own
 *    label size in millimetres — sub-units of a group can get their own size
 *  - labels are laid out on the chosen paper (A4/A3/Letter) in mm, so what you
 *    see is the physical sheet you print; rows never split mid-label
 */

// CSS px per mm at 96dpi — QR rendered at this px prints at the right mm size.
const MM = 96 / 25.4;

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
  // label = QR + text: side-by-side when big (≥18mm), QR on top + a text
  // strip underneath when small (<18mm) — the strip is reserved height, so
  // the text can never overlap the QR no matter how small the label gets.
  const horizontal = sizeMm >= 18;
  const qrPx = Math.round(sizeMm * MM);
  if (horizontal) {
    return (
      <div
        className="print-label flex items-center gap-1.5 rounded-[2px] border border-neutral-300 bg-white p-1 text-black"
        style={{
          width: `${labelWidthMm(sizeMm)}mm`,
          minHeight: `${labelHeightMm(sizeMm)}mm`,
        }}
      >
        <div className="shrink-0" style={{ width: qrPx, height: qrPx }}>
          <QRCode value={qrUrl(value)} size={qrPx} style={{ width: "100%", height: "100%" }} />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[9px] font-semibold">{title}</p>
          {sub && <p className="truncate font-mono text-[7px] text-neutral-600">{sub}</p>}
          <p className="truncate font-mono text-[7px] text-neutral-400">{value}</p>
        </div>
      </div>
    );
  }
  // Stacked: QR block of exact mm size, then a fixed-height text strip.
  const stripPx = Math.round(STACKED_TEXT_STRIP_MM * MM);
  return (
    <div
      className="print-label flex flex-col items-center rounded-[2px] border border-neutral-300 bg-white p-1 text-black"
      style={{
        width: `${labelWidthMm(sizeMm)}mm`,
        minHeight: `${labelHeightMm(sizeMm)}mm`,
      }}
    >
      <div className="shrink-0" style={{ width: qrPx, height: qrPx }}>
        <QRCode value={qrUrl(value)} size={qrPx} style={{ width: "100%", height: "100%" }} />
      </div>
      <div
        className="flex w-full flex-col justify-center overflow-hidden leading-none"
        style={{ height: stripPx }}
      >
        <p className="w-full truncate text-center text-[7px] font-semibold">{title}</p>
        <p className="w-full truncate text-center font-mono text-[6px] text-neutral-500">{value}</p>
      </div>
    </div>
  );
}

export default function Labels() {
  const data = useQuery(api.labels.getLabelData, {});
  const [section, setSection] = useState<SectionKey>("all");

  // per-section label size in mm — units (the many small tags) default smaller
  const [sizes, setSizes] = useState<SectionSizes>(DEFAULT_SIZES);

  // sheet setup
  const [paper, setPaper] = useState("a4");
  const [orientation, setOrientation] = useState("portrait");
  const [margin, setMargin] = useState(8);
  const [showGrid, setShowGrid] = useState(false);

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

  // Cutting grid: dashed cut lines drawn inside each label cell (screen only).
  const gridOverlay = showGrid
    ? { boxShadow: "0 0 0 1px #d4d4d4, inset 0 0 0 0.5px #a3a3a3" }
    : undefined;

  const sizeControl = (key: Exclude<SectionKey, "all">, label: string) => (
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

  // Column basis = the real width of the widest label shown (QR + text +
  // padding, from the shared layout module), so every column can hold its
  // label — no overlap when sizes/margins change. When a single section is
  // selected, only that section's size drives the grid.
  const gridStyle = useMemo(() => {
    const key: Exclude<SectionKey, "all"> =
      section === "all"
        ? (Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] as Exclude<SectionKey, "all">)
        : section;
    const { basisMm } = computeColumns(key, sizes, {
      paperWidthMm: PAPERS[paper].w,
      marginMm: margin,
    });
    return {
      display: "grid",
      gridTemplateColumns: `repeat(auto-fill, minmax(${basisMm}mm, 1fr))`,
      gap: "2mm",
    };
  }, [sizes, section, paper, margin]);
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
          <div className="flex gap-2">
            <Button
              variant={showGrid ? "default" : "outline"}
              onClick={() => setShowGrid((g) => !g)}
              title="Toggle the cutting grid between labels"
            >
              <Grid2x2 className="size-4" /> Grid
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!data) return;
                const rows: (string | number)[][] = [
                  ["Section", "Title", "Sub", "QR payload"],
                  ...data.closets.map((c) => ["storage", c.name, c.location ?? "", closetQr(c._id)]),
                  ...data.categories.map((c) => ["category", c.name, "", categoryQr(c.name)]),
                  ...data.projects.map((p) => ["project", p.name, "", projectQr(p._id)]),
                  ...data.groups.map(({ group, closetAlias }) => [
                    "group",
                    group.name,
                    "",
                    // A group named exactly like a storage is a storage alias:
                    // its label carries the STORAGE QR so scans open the storage.
                    closetAlias ? closetQr(closetAlias._id) : groupQr(group._id),
                  ]),
                  ...data.groups.flatMap(({ group, parts }) =>
                    parts.map((p) => ["unit", p.tag, group.name, unitQr(p.tag)]),
                  ),
                  ...data.people.map((p: any) => ["person", p.name, p.sub ?? "", personQr(p._id)]),
                ];
                downloadCsv(`qr-labels-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
              }}
              disabled={!data}
            >
              <Download className="size-4" /> Export CSV
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Print sheet
            </Button>
          </div>
        </header>

        {/* controls (not printed) */}
        <div className="no-print flex flex-col gap-3 rounded-lg border bg-card/40 p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "Everything"],
                ["closets", "Storages"],
                ["categories", "Categories"],
                ["projects", "Projects"],
                ["groups", "Groups"],
                ["units", "Units"],
                ["people", "People"],
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
            {(section === "all" || section === "closets") && sizeControl("closets", "Storages")}
            {(section === "all" || section === "categories") && sizeControl("categories", "Categories")}
            {(section === "all" || section === "projects") && sizeControl("projects", "Projects")}
            {(section === "all" || section === "groups") && sizeControl("groups", "Groups")}
            {(section === "all" || section === "units") && sizeControl("units", "Units")}
            {(section === "all" || section === "people") && sizeControl("people", "People")}
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
                  Storages
                </h2>
                <div style={gridStyle}>
                  {data.closets.map((c) => (
                    <div key={c._id} style={gridOverlay} className="print-cell">
                      <MmLabel
                        value={closetQr(c._id)}
                        title={c.name}
                        sub={c.location ?? undefined}
                        sizeMm={sizes.closets}
                      />
                    </div>
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
                    <div key={c._id} style={gridOverlay} className="print-cell">
                      <MmLabel value={categoryQr(c.name)} title={c.name} sizeMm={sizes.categories} />
                    </div>
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
                    <div key={p._id} style={gridOverlay} className="print-cell">
                      <MmLabel value={projectQr(p._id)} title={p.name} sizeMm={sizes.projects} />
                    </div>
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
                  {data.groups.map(({ group, closetAlias }) => (
                    <div key={group._id} style={gridOverlay} className="print-cell">
                      <MmLabel
                        value={closetAlias ? closetQr(closetAlias._id) : groupQr(group._id)}
                        title={group.name}
                        sub={closetAlias ? `→ storage: ${closetAlias.name}` : undefined}
                        sizeMm={sizes.groups}
                      />
                    </div>
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
                      <div key={p._id} style={gridOverlay} className="print-cell">
                        <MmLabel
                          value={unitQr(p.tag)}
                          title={p.tag}
                          sub={group.name}
                          sizeMm={sizes.units}
                        />
                      </div>
                    )),
                  )}
                </div>
              </section>
            )}

            {show("people") && data.people.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  People
                </h2>
                <div style={gridStyle}>
                  {data.people.map((p: any) => (
                    <div key={p._id} style={gridOverlay} className="print-cell">
                      <MmLabel
                        value={personQr(p._id)}
                        title={p.name}
                        sub={p.sub || undefined}
                        sizeMm={sizes.people}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
