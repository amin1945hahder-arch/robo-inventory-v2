import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api";
import { downloadCsv } from "@/lib/csv";
import { AppShell } from "@/components/AppShell";
import { LoadingGif, LoadingGifInline } from "@/components/LoadingGif";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Database, Download, Loader2, RefreshCw } from "lucide-react";
import { shelfEventLabel, type ShelfEvent } from "@/lib/turso";

const STATUSES = [
  "all",
  "pending",
  "approved",
  "active",
  "on_project",
  "returned",
  "denied",
  "canceled",
] as const;

const fmt = (t: number) =>
  new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

type HistoryRow = {
  rental: {
    requestedAt: number;
    status: string;
    pickedUpAt?: number;
    returnedAt?: number;
    conditionReport?: string;
  };
  student: { name?: string; email?: string; studentId?: string; phone?: string } | null;
  part: { tag?: string } | null;
  group: { name?: string } | null;
  project: { name?: string } | null;
};

function toCsv(rows: HistoryRow[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [
    "Requested",
    "Status",
    "Student",
    "Email",
    "Student ID",
    "Phone",
    "Part tag",
    "Group",
    "Project",
    "Picked up",
    "Returned",
    "Condition / notes",
  ];
  const lines = rows.map((r) =>
    [
      r.rental.requestedAt ? fmt(r.rental.requestedAt) : "",
      r.rental.status,
      r.student?.name ?? "",
      r.student?.email ?? "",
      r.student?.studentId ?? "",
      r.student?.phone ?? "",
      r.part?.tag ?? "",
      r.group?.name ?? "",
      r.project?.name ?? "",
      r.rental.pickedUpAt ? fmt(r.rental.pickedUpAt) : "",
      r.rental.returnedAt ? fmt(r.rental.returnedAt) : "",
      r.rental.conditionReport ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...lines].join("\n");
}

export default function AdminReports() {
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const history = useQuery(api.reports.history, { status, q: q || undefined });
  const stats = useQuery(api.reports.stats, {});

  const csv = useMemo(
    () => (history ? toCsv(history) : ""),
    [history],
  );

  const download = () => {
    // Shared helper: guarantees the UTF-8 BOM and defers revoking the object
    // URL — a synchronous revoke right after click() truncates the file on
    // Android WebView, which shows up as garbage/Arabic mojibake on open.
    downloadCsv(`rental-history-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const statCards = [
    { label: "Total units", value: stats?.units ?? 0 },
    { label: "Available", value: stats?.available ?? 0 },
    { label: "Out on rent", value: stats?.rented ?? 0 },
    { label: "On projects", value: stats?.onProject ?? 0 },
    { label: "Broken", value: stats?.broken ?? 0 },
    { label: "Active projects", value: stats?.activeProjects ?? 0 },
    { label: "Members", value: stats?.members ?? 0 },
    { label: "All-time loans", value: stats?.totalLoans ?? 0 },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 wide:flex-row wide:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports & history</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything that has ever been requested, rented and returned — filter it, chart it,
              export it.
            </p>
          </div>
          <Button variant="outline" onClick={download} disabled={!history?.length}>
            <Download className="size-4" /> Export CSV
          </Button>
        </header>

        {/* stat cards */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map(({ label, value }) => (
            <Card key={label} className="border-border/80 shadow-none">
              <CardContent className="p-4">
                <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* most-rented groups */}
        <section className="glass-3d rounded-lg border p-5">
          <h2 className="text-sm font-semibold">Most-rented groups</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Total rental events per component type (all time).
          </p>
          {!stats ? (
            <LoadingGif size={48} label={null} />
          ) : stats.topGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No rental history yet.</p>
          ) : (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topGroups} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "rgba(148,163,184,0.9)", fontSize: 11 }}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={64}
                  />
                  <YAxis tick={{ fill: "rgba(148,163,184,0.9)", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(148,163,184,0.08)" }}
                    contentStyle={{
                      background: "#0b1020",
                      border: "1px solid rgba(148,163,184,0.25)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* history */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search student, part, group, project…"
              className="max-w-xs"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All statuses" : s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">
              {history?.length ?? "…"} record{history?.length === 1 ? "" : "s"}
            </span>
          </div>

          {history === undefined ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              <LoadingGifInline size={18} className="mr-2 inline size-4" /> Loading history…
            </p>
          ) : history.length === 0 ? (
            <p className="rounded-lg border border-dashed px-6 py-14 text-center text-sm text-muted-foreground">
              No records match — try clearing the filters.
            </p>
          ) : (
            <div className="overflow-x-auto glass-3d rounded-lg border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Student</th>
                    <th className="px-4 py-2.5 font-medium">Part</th>
                    <th className="px-4 py-2.5 font-medium">Group</th>
                    <th className="px-4 py-2.5 font-medium">Project</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((r) => (
                    <tr key={r.rental._id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                        {fmt(r.rental.requestedAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{r.student?.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.student?.email ?? ""}</p>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{r.part?.tag ?? "—"}</td>
                      <td className="px-4 py-2.5">{r.group?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs">{r.project?.name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={r.rental.status} />
                      </td>
                      <td className="max-w-48 truncate px-4 py-2.5 text-xs text-muted-foreground">
                        {r.rental.conditionReport ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <EdgeLedgerCard />
      </div>
    </AppShell>
  );
}

/**
 * Edge ledger — the append-only shelf_events table kept in Turso (edge SQLite)
 * next to Convex. Every rental decision is mirrored there by a scheduled node
 * action, so this trail survives a Convex reset and can be read from anywhere.
 * Renders as "not connected" (with the exact missing key) until the two
 * Turso environment variables are present.
 */
function EdgeLedgerCard() {
  const ledger = useAction(api.turso.ledger);
  const append = useAction(api.turso.appendEvent);
  const [data, setData] = useState<Awaited<ReturnType<typeof ledger>> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await ledger({ limit: 25 }));
    } catch (e) {
      setData({
        configured: false,
        problem: e instanceof Error ? e.message : String(e),
        database: null,
        events: [],
        summary: { total: 0, byKind: [], uniqueParts: 0, uniqueMembers: 0, lastAt: null, firstAt: null },
      });
    }
  }, [ledger]);

  useEffect(() => {
    void load();
  }, [load]);

  const logTest = async () => {
    setBusy(true);
    try {
      await append({ kind: "approved", note: "manual check from Reports" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const when = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section className="glass rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold">
            <Database className="size-4 text-cyan-400" /> Edge ledger
            <span className="text-xs font-normal text-muted-foreground">
              · append-only mirror in Turso
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data === null
              ? "Loading…"
              : data.configured
                ? `Connected to “${data.database}” · ${data.summary.total} event${data.summary.total === 1 ? "" : "s"} · ${data.summary.uniqueParts} part${data.summary.uniqueParts === 1 ? "" : "s"} · ${data.summary.uniqueMembers} member${data.summary.uniqueMembers === 1 ? "" : "s"}`
                : `Not connected — ${data.problem}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          {data?.configured && (
            <Button size="sm" onClick={() => void logTest()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Log a test event
            </Button>
          )}
        </div>
      </div>

      {data?.summary.byKind.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.summary.byKind.map((k) => (
            <span
              key={k.kind}
              className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] text-cyan-300"
            >
              {k.label} · {k.count}
            </span>
          ))}
        </div>
      ) : null}

      {data?.events.length ? (
        <div className="mt-3 max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {data.events.map((e: ShelfEvent, i: number) => (
                <tr key={`${e.at}-${i}`} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {e.at > 0 ? when(e.at) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {shelfEventLabel(e.kind)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.partTag || "—"}</td>
                  <td className="px-3 py-2 text-xs">{e.partName || "—"}</td>
                  <td className="px-3 py-2 text-xs">{e.member || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {e.note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}