import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  Download,
  FileDown,
  Grid2x2,
  IdCard,
  Loader2,
  Printer,
  Table2,
} from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { ageFromIso } from "@/lib/utils";
import { closetQr, groupQr, projectQr, qrUrl, unitQr } from "@/lib/qr";

/**
 * Export studio — pick a dataset, filter it, see the exact sheet you'll get
 * in the live preview, then print (paper/margin/scale controls, A4 mapping)
 * or download as CSV for Excel/Google Sheets.
 *
 * Two print modes:
 *  - Table: the classic data sheet (now with an ID column per dataset).
 *  - Cards: postcard-sticker cards, one per item — image on the left, QR on
 *    the right, name + brand/model underneath (closets/projects show their
 *    description). Card width/height are controllable in mm.
 */

type Dataset = "inventory" | "rentals" | "people" | "projects" | "storages" | "units";
type Mode = "table" | "cards";
// Datasets that map to one printed card per row (image + QR + info).
const CARD_DATASETS: Dataset[] = ["inventory", "units", "storages", "projects"];

const PAPERS: Record<string, { label: string; w: number; h: number }> = {
  a4: { label: "A4 (210 × 297 mm)", w: 210, h: 297 },
  a3: { label: "A3 (297 × 420 mm)", w: 297, h: 420 },
  letter: { label: "US Letter (216 × 279 mm)", w: 216, h: 279 },
  legal: { label: "US Legal (216 × 356 mm)", w: 216, h: 356 },
};

type Col = { key: string; label: string; get: (r: any) => string };

const date = (n?: number) => (n ? new Date(n).toLocaleDateString() : "");

