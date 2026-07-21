"use client";

import { useEffect, useMemo, useState } from "react";

import { relativeTime } from "@/shared/lib/relative-time";
import { RichText } from "@/shared/ui/rich-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import {
  createComment,
  deleteComment,
  fetchTaskComments,
  resolveComment,
  updateComment,
} from "../client/api";
import type { CommentEntry } from "../types";

interface CommentThreadProps {
  taskId: number;
  /**
   * Called after any mutation. Every one of them writes an activity_log row, and
   * the history rendered beside this would otherwise go on claiming nothing
   * happened until the dialog is reopened.
   */
  onChanged?: () => void;
}

/**
 * Who said it.
 *
 * Absent for two expected reasons, exactly as in the activity feed: author_id
 * has no foreign key, so a deleted user's remarks outlive them, and from M2 an
 * agent id will not match the "user" table at all.
 */
function authorLabel(comment: CommentEntry): string {
  if (comment.authorType === "agent") return comment.authorName ?? "An agent";
  return comment.authorName ?? "A removed user";
}

export function CommentThread({ taskId, onChanged }: CommentThreadProps) {
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Which comment a reply is being written under (033), and its draft. Only
  // top-level comments can be replied to — depth is 1.
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  // Delete is two clicks rather than a confirm() — a modal inside a modal, and
  // one that blocks the whole page. Until M2 ships undo, the second click is the
  // only thing standing between a slip and a lost remark.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // Bumped by every mutation to re-run the effect below. A plain load() function
  // called from the handlers would be simpler to read and wrong in one specific
  // way: reading the clock is impure, so it belongs in an effect rather than in
  // a function the component body could reach during a render.
  const [version, setVersion] = useState(0);

  // Every setState lands after an await, never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTaskComments(taskId);
        if (cancelled) return;
        setComments(data);
        // Re-read on every load, not once on mount: a comment posted ten minutes
        // into a session is stamped against a fresh clock, or "just now" comes
        // out as "in 10 minutes".
        setNow(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load comments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, version]);

  // Top-level remarks in order, each with its replies gathered under it (033).
  // The server returns a flat list ordered by id; nesting is a client shape, so
  // the query stays one index scan and the thread decides how deep to draw.
  const threads = useMemo(() => {
    const replies = new Map<number, CommentEntry[]>();
    for (const c of comments) {
      if (c.parentId === null) continue;
      const list = replies.get(c.parentId);
      if (list) list.push(c);
      else replies.set(c.parentId, [c]);
    }
    return comments
      .filter((c) => c.parentId === null)
      .map((c) => ({ comment: c, replies: replies.get(c.id) ?? [] }));
  }, [comments]);

  /**
   * One wrapper for all mutations: each refetches rather than patching state
   * locally. The server decides canEdit/canDelete and stamps updated_at, so
   * reconstructing the row here would mean reimplementing those rules in the
   * client — the exact duplication CommentEntry exists to avoid.
   */
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    const body = draft.trim();
    if (!body) return;
    await mutate(async () => {
      await createComment(taskId, body);
      setDraft("");
    });
  }

  async function postReply(parentId: number) {
    const body = replyDraft.trim();
    if (!body) return;
    await mutate(async () => {
      await createComment(taskId, body, parentId);
      setReplyingToId(null);
      setReplyDraft("");
    });
  }

  async function saveEdit(id: number) {
    const body = editDraft.trim();
    if (!body) return;
    await mutate(async () => {
      await updateComment(id, body);
      setEditingId(null);
    });
  }

  /** One comment's row — author line, body (or the edit form), and its actions.
   *  Reused for a top-level remark and for a reply; `canReply` is false for a
   *  reply, since depth is 1. */
  function CommentRow({
    comment,
    canReply,
  }: {
    comment: CommentEntry;
    canReply: boolean;
  }) {
    return (
      <div className="flex items-start gap-2.5">
        <Avatar className="size-6">
          <AvatarImage src={comment.authorImage ?? undefined} alt="" />
          <AvatarFallback className="text-[10px]">
            {authorLabel(comment).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="grid flex-1 gap-1">
          <p className="text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">
              {authorLabel(comment)}
            </span>{" "}
            <time dateTime={comment.createdAt} title={comment.createdAt}>
              {relativeTime(comment.createdAt, now)}
            </time>
            {comment.updatedAt && (
              <span title={`Edited ${comment.updatedAt}`}> · edited</span>
            )}
            {comment.resolvedAt && (
              <span
                className="text-primary"
                title={`Resolved ${comment.resolvedAt}`}
              >
                {" "}
                · resolved
              </span>
            )}
          </p>

          {editingId === comment.id ? (
            <div className="grid gap-1.5">
              <Textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={3}
                aria-label="Edit comment"
                autoFocus
              />
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !editDraft.trim()}
                  onClick={() => saveEdit(comment.id)}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Rendered as a safe Markdown subset (033) — React elements, never
                  HTML: an agent writes here, so its body is escaped by
                  construction and cannot smuggle markup. See shared/ui/rich-text. */}
              <RichText
                text={comment.body}
                className={`text-sm ${
                  comment.resolvedAt ? "text-muted-foreground" : ""
                }`}
              />
              <div className="flex gap-2">
                {canReply && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setReplyingToId(
                        replyingToId === comment.id ? null : comment.id
                      );
                      setReplyDraft("");
                    }}
                  >
                    Reply
                  </button>
                )}
                {comment.canResolve && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    disabled={busy}
                    onClick={() =>
                      mutate(() =>
                        resolveComment(comment.id, !comment.resolvedAt)
                      )
                    }
                  >
                    {comment.resolvedAt ? "Reopen" : "Resolve"}
                  </button>
                )}
                {comment.canEdit && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setEditingId(comment.id);
                      setEditDraft(comment.body);
                      setConfirmingId(null);
                    }}
                  >
                    Edit
                  </button>
                )}
                {comment.canDelete && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() =>
                      confirmingId === comment.id
                        ? mutate(() => deleteComment(comment.id))
                        : setConfirmingId(comment.id)
                    }
                    onBlur={() => setConfirmingId(null)}
                  >
                    {confirmingId === comment.id ? "Really?" : "Delete"}
                  </button>
                )}
              </div>

              {/* The reply box, scoped to this comment (033). Not a <form> — it
                  sits inside the dialog's task form, and a nested one is invalid. */}
              {replyingToId === comment.id && (
                <div className="mt-1 grid gap-1.5">
                  <Textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    placeholder="Reply…"
                    rows={2}
                    aria-label="Reply"
                    autoFocus
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void postReply(comment.id);
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setReplyingToId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !replyDraft.trim()}
                      onClick={() => postReply(comment.id)}
                    >
                      Reply
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        Comments{comments.length > 0 && ` (${comments.length})`}
      </p>

      {loading && comments.length === 0 && (
        <p className="text-xs text-muted-foreground">Loading comments…</p>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {!loading && comments.length === 0 && (
        <p className="text-xs text-muted-foreground">No comments yet.</p>
      )}

      {threads.length > 0 && (
        <ul className="grid gap-3">
          {threads.map(({ comment, replies }) => (
            <li key={comment.id} className="grid gap-2">
              <CommentRow comment={comment} canReply />
              {replies.length > 0 && (
                // Replies indented under their parent, with a rule to read the
                // nesting. One level only (033), so this never recurses.
                <ul className="ml-4 grid gap-3 border-l pl-3">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentRow comment={reply} canReply={false} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Not a <form>: this sits inside the dialog's task form, and a nested one
          is invalid HTML. Every button here is type="button" for the same
          reason — the default is submit, which would save the task instead. */}
      <div className="grid gap-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a comment — **bold**, *italic*, `code`, - lists, [links](https://…)"
          rows={2}
          aria-label="New comment"
          onKeyDown={(e) => {
            // Enter alone inserts a newline, as it must in a textarea, so the
            // shortcut is the one every other comment box uses.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void post();
            }
          }}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={busy || !draft.trim()}
            onClick={post}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
