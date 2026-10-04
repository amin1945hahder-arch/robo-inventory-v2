import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MarkdownView } from "@/components/MarkdownView";
import { ReadmeReviewDialog, type ReviewSubmission } from "@/components/ReadmeReviewDialog";
import { EditorChip } from "@/components/EditorChip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingGif } from "@/components/LoadingGif";
import { diffLines, diffStat } from "@/lib/lineDiff";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  GitPullRequestArrow,
  History,
  Pencil,
  Plus,
  RotateCcw,
  XCircle,
} from "lucide-react";

const STARTER_TEMPLATE = `# Project name

> One-line pitch: what does this project build?

## Overview

Write the project's story here — goals, constraints, and who works on what.

## Media

Paste a video or image link on its own line and it is embedded automatically:

\`\`\`
https://youtu.be/VIDEO_ID
\`\`\`

![diagram](https://link/to/image.png)

## Specs

| Item | Value |
| --- | --- |
| Budget | — |
| Timeline | — |
`;

/** Small read-only red/green diff used inside the history dialog. */
function HistoryDiff({ base, next }: { base: string; next: string }) {
  const rows = useMemo(() => diffLines(base, next), [base, next]);
  const changes = rows.filter((r) => r.type !== "same");
  if (changes.length === 0) {
    return <p className="text-xs text-muted-foreground">No text changes in this entry.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="min-w-[420px] font-mono text-xs leading-6">
        {changes.map((r) => (
          <div key={r.index}>
            {r.type !== "add" && (
              <p className="whitespace-pre-wrap break-words bg-red-500/12 px-2 text-red-700 dark:text-red-300">
                − {r.baseLine ?? ""}
              </p>
            )}
            {r.type !== "del" && (
              <p className="whitespace-pre-wrap break-words bg-emerald-500/12 px-2 text-emerald-700 dark:text-emerald-300">
                + {r.newLine ?? ""}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectReadmeTab({
  projectId,
  projectName,
}: {
  projectId: Id<"projects">;
  projectName: string;
}) {
  const readme = useQuery(api.projectReadme.get, { projectId });
  const saveReadme = useMutation(api.projectReadme.save);
  const cancelRequest = useMutation(api.projectReadme.cancel);
  const reviewRequest = useMutation(api.projectReadme.review);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitNote, setSubmitNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPick, setHistoryPick] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<Id<"readmeEditRequests"> | null>(null);

  const history = useQuery(api.projectReadme.history, historyOpen ? { projectId } : "skip");
  const reviewReq = useQuery(
    api.projectReadme.getRequest,
    reviewId ? { requestId: reviewId } : "skip",
  );

  // Deep link: /projects/:id?tab=readme&review=<requestId> opens the review.
  const [sp, setSp] = useSearchParams();
  const reviewParam = sp.get("review");
  useEffect(() => {
    if (reviewParam) setReviewId(reviewParam as Id<"readmeEditRequests">);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewParam]);
  const closeReview = (open: boolean) => {
    if (open) return;
    setReviewId(null);
    if (sp.get("review")) {
      const next = new URLSearchParams(sp);
      next.delete("review");
      setSp(next, { replace: true });
    }
  };

  const startEdit = () => {
    setDraft(readme?.content ?? STARTER_TEMPLATE);
    setSubmitNote("");
    setEditing(true);
  };

  const doSave = async () => {
    setBusy(true);
    try {
      const res = await saveReadme({
        projectId,
        content: draft,
        note: submitNote.trim() || undefined,
      });
      if (res.mode === "direct") {
        toast.success("README saved");
      } else {
        toast.success("Edit submitted — the lead and admins will review it");
      }
      setEditing(false);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doReview = async (decisions: ReviewSubmission[]) => {
    if (!reviewId) return;
    setBusy(true);
    try {
      const res = await reviewRequest({ requestId: reviewId, decisions });
      if (res.outcome === "denied") toast.success("Request rejected — the submitter was notified below");
      else if (res.outcome === "partial") toast.success("Partially approved — rejected lines are documented");
      else toast.success("Changes approved and applied to the README");
      closeReview(false);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const content = readme?.content ?? "";
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName.replace(/[^\w\-]+/g, "-") || "project"}-README.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  };

  if (readme === undefined) {
    return <LoadingGif size={40} label={null} />;
  }

  const content = readme.content;
  const pending = readme.pending ?? [];
  const myPending = pending.find((p) => p.isMine);
  const toReview = pending.filter((p) => !p.isMine);
  const empty = !content.trim();

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {!editing && (
          <>
            {readme.canEdit && (
              <Button size="sm" className="press-3d" onClick={startEdit}>
                {empty ? <Plus className="size-3.5" /> : <Pencil className="size-3.5" />}
                {empty ? "Add README" : "Edit"}
              </Button>
          )}
            <Button size="sm" variant="outline" onClick={download} disabled={empty}>
              <Download className="size-3.5" /> Download
            </Button>
            <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="size-3.5" /> History
            </Button>
            {!empty && (
              <p className="ml-auto text-xs text-muted-foreground">
                v{readme.version}
                {readme.updatedAt
                  ? ` · updated ${new Date(readme.updatedAt).toLocaleDateString("en-GB")} by ${readme.updatedByName ?? "member"}`
                  : ""}
              </p>
            )}
          </>
        )}
      </div>

      {/* Pending edit requests — reviewers act here */}
      {!editing && toReview.length > 0 && readme.canReview && (
        <div className="flex flex-col gap-2">
          {toReview.map((p) => (
            <div
              key={p._id}
              className="glass-3d flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 px-4 py-3"
            >
              <GitPullRequestArrow className="size-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <EditorChip name={p.submitterName} image={p.submitterImage} />
                  proposed README edits
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(p.requestedAt).toLocaleString("en-GB")}
                  {p.note ? ` · “${p.note}”` : ""}
                </p>
              </div>
              <Button size="sm" onClick={() => setReviewId(p._id)}>
                Review changes
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* My pending request */}
      {!editing && myPending && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3">
          <Clock3 className="size-4 shrink-0 text-sky-400" />
          <p className="min-w-0 flex-1 text-sm">
            Your edit is waiting for review by the lead and admins.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await cancelRequest({ requestId: myPending._id });
                toast.success("Withdrawn — you can edit again anytime");
              } catch (e) {
                toast.error(asMessage(e));
              }
            }}
          >
            <RotateCcw className="size-3.5" /> Withdraw
          </Button>
        </div>
      )}

      {/* Editor / rendered README */}
      {editing ? (
        <div className="glass-3d flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4" /> Editing README — Markdown
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Headings, tables, images, code and links all render — paste a video link on its own
              line to embed it.
            </p>
          </div>
          <Textarea
            className="min-h-[420px] font-mono text-[13px] leading-6"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder="# Start with a heading…"
          />
          {!readme.canDirectSave && (
            <div className="grid gap-1.5">
              <Label htmlFor="readme-note">Summary for the reviewers (optional)</Label>
              <Input
                id="readme-note"
                value={submitNote}
                onChange={(e) => setSubmitNote(e.target.value)}
                placeholder="e.g. Added the wiring table and a demo video"
              />
              <p className="text-[11px] text-muted-foreground">
                You are an assigned member but not the lead — saving sends this as an edit request
                for review.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className="press-3d" onClick={doSave} disabled={busy || !draft.trim()}>
              {busy ? "Saving…" : readme.canDirectSave ? "Save README" : "Send for review"}
            </Button>
          </div>
        </div>
      ) : empty ? (
        <div className="glass-3d flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center">
          <BookOpen className="size-9 text-muted-foreground/60" />
          <div>
            <p className="text-sm font-semibold">No README yet</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              The README is this project's front page — like on GitHub. Write the overview, drop in
              tables, images and video links, and every assigned member can follow the changes in
              history.
            </p>
          </div>
          {readme.canEdit && (
            <Button size="sm" className="press-3d" onClick={startEdit}>
              <Plus className="size-3.5" /> Create the README
            </Button>
          )}
        </div>
      ) : (
        <article className="glass-3d rounded-lg border p-5 sm:p-7">
          <MarkdownView markdown={content} />
        </article>
      )}

      {/* History */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex max-h-[88vh] w-[min(900px,96vw)] flex-col gap-3 overflow-hidden p-0 sm:max-w-[min(900px,96vw)]">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>README history</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Every save and every reviewed edit request — visible to all assigned members.
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {history === undefined ? (
              <LoadingGif size={36} label={null} />
            ) : history.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No changes yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((e, i) => {
                  const prev = history[i + 1]; // entries are newest-first
                  const stat = diffStat(diffLines(prev?.content ?? "", e.content));
                  const open = historyPick === e._id;
                  return (
                    <li key={e._id} className="rounded-lg border">
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
                        onClick={() => setHistoryPick(open ? null : e._id)}
                      >
                        {e.source === "direct" ? (
                          <Pencil className="size-3.5 shrink-0 text-emerald-400" />
                        ) : e.outcome === "denied" ? (
                          <XCircle className="size-3.5 shrink-0 text-red-400" />
                        ) : (
                          <CheckCircle2 className="size-3.5 shrink-0 text-sky-400" />
                        )}
                        <EditorChip name={e.editedByName} image={e.editedByImage} />
                        <span className="text-xs text-muted-foreground">
                          {e.source === "direct"
                            ? "edited directly"
                            : e.outcome === "denied"
                              ? "edit request rejected"
                              : e.outcome === "partial"
                                ? "edit request partially approved"
                                : "edit request approved"}
                        </span>
                        {e.reviewerName && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            · reviewed by
                            <EditorChip
                              name={e.reviewerName}
                              image={e.reviewerImage}
                              size="xs"
                            />
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                          {stat.added > 0 && (
                            <span className="text-emerald-500">+{stat.added}</span>
                          )}
                          {stat.removed > 0 && <span className="text-red-500">−{stat.removed}</span>}
                          {stat.changed > 0 && (
                            <span className="text-amber-500">~{stat.changed}</span>
                          )}
                          <span>{new Date(e.at).toLocaleString("en-GB")}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="border-t px-4 py-3">
                          {e.rejectNotes.length > 0 && (
                            <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
                              <p className="text-xs font-semibold text-red-400">
                                Rejected lines with reviewer notes
                              </p>
                              <ul className="mt-1 flex flex-col gap-1">
                                {e.rejectNotes.map((n, k) => (
                                  <li key={k} className="text-xs">
                                    <span className="font-mono text-muted-foreground line-through">
                                      {n.text}
                                    </span>
                                    {n.note && (
                                      <span className="ml-2 text-red-400">— {n.note}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {prev ? (
                            <HistoryDiff base={prev.content} next={e.content} />
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Initial version — nothing to compare against.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Split-view review */}
      <ReadmeReviewDialog
        open={!!reviewId}
        onOpenChange={closeReview}
        baseContent={reviewReq?.baseContent ?? ""}
        proposedContent={reviewReq?.proposedContent ?? ""}
        submitterName={reviewReq?.submitterName ?? ""}
        submitterImage={reviewReq?.submitterImage ?? null}
        note={reviewReq?.note}
        status={reviewReq?.status ?? "pending"}
        canReview={reviewReq?.canReview ?? false}
        busy={busy}
        onSubmit={doReview}
      />
    </div>
  );
}
