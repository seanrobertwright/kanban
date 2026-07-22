"use client";

import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import * as api from "../client/api";
import {
  FEEDBACK_SENTIMENTS,
  IDEA_STATUSES,
  type DiscoveryOverview,
  type Feedback,
  type FeedbackSentiment,
  type IdeaSignal,
  type IdeaStatus,
} from "../types";

interface DiscoveryDialogProps {
  boardId: number;
  open: boolean;
  /** member+ may author ideas/feedback and promote; everyone viewer+ reads. */
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a promotion so the board can pull in the new task. */
  onPromoted?: () => void;
}

const selectClass =
  "h-7 rounded-md border bg-transparent px-1 text-xs text-foreground";

/**
 * Product discovery + Feedback intake (043). Two lenses on one dialog: an Ideas
 * backlog ranked by RICE with the demand each idea has accrued, and a Feedback
 * inbox that files raw signal under the ideas it argues for. A validated idea is
 * promoted into a task, carrying its detail and demand. Self-fetching like
 * Insights/Timesheet — discovery is pre-commitment plumbing, not on BoardData.
 */
export function DiscoveryDialog({
  boardId,
  open,
  canEdit,
  onOpenChange,
  onPromoted,
}: DiscoveryDialogProps) {
  const [data, setData] = useState<DiscoveryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"ideas" | "feedback">("ideas");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const d = await api.fetchDiscovery(boardId);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load discovery");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function reload() {
    setData(await api.fetchDiscovery(boardId));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Discovery</DialogTitle>
          <DialogDescription>
            Shape ideas before they become work: rank the backlog by RICE, gather
            the feedback that argues for each, and promote a validated idea into a
            task.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={tab === "ideas" ? "secondary" : "ghost"}
            onClick={() => setTab("ideas")}
          >
            Ideas{data ? ` · ${data.ideas.length}` : ""}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "feedback" ? "secondary" : "ghost"}
            onClick={() => setTab("feedback")}
          >
            Feedback{data ? ` · ${data.feedback.length}` : ""}
            {data && data.unlinkedFeedback > 0 && (
              <span className="ml-1 text-muted-foreground">
                ({data.unlinkedFeedback} unfiled)
              </span>
            )}
          </Button>
        </div>

        {data && tab === "ideas" && (
          <IdeasPanel
            data={data}
            boardId={boardId}
            canEdit={canEdit}
            onError={setError}
            onChanged={reload}
            onPromoted={async () => {
              await reload();
              onPromoted?.();
            }}
          />
        )}

        {data && tab === "feedback" && (
          <FeedbackPanel
            data={data}
            boardId={boardId}
            canEdit={canEdit}
            onError={setError}
            onChanged={reload}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function IdeasPanel({
  data,
  boardId,
  canEdit,
  onError,
  onChanged,
  onPromoted,
}: {
  data: DiscoveryOverview;
  boardId: number;
  canEdit: boolean;
  onError: (m: string) => void;
  onChanged: () => Promise<void>;
  onPromoted: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [reach, setReach] = useState("0");
  const [impact, setImpact] = useState("1");
  const [confidence, setConfidence] = useState("100");
  const [effort, setEffort] = useState("1");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createIdea(boardId, {
        title: title.trim(),
        reach: clampInt(reach, 0),
        impact: clampInt(impact, 1),
        confidence: clampInt(confidence, 100),
        effort: Math.max(1, clampInt(effort, 1)),
      });
      setTitle("");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add idea");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {/* Pipeline counts across the stages. */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {IDEA_STATUSES.map((s) => (
          <span
            key={s}
            className="rounded-full border px-2 py-0.5 text-muted-foreground"
          >
            {s} {data.statusCounts[s]}
          </span>
        ))}
      </div>

      {canEdit && (
        <div className="grid gap-2 rounded-lg border border-dashed p-3">
          <Input
            aria-label="New idea"
            value={title}
            placeholder="Capture an idea…"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <RiceInput label="Reach" value={reach} onChange={setReach} />
            <RiceInput label="Impact 1-5" value={impact} onChange={setImpact} />
            <RiceInput label="Confid %" value={confidence} onChange={setConfidence} />
            <RiceInput label="Effort wk" value={effort} onChange={setEffort} />
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={busy || !title.trim()}
              onClick={add}
            >
              Add idea
            </Button>
          </div>
        </div>
      )}

      {data.ideas.length === 0 && (
        <p className="text-sm text-muted-foreground">No ideas yet.</p>
      )}

      <div className="grid gap-2">
        {data.ideas.map((idea) => (
          <IdeaRow
            key={idea.id}
            idea={idea}
            canEdit={canEdit}
            onError={onError}
            onChanged={onChanged}
            onPromoted={onPromoted}
          />
        ))}
      </div>
    </div>
  );
}

