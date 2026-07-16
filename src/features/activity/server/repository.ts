import type { PoolClient } from "pg";

import { query } from "@/shared/db/client";
import { requireTaskRole } from "@/features/workspaces/server/authz";
import type {
  Activity,
  ActivityAction,
  ActivityEntry,
  Actor,
  ColumnAction,
  ColumnSnapshot,
  CommentAction,
  CommentSnapshot,
  TaskAction,
  TaskSnapshot,
} from "../types";

interface ActivityInputBase {
  workspaceId: string;
  boardId: number | null;
  taskId: number | null;
  actor: Actor;
}

/**
 * Mirrors the Activity union: the action decides which snapshot shape is legal,
 * so `comment.created` cannot be logged carrying a TaskSnapshot. Worth the extra
 * few lines on this table specifically — it is append-only, so a row written
 * with a mismatched payload is not a bug you fix, it is a bug you keep.
 */
export type ActivityInput =
  | (ActivityInputBase & {
      action: TaskAction;
      before?: TaskSnapshot | null;
      after?: TaskSnapshot | null;
    })
  | (ActivityInputBase & {
      action: CommentAction;
      before?: CommentSnapshot | null;
      after?: CommentSnapshot | null;
    })
  | (ActivityInputBase & {
      action: ColumnAction;
      before?: ColumnSnapshot | null;
      after?: ColumnSnapshot | null;
    });

/**
 * Appends one row to the audit trail.
 *
 * The transaction client is a REQUIRED parameter, not an optional one, and that
 * is the whole design. A mutation and its log entry must commit or roll back
 * together: log outside the transaction and a rolled-back write leaves a record
 * of something that never happened, while a crash between the two loses the
 * record of something that did. Taking a PoolClient makes that atomicity
 * structural — there is no way to call this outside a caller's transaction,
 * so no future caller can get it subtly wrong.
 *
 * PRD §7.2 states the same requirement from the agent side: the log is written
 * before the tool returns to the model.
 */
export async function logActivity(
  client: PoolClient,
  entry: ActivityInput
): Promise<void> {
  await client.query(
    `INSERT INTO activity_log
       (workspace_id, board_id, task_id, actor_type, actor_id, action, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.workspaceId,
      entry.boardId,
      entry.taskId,
      entry.actor.type,
      entry.actor.id,
      entry.action,
      entry.before ?? null,
      entry.after ?? null,
    ]
  );
}

// `id` is BIGSERIAL: pg returns int8 as a string rather than a number, because
// it does not fit in a JS number. The Activity type says string for that reason.
const ACTIVITY_COLUMNS = `al.id, al.workspace_id AS "workspaceId",
                          al.board_id AS "boardId", al.task_id AS "taskId",
                          al.actor_type AS "actorType", al.actor_id AS "actorId",
                          al.action, al.before, al.after,
                          al.created_at AS "createdAt"`;

/**
 * A task's history, newest first.
 *
 * Readable by any workspace member — a viewer who can see the task can see what
 * happened to it. The LEFT JOIN resolves the actor's display name and tolerates
 * its absence: actor_id carries no foreign key, so a deleted user's actions
 * survive them, and from M2 an agent id will not match "user" at all. Both
 * arrive as a null name, which the UI renders rather than dropping the row —
 * losing an audit entry because its author left would defeat the purpose.
 */
export async function listActivityForTask(
  userId: string,
  taskId: number
): Promise<ActivityEntry[]> {
  await requireTaskRole(userId, taskId, "viewer");
  return query<ActivityEntry>(
    `SELECT ${ACTIVITY_COLUMNS},
            u.name AS "actorName", u.image AS "actorImage"
       FROM activity_log al
       LEFT JOIN "user" u
         ON u.id = al.actor_id AND al.actor_type = 'human'
      WHERE al.task_id = $1
      ORDER BY al.id DESC`,
    [taskId]
  );
}

/** Test/diagnostic reader: the raw rows for a task, without the actor join. */
export async function listRawActivityForTask(
  taskId: number
): Promise<Activity[]> {
  return query<Activity>(
    `SELECT ${ACTIVITY_COLUMNS} FROM activity_log al
      WHERE al.task_id = $1 ORDER BY al.id DESC`,
    [taskId]
  );
}

export type { ActivityAction };
