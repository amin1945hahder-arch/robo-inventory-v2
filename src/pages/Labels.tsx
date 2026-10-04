import { memo, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
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
import { activeTabStyle } from "@/lib/utils";

// Each subtab fills with its OWN color when active (Settings-bar treatment).
const SECTION_COLORS: Record<string, string> = {
  all: "#a78bfa",
  closets: "#22d3ee",
  categories: "#38bdf8",
  projects: "#f472b6",
  groups: "#fbbf24",
  units: "#34d399",
  people: "#fb923c",
};
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
import {
  orientedSize,
  paginateRowRuns,
  sheetPrintCss,
  type Orientation,
  type RowRun,
} from "@/lib/print";
import { Printer, Loader2, QrCode, Grid2x2, Download, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Bulk QR label sheets with physical sizing:
 *  - every section (storages, categories, projects, groups, units) has its own
 *    label size in millimetres — sub-units of a group can get their own size
 *  - labels are packed into EXPLICIT sheet pages: integer rows per page, a
 *    page divider between sheets, a pager in the preview, and print output
 *    that matches the preview page for page (no trimmed half-rows).
 */

// CSS px per mm at 96dpi — QR rendered at this px prints at the right mm size.
const MM = 96 / 25.4;

/** Vertical space charged for a section heading + the gap between sections. */
const SECTION_HEADER_MM = 6;
const SECTION_GAP_MM = 6;
/** 1mm safety when packing rows — rounding can never spill a half-row. */
const PACK_SAFETY_MM = 1;

/** Which text lines print alongside each QR chip (admin's choice). */
type LabelFields = { title: boolean; sub: boolean; code: boolean };
const ALL_FIELDS: LabelFields = { title: true, sub: true, code: true };
const FIELDS_KEY = "roboShelf.labelFields";

const MmLabel = memo(function MmLabel({
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
  // strip underneath when small (<18mm). Each line is independently
  // toggleable (Label fields control).
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
});

/** One section's worth of label cells, ready to chunk into rows. */
type SectionPlan = {
  key: string;
  header: string;
  columns: number;
  basisMm: number;
  rowPitch: number;
  cells: ReactNode[];
};

/** A section's slice of one page (consecutive runs are merged). */
type PageBlock = { plan: SectionPlan; fromRow: number; toRow: number };

/** One physical sheet — memoized so the progressive mount stays cheap. */
const PrintPage = memo(function PrintPage({
  blocks,
  active,
  dims,
  margin,
}: {
  blocks: PageBlock[];
  active: boolean;
  dims: { w: number; h: number };
  margin: number;
}) {
  return (
    <div
      className="print-page print-page--fixed"
      style={{
        display: active ? undefined : "none",
        width: mm(dims.w),
        height: mm(dims.h),
        padding: mm(margin),
        boxSizing: "border-box",
        position: "relative",
        background: "#fff",
      }}
    >
      {blocks.map((b, bi) => (
        <section key={b.plan.key} style={bi > 0 ? { marginTop: mm(SECTION_GAP_MM) } : undefined}>
          <h2
            className="font-semibold uppercase tracking-widest text-neutral-500"
            style={{ fontSize: mm(2.6), marginBottom: mm(2) }}
          >
            {b.plan.header}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${b.plan.columns}, calc(${b.plan.basisMm} * var(--mm, 1px)))`,
              gap: `calc(${LABEL_GAP_MM} * var(--mm, 1px))`,
            }}
          >
            {b.plan.cells.slice(b.fromRow * b.plan.columns, (b.toRow + 1) * b.plan.columns)}
          </div>
        </section>
      ))}
    </div>
  );
});

export default function Labels() {
  const data = useQuery(api.labels.getLabelData, {});
  const [section, setSection] = useState<SectionKey>("all");
  // Interactive updates stay interruptible: the old sheet keeps the UI alive
  // while the new one renders in the background (no frozen window).
  const [isPending, startTransition] = useTransition();

  // per-section label size in mm — units (the many small tags) default smaller
  const [sizes, setSizes] = useState<SectionSizes>(DEFAULT_SIZES);

  // sheet setup
  const [paper, setPaper] = useState("a4");
  const [orientation, setOrientation] = useState("portrait");
  const [margin, setMargin] = useState(8);
  const [showGrid, setShowGrid] = useState(false);

  // preview pager + progressive page mounting (loading until all sheets ready)
  const [page, setPage] = useState(0);
  const [mounted, setMounted] = useState(1);

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
    // Shared sheet print CSS: oriented @page with zero margin (each page
    // carries its own), app-shell removed from the flow, true mm scale.
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

  // Cutting grid: dashed cut lines drawn inside each label cell.
  const gridOverlay = showGrid
    ? { boxShadow: "0 0 0 1px #d4d4d4, inset 0 0 0 0.5px #a3a3a3" }
    : undefined;

  const dims = useMemo(
    () => orientedSize(PAPERS[paper], orientation as Orientation),
    [paper, orientation],
  );

  const sizeControl = (key: Exclude<SectionKey, "all">, label: string) => (
    <div className="grid gap-1" key={key}>
      <Label className="text-[11px] text-muted-foreground">{label} (mm)</Label>
      <Select
        value={String(sizes[key])}
        onValueChange={(v) => startTransition(() => setSizes((s) => ({ ...s, [key]: Number(v) })))}
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

  // “How many labels fit one sheet?” hint for the selected section.
  const fitHint =
    section !== "all"
      ? fitOnSheet(sizes[section], {
          paperWidthMm: dims.w,
          paperHeightMm: dims.h,
          marginMm: margin,
        })
      : null;

  // ---- build sections → rows → explicit sheet pages (memoized) ------------
  const plans: SectionPlan[] = useMemo(() => {
    if (!data) return [];
    const out: SectionPlan[] = [];
    const planFor = (
      key: Exclude<SectionKey, "all">,
      header: string,
      build: (push: (node: ReactNode) => void) => void,
    ) => {
      if (!show(key)) return;
      const { basisMm, columns } = computeColumns(key, sizes, {
        paperWidthMm: dims.w,
        marginMm: margin,
      });
      const cells: ReactNode[] = [];
      build((node) => cells.push(node));
      if (cells.length === 0) return;
      out.push({
        key,
        header,
        columns,
        basisMm,
        rowPitch: labelHeightMm(sizes[key]) + LABEL_GAP_MM,
        cells,
      });
    };

    const cell = (
      key: string,
      wMm: number,
      hMm: number,
      qrValue: string,
      title: string,
      sub?: string,
      sizeMm?: number,
    ) => (
      <div key={key} style={gridOverlay} className="print-cell">
        <ScaledCell wMm={wMm} hMm={hMm}>
          <MmLabel value={qrValue} title={title} sub={sub} sizeMm={sizeMm ?? 0} show={fields} />
        </ScaledCell>
      </div>
    );

    planFor("closets", "Storages", (push) =>
      data.closets.forEach((c) =>
        push(
          cell(
            c._id,
            labelWidthMm(sizes.closets),
            labelHeightMm(sizes.closets),
            closetQr(c._id),
            c.name,
            c.location ?? undefined,
            sizes.closets,
          ),
        ),
      ),
    );
    planFor("categories", "Categories", (push) =>
      data.categories.forEach((c) =>
        push(
          cell(
            c._id,
            labelWidthMm(sizes.categories),
            labelHeightMm(sizes.categories),
            categoryQr(c.name),
            c.name,
            undefined,
            sizes.categories,
          ),
        ),
      ),
    );
    planFor("projects", "Projects", (push) =>
      data.projects.forEach((p) =>
        push(
          cell(
            p._id,
            labelWidthMm(sizes.projects),
            labelHeightMm(sizes.projects),
            projectQr(p._id),
            p.name,
            undefined,
            sizes.projects,
          ),
        ),
      ),
    );
    planFor("groups", "Groups", (push) =>
      data.groups.forEach(({ group, closetAlias }) =>
        push(
          cell(
            group._id,
            labelWidthMm(sizes.groups),
            labelHeightMm(sizes.groups),
            closetAlias ? closetQr(closetAlias._id) : groupQr(group._id),
            group.name,
            closetAlias ? `→ storage: ${closetAlias.name}` : undefined,
            sizes.groups,
          ),
        ),
      ),
    );
    planFor("units", "Individual units", (push) =>
      data.groups.flatMap(({ group, parts }) =>
        parts.forEach((p) =>
          push(
            cell(
              p._id,
              labelWidthMm(sizes.units),
              labelHeightMm(sizes.units),
              unitQr(p.tag),
              p.tag,
              group.name,
              sizes.units,
            ),
          ),
        ),
      ),
    );
    planFor("people", "People", (push) =>
      data.people.forEach((p: any) =>
        push(
          cell(
            p._id,
            labelWidthMm(sizes.people),
            labelHeightMm(sizes.people),
            personQr(p._id),
            p.name,
            p.sub || undefined,
            sizes.people,
          ),
        ),
      ),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, section, sizes, fields, showGrid, dims, margin]);

  const { pageBlocks, totalPages } = useMemo(() => {
    const usableH = dims.h - margin * 2 - PACK_SAFETY_MM;
    const runs: RowRun[][] = paginateRowRuns(
      plans.map((p) => ({
        id: p.key,
        rows: Math.ceil(p.cells.length / p.columns),
        rowPitch: p.rowPitch,
        headerH: SECTION_HEADER_MM,
      })),
      usableH,
      { sectionGapMm: SECTION_GAP_MM },
    );
    const byKey = new Map(plans.map((p) => [p.key, p]));
    const blocks: PageBlock[][] = runs.map((pageRuns) => {
      const out: PageBlock[] = [];
      for (const run of pageRuns) {
        const plan = byKey.get(run.sectionId)!;
        const last = out[out.length - 1];
        if (last && last.plan.key === run.sectionId) {
          last.toRow = run.fromRow + run.rowCount - 1;
        } else {
          out.push({ plan, fromRow: run.fromRow, toRow: run.fromRow + run.rowCount - 1 });
        }
      }
      return out;
    });
    return { pageBlocks: blocks, totalPages: blocks.length };
  }, [plans, dims, margin]);

  // Progressive mount: one more sheet per frame so a hundreds-of-QRs sheet
  // never freezes the window; the header shows the preparation progress.
  useEffect(() => {
    setMounted(1);
    if (totalPages <= 1) return;
    let n = 1;
    let raf = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      n += 1;
      setMounted(Math.min(n, totalPages));
      if (n < totalPages) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [totalPages]);
  const preparing = mounted < totalPages;
  const activePage = Math.min(page, Math.max(0, totalPages - 1));

  const doPrint = () => {
    if (preparing || totalPages === 0) return;
    // Let the final frame paint before the (blocking) print dialog opens.
    setTimeout(() => window.print(), 50);
  };

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
          <div className="flex flex-wrap gap-2">
            <Button
              variant={showGrid ? "default" : "outline"}
              onClick={() => startTransition(() => setShowGrid((g) => !g))}
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
            <Button onClick={doPrint} disabled={!data || preparing || totalPages === 0}>
              {preparing ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              {preparing ? `Preparing ${mounted}/${totalPages}…` : "Print sheet"}
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
                style={section === key ? activeTabStyle(SECTION_COLORS[key]) : undefined}
                onClick={() => startTransition(() => setSection(key))}
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
                <Select value={paper} onValueChange={(v) => startTransition(() => setPaper(v))}>
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
                <Select
                  value={orientation}
                  onValueChange={(v) => startTransition(() => setOrientation(v))}
                >
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
                  onChange={(e) =>
                    startTransition(() =>
                      setMargin(Math.max(0, Math.min(30, Number(e.target.value) || 0))),
                    )
                  }
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
          {(isPending || preparing) && (
            <p className="flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
              <LoadingGifInline size={16} className="size-4" />
              {preparing
                ? `Preparing sheet ${mounted} of ${totalPages}… printing unlocks when every page is ready.`
                : "Updating the sheet…"}
            </p>
          )}
        </div>

        {data === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <LoadingGifInline size={18} className="mr-2 inline size-4" /> Loading labels…
          </p>
        ) : totalPages === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nothing to print for this section yet.
          </p>
        ) : (
          <PaperPreview
            pageMm={PAPERS[paper]}
            orientation={orientation as Orientation}
            marginMm={margin}
            className="print-area-wrapper"
            header={
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {PAPERS[paper].label} · {plans.reduce((n, p) => n + p.cells.length, 0)} labels ·{" "}
                  {totalPages} sheet{totalPages === 1 ? "" : "s"} · real scale
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={activePage === 0}
                      onClick={() => setPage(activePage - 1)}
                      title="Previous sheet"
                    >
                      <ChevronLeft className="size-4" /> Prev
                    </Button>
                    <span className="px-1 text-xs tabular-nums text-muted-foreground">
                      {activePage + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={activePage >= totalPages - 1}
                      onClick={() => setPage(activePage + 1)}
                      title="Next sheet"
                    >
                      Next <ChevronRight className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            }
          >
            <div id="print-area" className="absolute inset-0">
              {pageBlocks.map((blocks, i) => (
                <PrintPage
                  key={i}
                  blocks={blocks}
                  active={i === activePage}
                  dims={dims}
                  margin={margin}
                />
              ))}
            </div>
          </PaperPreview>
        )}
      </div>
    </AppShell>
  );
}