function useColumns(dataset: Dataset): Col[] {
  return useMemo(() => {
    if (dataset === "inventory")
      return [
        { key: "id", label: "ID", get: (r) => r.group?._id ?? "" },
        { key: "group", label: "Component", get: (r) => r.group?.name ?? "" },
        { key: "category", label: "Category", get: (r) => r.category?.name ?? "" },
        { key: "closet", label: "Storage", get: (r) => r.closet?.name ?? "" },
        { key: "container", label: "Container", get: (r) => r.parent?.name ?? "" },
        { key: "brand", label: "Brand", get: (r) => r.group.brand ?? "" },
        { key: "model", label: "Model", get: (r) => r.group.model ?? "" },
        { key: "total", label: "Total", get: (r) => String(r.s?.total ?? 0) },
        { key: "available", label: "Available", get: (r) => String(r.s?.available ?? 0) },
        { key: "rented", label: "Rented", get: (r) => String(r.s?.rented ?? 0) },
        { key: "onProject", label: "On projects", get: (r) => String(r.s?.onProject ?? 0) },
        { key: "broken", label: "Broken", get: (r) => String(r.s?.broken ?? 0) },
        { key: "pending", label: "Pending", get: (r) => String(r.s?.pending ?? 0) },
      ];
    if (dataset === "rentals")
      return [
        { key: "id", label: "ID", get: (r) => r.rental?._id ?? "" },
        { key: "partId", label: "Unit ID", get: (r) => r.part?._id ?? "" },
        { key: "student", label: "Student", get: (r) => r.student?.name ?? "(removed)" },
        { key: "email", label: "Email", get: (r) => r.student?.email ?? "" },
        { key: "studentId", label: "Student ID", get: (r) => r.student?.studentId ?? "" },
        { key: "part", label: "Part tag", get: (r) => r.part?.tag ?? "" },
        { key: "group", label: "Component", get: (r) => r.group?.name ?? "" },
        { key: "container", label: "Container", get: (r) => r.parent?.name ?? "" },
        { key: "status", label: "Status", get: (r) => r.rental?.status ?? "" },
        { key: "project", label: "Project", get: (r) => r.project?.name ?? "" },
        {
          key: "destination",
          label: "Return destination",
          get: (r) =>
            r.rental?.returnDestination === "transferred"
              ? `Transferred to ${r.rental?.transferToName ?? "—"}`
              : r.rental?.returnDestination === "project"
                ? "Project"
                : r.rental?.returnDestination === "shelf"
                  ? "Shelf"
                  : "",
        },
        {
          key: "recovered",
          label: "Recovered amount",
          get: (r) => (r.rental?.recoveredAmount !== undefined ? String(r.rental.recoveredAmount) : ""),
        },
        { key: "requested", label: "Requested", get: (r) => date(r.rental?.requestedAt) },
        { key: "returned", label: "Returned", get: (r) => date(r.rental?.returnedAt) },
        { key: "condition", label: "Condition note", get: (r) => r.rental?.conditionReport ?? "" },
      ];
    if (dataset === "people")
      return [
        { key: "id", label: "ID", get: (r) => r.user?._id ?? "" },
        { key: "code", label: "Club code", get: (r) => r.user.studentCode ?? "" },
        { key: "name", label: "Name", get: (r) => r.user.name ?? "" },
        { key: "email", label: "Email", get: (r) => r.user.email ?? "" },
        { key: "studentId", label: "University ID", get: (r) => r.user.studentId ?? "" },
        { key: "phone", label: "Phone", get: (r) => r.user.phone ?? "" },
        { key: "roles", label: "Positions", get: (r) => (r.user.clubRoles ?? []).join(" / ") },
        { key: "academic", label: "Academic state", get: (r) => r.user.academicState ?? "" },
        { key: "major", label: "Major", get: (r) => r.user.major ?? "" },
        { key: "dob", label: "Date of birth", get: (r) => r.user?.dateOfBirth ?? "" },
        { key: "age", label: "Age", get: (r) => (ageFromIso(r.user?.dateOfBirth) ?? "").toString() },
        { key: "github", label: "GitHub", get: (r) => r.user?.githubUrl ?? "" },
        { key: "access", label: "Access", get: (r) => (r.user?.role === "admin" ? "Admin" : "Member") },
        { key: "membership", label: "Membership", get: (r) => (r.user?.membershipStatus === "ex" ? "Ex-member" : "Active") },
        { key: "activeRentals", label: "Active rentals", get: (r) => String(r.activeRentals ?? 0) },
      ];
    if (dataset === "storages")
      return [
        { key: "id", label: "ID", get: (r) => r.closet?._id ?? "" },
        { key: "name", label: "Storage", get: (r) => r.closet?.name ?? "" },
        { key: "location", label: "Location", get: (r) => r.closet?.location ?? "" },
        { key: "note", label: "Note", get: (r) => r.closet?.note ?? "" },
      ];
    if (dataset === "units")
      return [
        { key: "id", label: "ID", get: (r) => r.part?._id ?? "" },
        { key: "tag", label: "Tag", get: (r) => r.part?.tag ?? "" },
        { key: "group", label: "Component", get: (r) => r.group?.name ?? "" },
        { key: "container", label: "Container", get: (r) => r.parent?.name ?? "" },
        { key: "storage", label: "Storage", get: (r) => r.closet?.name ?? "" },
        { key: "status", label: "Status", get: (r) => r.part?.status ?? "" },
      ];
    return [
      { key: "id", label: "ID", get: (r) => r.project?._id ?? "" },
      { key: "name", label: "Project", get: (r) => r.project?.name ?? "" },
      { key: "status", label: "Status", get: (r) => r.project?.status ?? "" },
      { key: "description", label: "Description", get: (r) => r.project?.description ?? "" },
      { key: "owner", label: "Owner", get: (r) => r.owner?.name ?? "" },
      { key: "parts", label: "Parts assigned", get: (r) => String(r.partCount) },
    ];
  }, [dataset]);
}

