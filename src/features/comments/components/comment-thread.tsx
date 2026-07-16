"use client";

import { useEffect, useState } from "react";

import { relativeTime } from "@/shared/lib/relative-time";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import {
  createComment,
  deleteComment,
  fetchTaskComments,
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

  /**
   * One wrapper for all three mutations: each refetches rather than patching
   * state locally. The server decides canEdit/canDelete and stamps updated_at,
   * so reconstructing the row here would mean reimplementing those rules in the
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

  async function saveEdit(id: number) {
    const body = editDraft.trim();
    if (!body) return;
    await mutate(async () => {
      await updateComment(id, body);
      setEditingId(null);
    });
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

      {comments.length > 0 && (
        <ul className="grid gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex items-start gap-2.5">
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
                    {/* whitespace-pre-wrap, so the newlines someone typed are the
                        newlines they get. The body is rendered as text and never
                        as markup — an agent writes here from M2, and its output
                        is not to be trusted with HTML. */}
                    <p className="text-sm leading-6 whitespace-pre-wrap">
                      {comment.body}
                    </p>
                    <div className="flex gap-2">
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
                  </>
                )}
              </div>
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
          placeholder="Leave a comment"
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
