import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
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
import { PaperPreview, mm, ScaledCell } from "@/components/PaperPreview";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  computeColumns,
  DEFAULT_SIZES,
  fitOnSheet,
  labelHeightMm,
  labelWidthMm,
  LABEL_GAP_MM,
  PAPERS,
  SIZE_OPTIONS,
  STACKED_TEXT_STRIP_MM,
  type SectionKey,
  type SectionSizes,
} from "@/lib/label-layout";
import { orientedSize, sheetPrintCss, type Orientation } from "@/lib/print";
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

/** Which text lines print alongside each QR chip (admin's choice). */
type LabelFields = { title: boolean; sub: boolean; code: boolean };
const ALL_FIELDS: LabelFields = { title: true, sub: true, code: true };
const FIELDS_KEY = "roboShelf.labelFields";

function MmLabel({
  value,
  title,
  sub,
  sizeMm,
  show,
}: {
  value: string;
  title: string;
  sub?: string;
  sizeMm: number;
  show: LabelFields;
}) {
  // label = QR + text: side-by-side when big (≥18mm), QR on top + a text
  // strip underneath when small (<18mm) — the strip is reserved height, so
  // the text can never overlap the QR no matter how small the label gets.
  // Each text line is independently toggleable (Label fields control).
  const showTitle = show.title;
  const showSub = show.sub && Boolean(sub);
  const showCode = show.code;
  const anyText = showTitle || showSub || showCode;
  const qrPx = Math.round(sizeMm * MM);
  if (sizeMm >= 18) {
    return (
      <div
        className="print-label flex items-center gap-1.5 rounded-[2px] border border-neutral-300 bg-white p-1 text-black"
        style={{
          width: `${labelWidthMm(sizeMm)}mm`,
          minHeight: `${labelHeightMm(sizeMm)}mm`,
          justifyContent: anyText ? undefined : "center",
        }}
      >
        <div className="shrink-0" style={{ width: qrPx, height: qrPx }}>
          <QRCode value={qrUrl(value)} size={qrPx} style={{ width: "100%", height: "100%" }} />
        </div>
        {anyText && (
          <div className="min-w-0 leading-tight">
            {showTitle && <p className="truncate text-[9px] font-semibold">{title}</p>}
            {showSub && <p className="truncate font-mono text-[7px] text-neutral-600">{sub}</p>}
            {showCode && <p className="truncate font-mono text-[7px] text-neutral-400">{value}</p>}
          </div>
        )}
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
        {showTitle && <p className="w-full truncate text-center text-[7px] font-semibold">{title}</p>}
        {showCode && <p className="w-full truncate text-center font-mono text-[6px] text-neutral-500">{value}</p>}
        {!showTitle && !showCode && showSub && sub && (
          <p className="w-full truncate text-center font-mono text-[6px] text-neutral-500">{sub}</p>
        )}
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

  // Which text lines print next to each QR chip — remembered per device.
  const [fields, setFields] = useState<LabelFields>(() => {
    try {
      const raw = localStorage.getItem(FIELDS_KEY);
      if (raw) return { ...ALL_FIELDS, ...JSON.parse(raw) };
    } catch {
      /* storage unavailable */
    }
    return ALL_FIELDS;
  });
  useEffect(() => {
    try {
      localStorage.setItem(FIELDS_KEY, JSON.stringify(fields));
    } catch {
      /* storage unavailable */
    }
  }, [fields]);

  useEffect(() => {
    // Shared sheet print CSS: oriented @page (single margin), app-shell
    // removed from the flow (no blank pages), true mm scale in print.
    const style = document.createElement("style");
    style.id = "labels-print-style";
    style.textContent = sheetPrintCss({
      paper: PAPERS[paper],
      orientation: orientation as Orientation,
      marginMm: margin,
    });
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

  // Grid per section: exact column width for THAT section's label size and
  // the exact number of columns that fit the oriented printable width — the
  // sheet fills edge to edge with only the cut gap between labels. Values
  // resolve through --mm so the preview scale and the printed sheet (where
  // --mm is forced to 1mm) both come out right.
  const dims = orientedSize(PAPERS[paper], orientation as Orientation);
  const gridFor = (key: Exclude<SectionKey, "all">): React.CSSProperties => {
    const { basisMm, columns } = computeColumns(key, sizes, {
      paperWidthMm: dims.w,
      marginMm: margin,
    });
    return {
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, calc(${basisMm} * var(--mm, 1px)))`,
      justifyContent: "start",
      gap: `calc(${LABEL_GAP_MM} * var(--mm, 1px))`,
    };
  };

  // “How many labels fit one sheet?” hint for the selected section.
  const fitHint =
    section !== "all"
      ? fitOnSheet(sizes[section], {
          paperWidthMm: dims.w,
          paperHeightMm: dims.h,
          marginMm: margin,
        })
      : null;
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 wide:flex-row wide:items-end">
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
                // QR link = the scannable app URL (the “equation” qrUrl() adds);
                // the raw payload column stays for machine use.
                const rows: (string | number)[][] = [];
                const push = (s: string, title: string, sub: string, payload: string) =>
                  rows.push([s, title, sub, qrUrl(payload), payload]);
                data.closets.forEach((c) => push("storage", c.name, c.location ?? "", closetQr(c._id)));
                data.categories.forEach((c) => push("category", c.name, "", categoryQr(c.name)));
                data.projects.forEach((p) => push("project", p.name, "", projectQr(p._id)));
                data.groups.forEach(({ group, closetAlias }) =>
                  push(
                    "group",
                    group.name,
                    "",
                    // A group named exactly like a storage is a storage alias:
                    // its label carries the STORAGE QR so scans open the storage.
                    closetAlias ? closetQr(closetAlias._id) : groupQr(group._id),
                  ),
                );
                data.groups.forEach(({ group, parts }) =>
                  parts.forEach((p) => push("unit", p.tag, group.name, unitQr(p.tag))),
                );
                data.people.forEach((p: any) => push("person", p.name, p.sub ?? "", personQr(p._id)));
                rows.unshift(["Section", "Title", "Sub", "QR link", "QR payload"]);
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
        <div className="no-print flex flex-col gap-3 glass-3d rounded-lg border bg-card/40 p-4">
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

          {/* Label fields: choose which columns print alongside each QR chip */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Print on each chip</p>
            {(
              [
                ["title", "Title"],
                ["sub", "Detail line"],
                ["code", "Code text"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={fields[key] ? "default" : "outline"}
                aria-pressed={fields[key]}
                onClick={() => setFields((f) => ({ ...f, [key]: !f[key] }))}
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFields(ALL_FIELDS)}
              title="Show every line"
            >
              Show all
            </Button>
            {fitHint && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                ≈ <b className="text-foreground">{fitHint.perSheet}</b> labels per sheet (
                {fitHint.columns} × {fitHint.rows} on {PAPERS[paper].label.split(" ")[0]}{" "}
                {orientation === "landscape" ? "landscape" : "portrait"})
              </span>
            )}
          </div>
        </div>

        {data === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <LoadingGifInline size={18} className="mr-2 inline size-4" /> Loading labels…
          </p>
        ) : (
          <PaperPreview
            pageMm={PAPERS[paper]}
            orientation={orientation as Orientation}
            marginMm={margin}
            className="print-area-wrapper"
            header={
              <p className="mb-2 text-xs text-muted-foreground">
                {PAPERS[paper].label} · real scale — width fits your screen
              </p>
            }
          >
            <div
              id="print-area"
              className="absolute flex flex-col bg-white text-black"
              style={{
                top: mm(margin),
                left: mm(margin),
                right: mm(margin),
                bottom: mm(margin),
                gap: mm(6),
                padding: mm(2),
              }}
            >
            {show("closets") && data.closets.length > 0 && (
              <section>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Storages
                </h2>
                <div style={gridFor("closets")}>
                  {data.closets.map((c) => (
                    <div key={c._id} style={gridOverlay} className="print-cell">
                      <ScaledCell wMm={labelWidthMm(sizes.closets)} hMm={labelHeightMm(sizes.closets)}>
                        <MmLabel
                          value={closetQr(c._id)}
                          title={c.name}
                          sub={c.location ?? undefined}
                          sizeMm={sizes.closets}
                          show={fields}
                        />
                      </ScaledCell>
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
                <div style={gridFor("categories")}>
                  {data.categories.map((c) => (
                    <div key={c._id} style={gridOverlay} className="print-cell">
                      <ScaledCell wMm={labelWidthMm(sizes.categories)} hMm={labelHeightMm(sizes.categories)}>
                        <MmLabel value={categoryQr(c.name)} title={c.name} sizeMm={sizes.categories} show={fields} />
                      </ScaledCell>
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
                <div style={gridFor("projects")}>
                  {data.projects.map((p) => (
                    <div key={p._id} style={gridOverlay} className="print-cell">
                      <ScaledCell wMm={labelWidthMm(sizes.projects)} hMm={labelHeightMm(sizes.projects)}>
                        <MmLabel value={projectQr(p._id)} title={p.name} sizeMm={sizes.projects} show={fields} />
                      </ScaledCell>
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
                <div style={gridFor("groups")}>
                  {data.groups.map(({ group, closetAlias }) => (
                    <div key={group._id} style={gridOverlay} className="print-cell">
                      <ScaledCell wMm={labelWidthMm(sizes.groups)} hMm={labelHeightMm(sizes.groups)}>
                        <MmLabel
                          value={closetAlias ? closetQr(closetAlias._id) : groupQr(group._id)}
                          title={group.name}
                          sub={closetAlias ? `→ storage: ${closetAlias.name}` : undefined}
                          sizeMm={sizes.groups}
                          show={fields}
                        />
                      </ScaledCell>
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
                <div style={gridFor("units")}>
                  {data.groups.flatMap(({ group, parts }) =>
                    parts.map((p) => (
                      <div key={p._id} style={gridOverlay} className="print-cell">
                        <ScaledCell wMm={labelWidthMm(sizes.units)} hMm={labelHeightMm(sizes.units)}>
                          <MmLabel
                            value={unitQr(p.tag)}
                            title={p.tag}
                            sub={group.name}
                            sizeMm={sizes.units}
                            show={fields}
                          />
                        </ScaledCell>
                      </div>
                    )),
                  )}
                </div>
              </section>
            )}

            {show("people") && data.people.length > 0 && (
              <section>
                <h2 className="font-semibold uppercase tracking-widest text-neutral-500" style={{ fontSize: mm(2.6), marginBottom: mm(2) }}>
                  People
                </h2>
                <div style={gridFor("people")}>
                  {data.people.map((p: any) => (
                    <div key={p._id} style={gridOverlay} className="print-cell">
                      <ScaledCell wMm={labelWidthMm(sizes.people)} hMm={labelHeightMm(sizes.people)}>
                        <MmLabel
                          value={personQr(p._id)}
                          title={p.name}
                          sub={p.sub || undefined}
                          sizeMm={sizes.people}
                          show={fields}
                        />
                      </ScaledCell>
                    </div>
                  ))}
                </div>
              </section>
            )}
            </div>
          </PaperPreview>
        )}
      </div>
    </AppShell>
  );
}
