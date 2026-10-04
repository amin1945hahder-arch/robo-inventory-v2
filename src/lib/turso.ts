/**
 * Shared, pure rules for the Turso edge ledger.
 *
 * RoboShelf keeps its authoritative data in Convex. Turso (edge-hosted SQLite)
 * holds a small, append-only `shelf_events` ledger written from a Convex node
 * action after a rental decision — an immutable, query-anywhere audit trail
 * that lives outside the primary database (and survives a Convex reset).
 *
 * Everything in this file is dependency-free so the aggregation and config
 * validation can be unit-tested without a network or a Convex runtime.
 * The client itself lives in src/convex/turso.ts ("use node").
 */

export const TURSO_URL = "TURSO_DATABASE_URL";
export const TURSO_TOKEN = "TURSO_AUTH_TOKEN";

/** Schemes Turso hands out for a database URL. */
const OK_SCHEMES = ["libsql://", "https://", "wss://"];

export type TursoConfig = { url: string; authToken: string };

export type TursoConfigResult =
  | { ok: true; config: TursoConfig }
  | { ok: false; problem: string };

/**
 * Reads the two keys out of an env-like source. Returns a *problem string*
 * instead of throwing so the Settings panel can explain what is missing
 * rather than surfacing a stack trace.
 */
export function readTursoConfig(
  source: Record<string, string | undefined>,
): TursoConfigResult {
  const url = (source[TURSO_URL] ?? "").trim();
  const authToken = (source[TURSO_TOKEN] ?? "").trim();
  if (!url) {
    return { ok: false, problem: `${TURSO_URL} is not set` };
  }
  if (!OK_SCHEMES.some((s) => url.startsWith(s))) {
    return {
      ok: false,
      problem: `${TURSO_URL} must start with ${OK_SCHEMES.join(", ")}`,
    };
  }
  if (!authToken) {
    return { ok: false, problem: `${TURSO_TOKEN} is not set` };
  }
  return { ok: true, config: { url, authToken } };
}

/**
 * Database name for display only.
 *
 * Turso hands out two host shapes and both must reduce to the database name:
 *   my-db-ab12.turso.io                        (legacy)
 *   my-db-org.aws-eu-west-1.turso.io           (current, region in the host)
 * Database names may themselves contain hyphens, so the org segment is only
 * dropped once the region label has been removed.
 */
export function tursoDatabaseName(url: string): string {
  const bare = url.replace(/^[a-z]+:\/\//, "").replace(/\?.*$/, "");
  const host = bare.split("/")[0] ?? bare;
  const noDomain = host.replace(/\.turso\.io$/i, "");
  const noRegion = noDomain.replace(/\.aws[\w-]*$/i, "");
  const parts = noRegion.split("-");
  return parts.length > 1 ? parts.slice(0, -1).join("-") : noRegion || host;
}

// ===== The ledger =========================================================

export const SHELF_EVENT_KINDS = [
  "rented",
  "returned",
  "broken",
  "approved",
  "denied",
] as const;

export type ShelfEventKind = (typeof SHELF_EVENT_KINDS)[number];

export function isShelfEventKind(value: unknown): value is ShelfEventKind {
  return (
    typeof value === "string" &&
    (SHELF_EVENT_KINDS as readonly string[]).includes(value)
  );
}

const KIND_LABELS: Record<ShelfEventKind, string> = {
  rented: "Taken out",
  returned: "Returned",
  broken: "Flagged broken",
  approved: "Request approved",
  denied: "Request denied",
};

export function shelfEventLabel(kind: string): string {
  return isShelfEventKind(kind) ? KIND_LABELS[kind] : kind;
}

/** One ledger row, as stored in (and read back from) Turso. */
export type ShelfEvent = {
  at: number;
  kind: string;
  partTag: string;
  partName: string;
  member: string;
  note: string;
};

export type ShelfEventDraft = {
  at?: number;
  kind: ShelfEventKind;
  partTag?: string;
  partName?: string;
  member?: string;
  note?: string;
};

/** Normalises a draft into a storable row (blank strings, never undefined). */
export function toShelfEvent(draft: ShelfEventDraft): ShelfEvent {
  const clean = (v: string | undefined) => (v ?? "").trim().slice(0, 200);
  return {
    at: typeof draft.at === "number" && Number.isFinite(draft.at) ? draft.at : 0,
    kind: draft.kind,
    partTag: clean(draft.partTag),
    partName: clean(draft.partName),
    member: clean(draft.member),
    note: clean(draft.note),
  };
}

export type ShelfEventSummary = {
  total: number;
  byKind: { kind: string; label: string; count: number }[];
  uniqueParts: number;
  uniqueMembers: number;
  lastAt: number | null;
  firstAt: number | null;
};

/** Aggregates ledger rows for the dashboard tile. Pure and order-free. */
export function summarizeShelfEvents(rows: readonly ShelfEvent[]): ShelfEventSummary {
  const kinds = new Map<string, number>();
  const parts = new Set<string>();
  const members = new Set<string>();
  let lastAt: number | null = null;
  let firstAt: number | null = null;

  for (const row of rows) {
    kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
    if (row.partTag) parts.add(row.partTag);
    if (row.member) members.add(row.member);
    if (row.at > 0) {
      lastAt = lastAt === null ? row.at : Math.max(lastAt, row.at);
      firstAt = firstAt === null ? row.at : Math.min(firstAt, row.at);
    }
  }

  const byKind = [...kinds.entries()]
    .map(([kind, count]) => ({ kind, label: shelfEventLabel(kind), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    total: rows.length,
    byKind,
    uniqueParts: parts.size,
    uniqueMembers: members.size,
    lastAt,
    firstAt,
  };
}