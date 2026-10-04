import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EditorChip } from "@/components/EditorChip";
import { Textarea } from "@/components/ui/textarea";
import {
  defaultDecisions,
  diffLines,
  diffStat,
  type DiffRow,
  type RowDecision,
} from "@/lib/lineDiff";

export type ReviewSubmission = {
  row: number;
  approve: boolean;
  replacement?: string;
  note?: string;
};

/**
 * Split-view review of a member's README edit request.
 *
 * Left column = the current text (removed lines in red), right column = the
 * proposed text (added lines in green). Every change row has an approve
 * checkbox; the proposed line can be edited before approving, and unchecking
 * reveals a rejection-note field that is stored with the decision.
 */
export function ReadmeReviewDialog({
  open,
  onOpenChange,
  baseContent,
  proposedContent,
  submitterName,
  submitterImage,
  note,
  status,
  canReview,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseContent: string;
  proposedContent: string;
  submitterName: string;
  submitterImage?: string | null;
  note?: string;
  status: "pending" | "approved" | "denied";
  canReview: boolean;
  busy?: boolean;
  onSubmit: (decisions: ReviewSubmission[]) => void;
}) {
  const rows = useMemo(() => diffLines(baseContent, proposedContent), [baseContent, proposedContent]);
  const stat = useMemo(() => diffStat(rows), [rows]);
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});

  // Reset decisions whenever the reviewed request changes.
  useEffect(() => {
    if (open) setDecisions(defaultDecisions(rows));
  }, [open, rows]);

  const changeRows = rows.filter((r) => r.type !== "same");
  const decidedCount = changeRows.filter((r) => decisions[r.index]?.approve !== false).length;
  const rejectedCount = changeRows.length - decidedCount;

  const setDecision = (index: number, patch: Partial<RowDecision>) => {
    setDecisions((prev) => ({
      ...prev,
      [index]: { approve: true, ...prev[index], ...patch },
    }));
  };

  const setAll = (approve: boolean) => {
    const next: Record<number, RowDecision> = {};
    for (const row of changeRows) next[row.index] = { approve };
    setDecisions(next);
  };

  const submit = () => {
    const out: ReviewSubmission[] = changeRows.map((row) => {
      const d = decisions[row.index] ?? { approve: true };
      const proposed = row.newLine ?? "";
      const replacement =
        d.replacement !== undefined && d.replacement !== proposed ? d.replacement : undefined;
      return {
        row: row.index,
        approve: d.approve !== false,
        replacement,
        note: d.note?.trim() || undefined,
      };
    });
    onSubmit(out);
  };

  const paneLabel = "sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-3 py-2 text-xs font-semibold backdrop-blur";

  const rowBox = (row: DiffRow, side: "base" | "new") => {
    const d = decisions[row.index];
    const approved = d?.approve !== false;
    const isCtx = row.type === "same";

    if (side === "base") {
      const text = row.baseLine ?? "";
      const changed = row.type === "del" || row.type === "replace";
      if (row.type === "add") {
        return (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground/60">
            <span className="font-mono">—</span> new line
          </div>
        );
      }
      return (
        <div
          className={`whitespace-pre-wrap break-words px-3 py-2 font-mono text-[13px] leading-6 ${
            isCtx
              ? "text-muted-foreground/70"
              : changed
                ? "rounded-md bg-red-500/15 text-red-700 dark:text-red-300"
                : ""
          }`}
        >
          {text === "" ? " " : text}
        </div>
      );
    }

    // side === "new"
    if (row.type === "del") {
      return (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground/60">
          <span className="font-mono">—</span> line removed
        </div>
      );
    }
    const proposed = row.newLine ?? "";
    if (isCtx) {
      return (
        <div className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-[13px] leading-6 text-muted-foreground/70">
          {proposed === "" ? " " : proposed}
        </div>
      );
    }

    const edited = (d?.replacement ?? proposed) !== proposed;
    return (
      <div
        className={`rounded-md border px-2 py-1.5 ${
          approved
            ? edited
              ? "border-emerald-500/50 bg-emerald-500/15"
              : "border-emerald-500/30 bg-emerald-500/10"
            : "border-red-500/50 bg-red-500/10"
        }`}
      >
        <div className="flex items-start gap-2">
          <Checkbox
            className="mt-1"
            checked={approved}
            disabled={!canReview || status !== "pending"}
            onCheckedChange={(v) => setDecision(row.index, { approve: v === true })}
            aria-label={approved ? "Approve this line" : "Rejected"}
          />
          <Textarea
            className="min-h-[34px] resize-y border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] leading-6 shadow-none focus-visible:border-input"
            value={d?.replacement ?? proposed}
            rows={Math.min(4, Math.max(1, Math.ceil((d?.replacement ?? proposed).length / 64)))}
            disabled={!canReview || status !== "pending"}
            onChange={(e) => {
              const value = e.target.value;
              setDecision(row.index, {
                replacement: value === proposed ? undefined : value,
              });
            }}
          />
        </div>
        {!approved && (
          <Textarea
            className="mt-1 min-h-[30px] border-red-500/40 bg-red-500/5 text-[12px]"
            placeholder="Reason for rejection — this note is shown to the submitter and saved in history"
            value={d?.note ?? ""}
            disabled={!canReview || status !== "pending"}
            onChange={(e) => setDecision(row.index, { note: e.target.value })}
          />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(1200px,96vw)] flex-col gap-3 overflow-hidden p-0 sm:max-w-[min(1200px,96vw)]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Review README edit —
            <EditorChip name={submitterName} image={submitterImage} />
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {changeRows.length} changed line{changeRows.length === 1 ? "" : "s"} ·{" "}
            <span className="text-emerald-500">+{stat.added} added</span> ·{" "}
            <span className="text-red-500">−{stat.removed} removed</span> ·{" "}
            <span className="text-amber-500">{stat.changed} modified</span>
            {note ? ` · “${note}”` : ""}
          </p>
        </DialogHeader>

        {canReview && status === "pending" && (
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2">
            <Button size="sm" variant="outline" onClick={() => setAll(true)}>
              Approve all
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAll(false)}>
              Reject all
            </Button>
            <p className="ml-auto text-xs text-muted-foreground">
              {decidedCount} approved · {rejectedCount} rejected — untick a line to reject it and
              add a note; edit any proposed line before approving.
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-[1fr_1fr] gap-x-2">
              <div className={paneLabel}>
                <span>Current README</span>
                <span className="text-red-500/80">removed in red</span>
              </div>
              <div className={paneLabel}>
                <span>Proposed change</span>
                <span className="text-emerald-500/80">added in green</span>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-x-2 gap-y-1 py-2">
              {rows.map((row) => (
                <div key={`b${row.index}`} className="contents">
                  {rowBox(row, "base")}
                  {rowBox(row, "new")}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <p className="mr-auto self-center text-[11px] text-muted-foreground">
            {status !== "pending"
              ? "This request was already reviewed."
              : "Your decisions are saved to the project history."}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canReview && status === "pending" && (
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : rejectedCount > 0 ? "Submit review" : "Approve changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
