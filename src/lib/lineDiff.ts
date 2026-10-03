/**
 * Line-level diff + decision merge used by the README edit-request split review.
 *
 * The flow is:
 *   1. `diffLines(currentText, proposedText)` produces reviewable rows.
 *   2. The reviewer edits/approves each row (checkbox, replacement text, note).
 *   3. `mergeLines(currentText, rows, decisions)` builds the final saved text.
 *
 * Everything here is pure so it can be unit-tested without React or Convex.
 */

export type DiffType = "same" | "add" | "del" | "replace";

export interface DiffRow {
  /** Stable position within the diff output (0-based). */
  index: number;
  type: DiffType;
  /** Original line (present for same/del/replace). */
  baseLine?: string;
  /** Proposed line (present for same/add/replace). */
  newLine?: string;
}

/** Reviewer decision for a single diff row. */
export interface RowDecision {
  /** true = accept this change, false = keep/ignore it. Rows default to approved. */
  approve?: boolean;
  /** Reviewer-edited replacement text for the row (add/replace rows). */
  replacement?: string;
  /** Reviewer note — used as the rejection reason (or as a remark when approving). */
  note?: string;
}

export interface MergeResult {
  text: string;
  /** Rows that were approved and actually changed the base text. */
  applied: number;
  /** Rows the reviewer rejected (with their notes, if any). */
  rejected: { row: DiffRow; note?: string }[];
}

/** Max DP cells before we fall back to a cheaper positional diff (README-sized docs never hit this). */
const MAX_DP_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Normalize CRLF so diffs stay stable across platforms.
  return text.replace(/\r\n/g, "\n").split("\n");
}

type MidOp =
  | { kind: "same"; a: string; b: string }
  | { kind: "del"; a: string }
  | { kind: "add"; b: string };

function diffMiddle(a: string[], b: string[]): MidOp[] {
  if (a.length === 0) return b.map((line) => ({ kind: "add", b: line }));
  if (b.length === 0) return a.map((line) => ({ kind: "del", a: line }));
  if (a.length * b.length > MAX_DP_CELLS) return diffPositional(a, b);

  // Classic LCS table. README documents are small, so O(n·m) memory is fine.
  const n = a.length;
  const m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        a[i] === b[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
    }
  }

  const ops: MidOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
      ops.push({ kind: "del", a: a[i] });
      i++;
    } else {
      ops.push({ kind: "add", b: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", a: a[i++] });
  while (j < m) ops.push({ kind: "add", b: b[j++] });
  return ops;
}

/** Cheap fallback for pathological inputs: prefix/suffix + positional pairing. */
function diffPositional(a: string[], b: string[]): MidOp[] {
  const ops: MidOp[] = [];
  const shared = Math.min(a.length, b.length);
  for (let k = 0; k < shared; k++) {
    if (a[k] === b[k]) ops.push({ kind: "same", a: a[k], b: b[k] });
    else {
      ops.push({ kind: "del", a: a[k] });
      ops.push({ kind: "add", b: b[k] });
    }
  }
  for (let k = shared; k < a.length; k++) ops.push({ kind: "del", a: a[k] });
  for (let k = shared; k < b.length; k++) ops.push({ kind: "add", b: b[k] });
  return ops;
}

/**
 * Convert raw LCS ops into review rows. A contiguous change run (any mix of
 * del/add with no `same` between) is paired positionally: the i-th deleted
 * line becomes `replace(deleted_i → added_i)`, extra lines stay del/add.
 * This keeps "old → new" on one reviewable line instead of showing an
 * unrelated del followed by an unrelated add.
 */
function opsToRows(ops: MidOp[]): { type: DiffType; baseLine?: string; newLine?: string }[] {
  const rows: { type: DiffType; baseLine?: string; newLine?: string }[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.kind === "same") {
      rows.push({ type: "same", baseLine: op.a, newLine: op.b });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i].kind !== "same") {
      const cur = ops[i];
      if (cur.kind === "del") dels.push(cur.a);
      else if (cur.kind === "add") adds.push(cur.b);
      i++;
    }
    const paired = Math.min(dels.length, adds.length);
    for (let k = 0; k < paired; k++) {
      rows.push({ type: "replace", baseLine: dels[k], newLine: adds[k] });
    }
    for (let k = paired; k < dels.length; k++) rows.push({ type: "del", baseLine: dels[k] });
    for (let k = paired; k < adds.length; k++) rows.push({ type: "add", newLine: adds[k] });
  }
  return rows;
}

/**
 * Line-based LCS diff over two texts. Rows are returned in output order and
 * cover the entire document (prefix/suffix included), so `mergeLines` can
 * rebuild the final text from the rows alone.
 */
export function diffLines(baseText: string, proposedText: string): DiffRow[] {
  const a = splitLines(baseText);
  const b = splitLines(proposedText);

  // Strip the common prefix/suffix — most README edits touch a few lines only.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const parts: { type: DiffType; baseLine?: string; newLine?: string }[] = [];
  for (let i = 0; i < start; i++) parts.push({ type: "same", baseLine: a[i], newLine: b[i] });

  parts.push(...opsToRows(diffMiddle(a.slice(start, endA), b.slice(start, endB))));

  for (let i = endA, j = endB; i < a.length && j < b.length; i++, j++) {
    parts.push({ type: "same", baseLine: a[i], newLine: b[j] });
  }

  return parts.map((p, index) => ({ ...p, index }));
}

/**
 * Apply reviewer decisions to the base text.
 * - `same` rows are always kept.
 * - Approved `add`/`replace` rows insert their (possibly reviewer-edited) line.
 * - Approved `del` rows drop the base line; rejected ones keep it.
 * - Unapproved `add` rows are skipped; unapproved `replace` keeps the base line.
 */
export function mergeLines(
  _baseText: string,
  rows: DiffRow[],
  decisions: Record<number, RowDecision>,
): MergeResult {
  const out: string[] = [];
  let applied = 0;
  const rejected: { row: DiffRow; note?: string }[] = [];

  // The diff covers the whole document (common prefix/suffix included), so the
  // final text is rebuilt purely from the rows.
  for (const row of rows) {
    const d = decisions[row.index];
    const approved = d?.approve !== false; // default: approved
    const note = d?.note?.trim() || undefined;

    switch (row.type) {
      case "same":
        out.push(row.baseLine ?? "");
        break;
      case "add":
        if (approved) {
          out.push(normalizeLine(d?.replacement ?? row.newLine ?? ""));
          applied++;
        } else {
          rejected.push({ row, note });
        }
        break;
      case "del":
        if (approved) {
          applied++;
        } else {
          out.push(row.baseLine ?? "");
          rejected.push({ row, note });
        }
        break;
      case "replace":
        if (approved) {
          out.push(normalizeLine(d?.replacement ?? row.newLine ?? ""));
          applied++;
        } else {
          out.push(row.baseLine ?? "");
          rejected.push({ row, note });
        }
        break;
    }
  }

  return { text: out.join("\n"), applied, rejected };
}

function normalizeLine(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n/g, " ");
}

/** Human summary used in history / request panels. */
export function diffStat(rows: DiffRow[]): { added: number; removed: number; changed: number } {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const r of rows) {
    if (r.type === "add") added++;
    else if (r.type === "del") removed++;
    else if (r.type === "replace") changed++;
  }
  return { added, removed, changed };
}

/** Convenience: decisions keyed by row index, all change rows approved by default. */
export function defaultDecisions(rows: DiffRow[]): Record<number, RowDecision> {
  const map: Record<number, RowDecision> = {};
  for (const row of rows) if (row.type !== "same") map[row.index] = { approve: true };
  return map;
}