function IdeaRow({
  idea,
  canEdit,
  onError,
  onChanged,
  onPromoted,
}: {
  idea: IdeaSignal;
  canEdit: boolean;
  onError: (m: string) => void;
  onChanged: () => Promise<void>;
  onPromoted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, after: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await after();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{idea.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          RICE {idea.rice}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {idea.feedbackCount > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5">
            {idea.feedbackCount} feedback · {idea.demand} votes
          </span>
        )}
        {canEdit ? (
          <select
            aria-label={`Status of ${idea.title}`}
            className={selectClass}
            value={idea.status}
            disabled={busy || idea.status === "promoted"}
            onChange={(e) =>
              run(
                () =>
                  api.updateIdea(idea.id, {
                    status: e.target.value as IdeaStatus,
                  }),
                onChanged
              )
            }
          >
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span>{idea.status}</span>
        )}

        {canEdit && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              disabled={busy || idea.promotedTaskId !== null}
              onClick={() => run(() => api.promoteIdea(idea.id), onPromoted)}
            >
              {idea.promotedTaskId !== null ? "Promoted" : "Promote"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => run(() => api.deleteIdea(idea.id), onChanged)}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackPanel({
  data,
  boardId,
  canEdit,
  onError,
  onChanged,
}: {
  data: DiscoveryOverview;
  boardId: number;
  canEdit: boolean;
  onError: (m: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [source, setSource] = useState("");
  const [sentiment, setSentiment] = useState<FeedbackSentiment>("idea");
  const [ideaId, setIdeaId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.createFeedback(boardId, {
        body: body.trim(),
        source: source.trim() || undefined,
        sentiment,
        ideaId: ideaId ? Number(ideaId) : null,
      });
      setBody("");
      setSource("");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add feedback");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {canEdit && (
        <div className="grid gap-2 rounded-lg border border-dashed p-3">
          <Textarea
            aria-label="New feedback"
            value={body}
            placeholder="What did a customer or stakeholder say?"
            rows={2}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Input
              aria-label="Source"
              value={source}
              placeholder="Source (e.g. Acme, sales)"
              className="h-7 max-w-40 text-xs"
              onChange={(e) => setSource(e.target.value)}
            />
            <select
              aria-label="Sentiment"
              className={selectClass}
              value={sentiment}
              onChange={(e) => setSentiment(e.target.value as FeedbackSentiment)}
            >
              {FEEDBACK_SENTIMENTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <IdeaSelect ideas={data.ideas} value={ideaId} onChange={setIdeaId} />
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={busy || !body.trim()}
              onClick={add}
            >
              Add feedback
            </Button>
          </div>
        </div>
      )}

      {data.feedback.length === 0 && (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      )}

      <div className="grid gap-2">
        {data.feedback.map((f) => (
          <FeedbackRow
            key={f.id}
            feedback={f}
            ideas={data.ideas}
            canEdit={canEdit}
            onError={onError}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function FeedbackRow({
  feedback,
  ideas,
  canEdit,
  onError,
  onChanged,
}: {
  feedback: Feedback;
  ideas: IdeaSignal[];
  canEdit: boolean;
  onError: (m: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const filedUnder = ideas.find((i) => i.id === feedback.ideaId);

  return (
    <div className="grid gap-1.5 rounded-lg border px-3 py-2.5">
      <p className="text-sm">{feedback.body}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border px-2 py-0.5">{feedback.sentiment}</span>
        {feedback.source && <span>{feedback.source}</span>}
        <button
          type="button"
          className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 tabular-nums enabled:hover:bg-muted/70 disabled:opacity-60"
          disabled={busy || !canEdit}
          onClick={() => run(() => api.updateFeedback(feedback.id, { vote: true }))}
          aria-label="Upvote feedback"
        >
          ▲ {feedback.votes}
        </button>

        {canEdit ? (
          <select
            aria-label="File under idea"
            className={`${selectClass} ml-auto`}
            value={feedback.ideaId ?? ""}
            disabled={busy}
            onChange={(e) =>
              run(() =>
                api.updateFeedback(feedback.id, {
                  ideaId: e.target.value ? Number(e.target.value) : null,
                })
              )
            }
          >
            <option value="">Inbox (unfiled)</option>
            {ideas.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="ml-auto">{filedUnder ? filedUnder.title : "unfiled"}</span>
        )}

        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={busy}
            onClick={() => run(() => api.deleteFeedback(feedback.id))}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function IdeaSelect({
  ideas,
  value,
  onChange,
}: {
  ideas: IdeaSignal[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label="File under idea"
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">No idea</option>
      {ideas.map((i) => (
        <option key={i.id} value={i.id}>
          {i.title}
        </option>
      ))}
    </select>
  );
}

function RiceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span>{label}</span>
      <Input
        type="number"
        aria-label={label}
        value={value}
        className="h-7 w-16 text-xs"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Parses an int input, falling back to a default when blank/NaN. */
function clampInt(v: string, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : fallback;
}