function toCsv(cols: Col[], rows: any[]) {
  const head = cols.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(",");
  const body = rows
    .map((r) => cols.map((c) => `"${c.get(r).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return `\uFEFF${head}\n${body}`; // BOM so Excel opens Arabic correctly
}

// CSS px per mm at 96dpi — card/QR boxes sized in mm print at real size.
const MM = 96 / 25.4;

/**
 * One printed postcard-sticker, clipped to the exact width × height box:
 *  - LEFT: the item image, object-contain so the whole photo stays inside.
 *  - RIGHT: the QR code on top, with the basic info (name, brand/model —
 *    plus the container name for groups inside a container) stacked
 *    UNDERNEATH the QR.
 * Nothing may overflow the card: the root is overflow-hidden and the two
 * columns are height-constrained to the card's inner box.
 */
function PrintCard({
  image,
  qrPayload,
  title,
  sub,
  container,
  widthMm,
  heightMm,
}: {
  image?: string;
  qrPayload: string;
  title: string;
  sub?: string;
  /** Name of the container group this item lives inside (optional line). */
  container?: string;
  widthMm: number;
  heightMm: number;
}) {
  const pad = 2; // mm
  const gap = 2; // mm between the image and the QR column
  // Image keeps the full inner height on the left; the right column is a
  // flex column: QR square (capped to the width share) + info lines under it.
  const innerH = Math.max(8, heightMm - pad * 2);
  const innerW = Math.max(20, widthMm - pad * 2);
  // The QR never takes more than 45% of the card width so the photo keeps
  // room, and never more than ~70% of the inner height (info needs the rest).
  const qrMm = Math.min(innerH * 0.7, innerW * 0.45);
  const qrPx = Math.max(12, Math.round(qrMm * MM));
  const imgW = Math.max(8, Math.round((innerW - qrMm - gap) * MM));
  const imgH = Math.round(innerH * MM);

  // Info text sizes scale gently with the card so small stickers stay sane.
  const namePx = widthMm >= 70 ? 11 : widthMm >= 45 ? 10 : 8.5;
  const subPx = widthMm >= 70 ? 8.5 : 7.5;

  return (
    <div
      className="print-card flex break-inside-avoid overflow-hidden rounded border border-neutral-300 bg-white text-black"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, padding: `${pad}mm` }}
    >
      {/* LEFT: the item image — object-contain keeps it fully inside the box. */}
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-neutral-50"
        style={{ width: imgW, height: imgH }}
      >
        {image ? (
          <img src={image} alt={title} className="h-full w-full object-contain" />
        ) : (
          <span className="text-[8px] uppercase tracking-widest text-neutral-400">no photo</span>
        )}
      </div>
      {/* RIGHT: QR on top, info underneath it — all inside a fixed column. */}
      <div
        className="flex min-w-0 flex-1 flex-col items-center justify-start"
        style={{ marginLeft: `${gap}mm`, maxHeight: imgH }}
      >
        <div style={{ width: qrPx, height: qrPx }} className="shrink-0">
          <QRCode value={qrUrl(qrPayload)} size={qrPx} style={{ width: "100%", height: "100%" }} />
        </div>
        <div className="mt-[1mm] w-full min-w-0 overflow-hidden text-center leading-tight">
          <p className="truncate font-semibold" style={{ fontSize: `${namePx}px` }}>
            {title}
          </p>
          {sub && (
            <p className="truncate text-neutral-600" style={{ fontSize: `${subPx}px` }}>
              {sub}
            </p>
          )}
          {container && (
            <p className="truncate text-neutral-600" style={{ fontSize: `${subPx}px` }}>
              📦 {container}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ExportStudio() {
  const [dataset, setDataset] = useState<Dataset>("inventory");
  const [mode, setMode] = useState<Mode>("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [closetId, setClosetId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");

  // print controls
  const [paper, setPaper] = useState("a4");
  const [orientation, setOrientation] = useState("landscape");
  const [margin, setMargin] = useState(10); // mm
  const [scale, setScale] = useState(100); // percent
  const [showGrid, setShowGrid] = useState(true);
  // Printed-card controls (mm)
  const [cardW, setCardW] = useState(60);
  const [cardH, setCardH] = useState(40);
  // Which table columns the admin wants printed/exported, in which order
  // (per dataset): hidden = excluded, order = first-to-last column order.
  const [hiddenCols, setHiddenCols] = useState<Record<string, Set<string>>>({});
  const [colOrder, setColOrder] = useState<Record<string, string[]>>({});

  const allCols = useColumns(dataset);
  const hidden = useMemo(
    () => hiddenCols[dataset] ?? new Set<string>(),
    [hiddenCols, dataset],
  );
  // Applied order: any keys missing from the saved order (new columns) go to
  // the end, in their natural definition order.
  const orderedCols = useMemo(() => {
    const order = colOrder[dataset];
    if (!order) return allCols;
    const known = order
      .map((k) => allCols.find((c) => c.key === k))
      .filter((c): c is Col => Boolean(c));
    const rest = allCols.filter((c) => !order.includes(c.key));
    return [...known, ...rest];
  }, [allCols, colOrder, dataset]);
  const cols = useMemo(
    () => orderedCols.filter((c) => !hidden.has(c.key)),
    [orderedCols, hidden],
  );
  const moveCol = (key: string, dir: -1 | 1) => {
    setColOrder((prev) => {
      const current = prev[dataset] ?? allCols.map((c) => c.key);
      const idx = current.indexOf(key);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= current.length) return prev;
      const next = [...current];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, [dataset]: next };
    });
  };
  const toggleCol = (key: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev[dataset] ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [dataset]: next };
    });
  };
  const restoreCols = () => setHiddenCols((prev) => ({ ...prev, [dataset]: new Set() }));
  const categories = useQuery(api.catalog.listCategories, {});
  const closets = useQuery(api.catalog.listClosets, {});
  const inventory = useQuery(api.exportData.inventory, {});
  const rentals = useQuery(api.exportData.rentals, {});
  const people = useQuery(api.exportData.people, {});
  const projects = useQuery(api.exportData.projects, {});
  const storagesQ = useQuery(api.exportData.storages, {});
  const unitsQ = useQuery(api.exportData.units, {});

  const raw = useMemo(() => {
    if (dataset === "inventory") return inventory;
    if (dataset === "rentals") return rentals;
    if (dataset === "people") return people;
    if (dataset === "storages") return storagesQ?.map((closet: any) => ({ closet }));
    if (dataset === "units") return unitsQ;
    return projects;
  }, [dataset, inventory, rentals, people, projects, storagesQ, unitsQ]);

  const rows = useMemo(() => {
    let list = (raw ?? []) as any[];
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter((r) =>
        cols.some((c) => c.get(r).toLowerCase().includes(s)),
      );
    }
    if (dataset === "inventory") {
      if (closetId !== "all") list = list.filter((r) => r.closet?._id === closetId);
      if (categoryId !== "all") list = list.filter((r) => r.category?._id === categoryId);
    }
    if (dataset === "rentals" && statusFilter !== "all") {
      list = list.filter((r) => r.rental?.status === statusFilter);
    }
    if (dataset === "units" && statusFilter !== "all") {
      list = list.filter((r) => r.part?.status === statusFilter);
    }
    if (dataset === "projects" && statusFilter !== "all") {
      list = list.filter((r) => r.project?.status === statusFilter);
    }
    if (dataset === "people" && statusFilter !== "all") {
      if (statusFilter === "admins") list = list.filter((r) => r.user?.role === "admin");
      else if (statusFilter === "members") list = list.filter((r) => r.user?.role !== "admin");
      else if (statusFilter === "active") list = list.filter((r) => r.user?.membershipStatus !== "ex");
      else if (statusFilter === "ex") list = list.filter((r) => r.user?.membershipStatus === "ex");
    }
    return list;
  }, [raw, search, cols, dataset, closetId, categoryId, statusFilter]);

  const csv = useMemo(() => (rows ? toCsv(cols, rows) : ""), [rows, cols]);

  useEffect(() => {
    // Keep the printed sheet in sync with the chosen paper/margin/scale.
    const p = PAPERS[paper];
    const style = document.createElement("style");
    style.id = "export-print-style";
    style.textContent = `
      @media print {
        @page { size: ${p.w}mm ${p.h}mm ${orientation === "portrait" ? "" : orientation === "landscape" ? "landscape" : orientation}; margin: ${margin}mm; }
        #print-area { zoom: ${scale / 100}; }
      }
    `;
    const old = document.getElementById("export-print-style");
    if (old) old.remove();
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper, orientation, margin, scale]);

  const download = () => {
    downloadCsv(`${dataset}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success("CSV downloaded");
  };

  const datasets: [Dataset, string][] = [
    ["inventory", "Inventory"],
    ["rentals", "Rental history"],
    ["people", "People"],
    ["projects", "Projects"],
    ["storages", "Storages"],
    ["units", "Units"],
  ];

  const showInventoryFilters = dataset === "inventory";
  const showStatus =
    dataset === "rentals" || dataset === "projects" || dataset === "people" || dataset === "units";
  const statusOptions =
    dataset === "rentals"
      ? [["all", "All statuses"], ["pending", "Pending"], ["active", "Active"], ["on_project", "On project"], ["returned", "Returned"], ["denied", "Denied"], ["canceled", "Canceled"]]
      : dataset === "projects"
        ? [["all", "All statuses"], ["active", "Active"], ["completed", "Completed"], ["dismantled", "Dismantled"]]
        : dataset === "units"
          ? [["all", "All statuses"], ["available", "Available"], ["rented", "Rented"], ["on_project", "On project"], ["broken", "Broken"], ["pending", "Pending"], ["transferred", "Transferred"], ["consumed", "Consumed"]]
          : [["all", "Everyone"], ["admins", "Admins only"], ["members", "Members only"], ["active", "Active members"], ["ex", "Ex-members"]];

  const cardsAvailable = CARD_DATASETS.includes(dataset);
  const activeMode: Mode = cardsAvailable ? mode : "table";

  /** Build the per-row card payload (image, QR, title, sub, container) per dataset. */
  const cardFor = (r: any) => {
    if (dataset === "inventory")
      return {
        image: r.group?.imageUrl,
        qr: groupQr(r.group?._id ?? ""),
        title: r.group?.name ?? "",
        sub: [r.group?.brand, r.group?.model].filter(Boolean).join(" · ") || r.group?.description || "",
        container: r.parent?.name,
      };
    if (dataset === "units")
      return {
        image: r.part?.imageUrl || r.group?.imageUrl,
        qr: unitQr(r.part?.tag ?? ""),
        title: r.part?.tag ?? "",
        sub: r.group?.name ?? "",
        container: r.parent?.name,
      };
    if (dataset === "storages")
      return {
        image: r.closet?.imageUrl,
        qr: closetQr(r.closet?._id ?? ""),
        title: r.closet?.name ?? "",
        sub: r.closet?.location || r.closet?.note || "",
      };
    return {
      image: r.project?.imageUrl,
      qr: projectQr(r.project?._id ?? ""),
      title: r.project?.name ?? "",
      sub: r.project?.description ?? "",
    };
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Export studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Filter any dataset, preview the sheet live, then print with full control, print item
              cards, or download CSV.
            </p>
          </div>
          <div className="flex gap-2">
            {/* Columns settings — pick exactly which columns print/export. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" title="Choose which columns to show">
                  <Columns3 className="size-4" /> Columns
                  {hidden.size > 0 && (
                    <span className="ml-1 rounded bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                      {allCols.length - hidden.size}/{allCols.length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-xs font-semibold">Columns to show</p>
                  <p className="text-[11px] text-muted-foreground">
                    Tick to include, use the arrows to set the print order.
                  </p>
                </div>
                {orderedCols.map((c, i) => (
                  <div
                    key={c.key}
                    className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/60"
                  >
                    <DropdownMenuCheckboxItem
                      checked={!hidden.has(c.key)}
                      onCheckedChange={() => toggleCol(c.key)}
                      onSelect={(e) => e.preventDefault()}
                      className="flex-1"
                    >
                      {c.label}
                    </DropdownMenuCheckboxItem>
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        aria-label={`Move ${c.label} up`}
                        disabled={i === 0}
                        onClick={() => moveCol(c.key, -1)}
                        className="flex h-4 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${c.label} down`}
                        disabled={i === orderedCols.length - 1}
                        onClick={() => moveCol(c.key, 1)}
                        className="flex h-4 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-1 border-t p-1">
                  <Button variant="ghost" size="sm" className="w-full" onClick={restoreCols}>
                    Show all columns
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setColOrder((prev) => ({ ...prev, [dataset]: allCols.map((c) => c.key) }))
                    }
                  >
                    Reset order
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant={showGrid ? "default" : "outline"}
              onClick={() => setShowGrid((g) => !g)}
              title="Toggle the printed table borders"
            >
              <Grid2x2 className="size-4" /> Grid
            </Button>
            <Button variant="outline" onClick={download} disabled={!rows?.length}>
              <FileDown className="size-4" /> Download CSV
            </Button>
            <Button onClick={() => window.print()} disabled={!rows?.length}>
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </header>

        {/* Controls (never printed) */}
        <div className="no-print flex flex-col gap-4 rounded-lg border bg-card/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Dataset</span>
            {datasets.map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={dataset === key ? "default" : "outline"}
                onClick={() => {
                  setDataset(key);
                  setStatusFilter("all");
                }}
              >
                {label}
              </Button>
            ))}
          </div>

          {cardsAvailable && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Output</span>
              <Button
                size="sm"
                variant={activeMode === "table" ? "default" : "outline"}
                onClick={() => setMode("table")}
              >
                <Table2 className="size-4" /> Table sheet
              </Button>
              <Button
                size="sm"
                variant={activeMode === "cards" ? "default" : "outline"}
                onClick={() => setMode("cards")}
              >
                <IdCard className="size-4" /> Printed cards
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search across every column…"
              />
            </div>
            {showInventoryFilters && (
              <>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={closetId} onValueChange={setClosetId}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Storage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All storages</SelectItem>
                    {(closets ?? []).map((c) => (
                      <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            {showStatus && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4 border-t pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Download className="size-3.5" /> Print setup
            </p>
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">Paper</Label>
              <Select value={paper} onValueChange={setPaper}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="landscape">Landscape</SelectItem>
                  <SelectItem value="portrait">Portrait</SelectItem>
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
            {activeMode === "table" && (
              <div className="grid gap-1">
                <Label className="text-[11px] text-muted-foreground">Scale {scale}%</Label>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                  className="w-40 accent-[var(--primary)]"
                />
              </div>
            )}
            {activeMode === "cards" && (
              <>
                {/* Width/height steppers: type a value or tap the up/down arrows. */}
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Card width (mm)</Label>
                  <div className="flex items-stretch">
                    <Input
                      type="number"
                      min={30}
                      max={200}
                      step={1}
                      value={cardW}
                      onChange={(e) =>
                        setCardW(Math.max(30, Math.min(200, Number(e.target.value) || 60)))
                      }
                      className="w-16 rounded-r-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Increase width"
                        onClick={() => setCardW((w) => Math.min(200, w + 1))}
                        className="flex h-1/2 items-center justify-center rounded-tr-md border border-l-0 px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Decrease width"
                        onClick={() => setCardW((w) => Math.max(30, w - 1))}
                        className="flex h-1/2 items-center justify-center rounded-br-md border border-l-0 px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-muted-foreground">Card height (mm)</Label>
                  <div className="flex items-stretch">
                    <Input
                      type="number"
                      min={20}
                      max={150}
                      step={1}
                      value={cardH}
                      onChange={(e) =>
                        setCardH(Math.max(20, Math.min(150, Number(e.target.value) || 40)))
                      }
                      className="w-16 rounded-r-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Increase height"
                        onClick={() => setCardH((h) => Math.min(150, h + 1))}
                        className="flex h-1/2 items-center justify-center rounded-tr-md border border-l-0 px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Decrease height"
                        onClick={() => setCardH((h) => Math.max(20, h - 1))}
                        className="flex h-1/2 items-center justify-center rounded-br-md border border-l-0 px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <p className="max-w-64 text-[11px] leading-snug text-muted-foreground">
                  Postcard-sticker cards: item image left, QR right with the name + brand/model
                  (plus the container name) underneath it. Same filters as the sheet.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Live print preview */}
        {raw === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading data…
          </p>
        ) : activeMode === "cards" ? (
          <div
            id="print-area"
            className="w-full overflow-x-auto rounded-lg border bg-white p-4 text-black shadow-sm"
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Robotics Club · item cards · {rows.length} cards · {new Date().toLocaleDateString()}
            </p>
            <div
              className="flex flex-wrap content-start gap-[2mm]"
              style={{
                boxShadow: showGrid ? undefined : "none",
              }}
            >
              {rows.map((r, i) => {
                const c = cardFor(r);
                return (
                  <div key={i} className="print-cell" style={showGrid ? { boxShadow: "0 0 0 0.5px #a3a3a3" } : undefined}>
                    <PrintCard
                      image={c.image}
                      qrPayload={c.qr}
                      title={c.title}
                      sub={c.sub}
                      container={c.container}
                      widthMm={cardW}
                      heightMm={cardH}
                    />
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="px-2 py-6 text-center text-sm text-neutral-500">
                  No rows match the filters.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            id="print-area"
            className="w-full overflow-x-auto rounded-lg border bg-white p-4 text-black shadow-sm md:w-[140%] print:w-full"
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
              Robotics Club · {datasets.find(([k]) => k === dataset)?.[1]} · {rows.length} rows ·{" "}
              {new Date().toLocaleDateString()}
            </p>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className={`bg-neutral-100 px-2 py-1 text-left font-semibold ${
                        showGrid ? "border border-neutral-300" : ""
                      }`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-2 py-1 align-top ${showGrid ? "border border-neutral-200" : ""}`}
                      >
                        {c.get(r) || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length} className="border border-neutral-200 px-2 py-6 text-center text-neutral-500">
                      No rows match the filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
