import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
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
import { toast } from "sonner";
import { Download, FileDown, Grid2x2, Loader2, Printer } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { ageFromIso } from "@/lib/utils";

/**
 * Export studio — pick a dataset, filter it, see the exact sheet you'll get
 * in the live preview, then print (paper/margin/scale controls, A4 mapping)
 * or download as CSV for Excel/Google Sheets.
 */

type Dataset = "inventory" | "rentals" | "people" | "projects";

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
        { key: "group", label: "Component", get: (r) => r.group?.name ?? "" },
        { key: "category", label: "Category", get: (r) => r.category?.name ?? "" },
        { key: "closet", label: "Storage", get: (r) => r.closet?.name ?? "" },
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
        { key: "student", label: "Student", get: (r) => r.student?.name ?? "(removed)" },
        { key: "email", label: "Email", get: (r) => r.student?.email ?? "" },
        { key: "studentId", label: "Student ID", get: (r) => r.student?.studentId ?? "" },
        { key: "part", label: "Part tag", get: (r) => r.part?.tag ?? "" },
        { key: "group", label: "Component", get: (r) => r.group?.name ?? "" },
        { key: "status", label: "Status", get: (r) => r.rental?.status ?? "" },
        { key: "project", label: "Project", get: (r) => r.project?.name ?? "" },
        { key: "requested", label: "Requested", get: (r) => date(r.rental?.requestedAt) },
        { key: "returned", label: "Returned", get: (r) => date(r.rental?.returnedAt) },
        { key: "condition", label: "Condition note", get: (r) => r.rental?.conditionReport ?? "" },
      ];
    if (dataset === "people")
      return [
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
    return [
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

export default function ExportStudio() {
  const [dataset, setDataset] = useState<Dataset>("inventory");
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

  const cols = useColumns(dataset);
  const categories = useQuery(api.catalog.listCategories, {});
  const closets = useQuery(api.catalog.listClosets, {});
  const inventory = useQuery(api.exportData.inventory, {});
  const rentals = useQuery(api.exportData.rentals, {});
  const people = useQuery(api.exportData.people, {});
  const projects = useQuery(api.exportData.projects, {});

  const raw = useMemo(() => {
    if (dataset === "inventory") return inventory;
    if (dataset === "rentals") return rentals;
    if (dataset === "people") return people;
    return projects;
  }, [dataset, inventory, rentals, people, projects]);

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
  ];

  const showInventoryFilters = dataset === "inventory";
  const showStatus = dataset === "rentals" || dataset === "projects" || dataset === "people";
  const statusOptions =
    dataset === "rentals"
      ? [["all", "All statuses"], ["pending", "Pending"], ["active", "Active"], ["on_project", "On project"], ["returned", "Returned"], ["denied", "Denied"], ["canceled", "Canceled"]]
      : dataset === "projects"
        ? [["all", "All statuses"], ["active", "Active"], ["completed", "Completed"], ["dismantled", "Dismantled"]]
        : [["all", "Everyone"], ["admins", "Admins only"], ["members", "Members only"], ["active", "Active members"], ["ex", "Ex-members"]];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Export studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Filter any dataset, preview the sheet live, then print with full control or download CSV.
            </p>
          </div>
          <div className="flex gap-2">
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
              <Printer className="size-4" /> Print / save as PDF
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
            <p className="ml-auto max-w-64 text-[11px] leading-snug text-muted-foreground">
              The preview mirrors the printed sheet — pick “Save as PDF” in the browser print dialog
              to get a PDF with exactly this layout.
            </p>
          </div>
        </div>

        {/* Live print preview */}
        {raw === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading data…
          </p>
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
