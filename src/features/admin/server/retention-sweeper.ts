import { query } from "@/shared/db/client";
import { deleteObject } from "@/features/attachments/server/storage";

/** The per-row guard the sweeps share: skip anything under an active hold. */
const notHeld = (type: string, idExpr: string, wsExpr: string) =>
  `NOT EXISTS (SELECT 1 FROM legal_hold h WHERE h.workspace_id=${wsExpr} AND h.subject_type='${type}' AND h.subject_id=${idExpr}::text AND h.released_at IS NULL)`;

/** The join every task-content sweep needs: a task's board and workspace. */
const TASK_WS = `JOIN board_column col ON col.id=t.column_id JOIN board b ON b.id=col.board_id`;

/**
 * Applies each workspace's retention policies (task | comment | attachment |
 * doc | activity_log — retention.ts's five subjects). Every sweep respects
 * active legal holds, the same guard the interactive delete paths use; a task's
 * sweep checks its whole cascade set (subtasks, comments, attachments), the
 * assertTaskDeletionNotHeld rule, so deleting a parent cannot bypass a hold on
 * its content. Attachment rows go first and their objects follow best-effort —
 * row-first is deleteAttachment's rule: a leftover object is a storage leak a
 * later sweep can reclaim, never a 404ing download.
 */
export async function sweepRetention(){
  // Audit events are append-only and self-contained; no holds apply to them.
  await query(`DELETE FROM activity_log a USING retention_policy p WHERE p.workspace_id=a.workspace_id AND p.subject_type='activity_log' AND a.created_at < now() - (p.max_age_days * interval '1 day')`);

  // Comments: content on a task, guarded only by their own hold.
  await query(`DELETE FROM comment c USING task t ${TASK_WS}, retention_policy p
    WHERE t.id=c.task_id AND p.workspace_id=b.workspace_id AND p.subject_type='comment'
      AND c.created_at < now() - (p.max_age_days * interval '1 day')
      AND ${notHeld("comment", "c.id", "b.workspace_id")}`);

  // Attachments: the row is the source of truth, so it goes first; the object
  // follows best-effort through the storage module's delete path. A failed
  // object delete leaves an orphan a storage sweep can reclaim (the documented
  // 021 follow-up), which is why the keys are collected before the rows go.
  const attachments = await query<{ id: number; key: string }>(
    `SELECT a.id, a.key FROM attachment a JOIN task t ON t.id=a.task_id ${TASK_WS}
      JOIN retention_policy p ON p.workspace_id=b.workspace_id AND p.subject_type='attachment'
     WHERE a.created_at < now() - (p.max_age_days * interval '1 day')
       AND ${notHeld("attachment", "a.id", "b.workspace_id")}`);
  if (attachments.length > 0) {
    await query(`DELETE FROM attachment WHERE id=ANY($1)`, [attachments.map(a => a.id)]);
    for (const a of attachments) await deleteObject(a.key).catch(() => {});
  }

  // Tasks: deleting one cascades its subtasks, comments, and attachments, so a
  // task is swept only when nothing in that whole set is held. The cascade also
  // drops attachment rows, so their object keys are collected first.
  const tasks = await query<{ id: number }>(
    `SELECT t.id FROM task t ${TASK_WS}
      JOIN retention_policy p ON p.workspace_id=b.workspace_id AND p.subject_type='task'
     WHERE t.created_at < now() - (p.max_age_days * interval '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM legal_hold h
          WHERE h.workspace_id=b.workspace_id AND h.released_at IS NULL AND (
            (h.subject_type='task' AND h.subject_id IN (SELECT x.id::text FROM task x WHERE x.id=t.id OR x.parent_id=t.id))
            OR (h.subject_type='comment' AND h.subject_id IN (SELECT c.id::text FROM comment c JOIN task x ON x.id=c.task_id WHERE x.id=t.id OR x.parent_id=t.id))
            OR (h.subject_type='attachment' AND h.subject_id IN (SELECT a.id::text FROM attachment a JOIN task x ON x.id=a.task_id WHERE x.id=t.id OR x.parent_id=t.id))
          ))`);
  if (tasks.length > 0) {
    const ids = tasks.map(t => t.id);
    const keys = await query<{ key: string }>(`SELECT a.key FROM attachment a JOIN task x ON x.id=a.task_id WHERE x.id=ANY($1) OR x.parent_id=ANY($1)`, [ids]);
    await query(`DELETE FROM task WHERE id=ANY($1)`, [ids]);
    for (const { key } of keys) await deleteObject(key).catch(() => {});
  }

  // Docs: a delete cascades to child pages, so a doc is swept only when neither
  // it nor anything under it is held — the held CTE walks each held doc's
  // ancestor chain, and every doc on such a chain is exempt.
  await query(`WITH RECURSIVE held AS (
      SELECT d.id, d.parent_id FROM doc d JOIN legal_hold h ON h.workspace_id=d.workspace_id AND h.subject_type='doc' AND h.subject_id=d.id::text AND h.released_at IS NULL
      UNION SELECT d.id, d.parent_id FROM doc d JOIN held ON held.parent_id=d.id
    )
    DELETE FROM doc USING retention_policy p
     WHERE p.workspace_id=doc.workspace_id AND p.subject_type='doc'
       AND doc.created_at < now() - (p.max_age_days * interval '1 day')
       AND doc.id NOT IN (SELECT id FROM held)`);
}
export function startRetentionSweeper(){
  const run=()=>void sweepRetention().catch(error=>console.error("Retention sweep failed",error));
  run(); return setInterval(run,60*60*1000);
}
