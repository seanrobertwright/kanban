import { queryOne } from "@/shared/db/client";
import { AuthzError } from "@/features/workspaces/server/authz";

export type LegalHoldSubject = "task" | "comment" | "attachment" | "doc";

/** Refuse a destructive operation while an administrator's legal hold is active. */
export async function assertNotOnLegalHold(
  workspaceId: string,
  subjectType: LegalHoldSubject,
  subjectId: number | string
): Promise<void> {
  const hold = await queryOne<{ id: string }>(
    `SELECT id::text FROM legal_hold
      WHERE workspace_id = $1 AND subject_type = $2 AND subject_id = $3
        AND released_at IS NULL`,
    [workspaceId, subjectType, String(subjectId)]
  );
  if (hold) {
    throw new AuthzError(
      "conflict",
      "This record is under an active legal hold and cannot be deleted"
    );
  }
}

/** Task and document deletes cascade to related content. Check the whole
 * deletion set first so a hold on a comment, attachment, subtask, or child doc
 * cannot be bypassed by deleting its parent. */
export async function assertTaskDeletionNotHeld(workspaceId: string, taskId: number): Promise<void> {
  const hold = await queryOne<{ id: string }>(
    `SELECT h.id::text
       FROM legal_hold h
      WHERE h.workspace_id = $1 AND h.released_at IS NULL
        AND (
          (h.subject_type = 'task' AND h.subject_id IN (
            SELECT id::text FROM task WHERE id = $2 OR parent_id = $2
          )) OR
          (h.subject_type = 'comment' AND h.subject_id IN (
            SELECT c.id::text FROM comment c JOIN task t ON t.id = c.task_id
             WHERE t.id = $2 OR t.parent_id = $2
          )) OR
          (h.subject_type = 'attachment' AND h.subject_id IN (
            SELECT a.id::text FROM attachment a JOIN task t ON t.id = a.task_id
             WHERE t.id = $2 OR t.parent_id = $2
          ))
        ) LIMIT 1`,
    [workspaceId, taskId]
  );
  if (hold) throw new AuthzError("conflict", "This task contains a record under an active legal hold");
}

export async function assertDocDeletionNotHeld(workspaceId: string, docId: number): Promise<void> {
  const hold = await queryOne<{ id: string }>(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM doc WHERE id = $2
       UNION ALL
       SELECT d.id FROM doc d JOIN descendants parent ON d.parent_id = parent.id
     )
     SELECT h.id::text FROM legal_hold h
      WHERE h.workspace_id = $1 AND h.subject_type = 'doc' AND h.released_at IS NULL
        AND h.subject_id IN (SELECT id::text FROM descendants)
      LIMIT 1`,
    [workspaceId, docId]
  );
  if (hold) throw new AuthzError("conflict", "This document tree contains a record under an active legal hold");
}
