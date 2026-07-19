import type { PoolClient } from "pg";

import { query } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import { queueDelivery } from "@/features/webhooks/server/dispatch";
import {
  requireTaskRole,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import type {
  Activity,
  ActivityAction,
  ActivityEntry,
  Actor,
  ColumnAction,
  ColumnSnapshot,
  CommentAction,
  CommentSnapshot,
  LabelAction,
  LabelSnapshot,
  MilestoneAction,
  MilestoneSnapshot,
  NotificationEntry,
  TimeAction,
  TimeSnapshot,
  TaskAction,
  TaskSnapshot,
  WorkspaceNotifications,
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
    })
  | (ActivityInputBase & {
      action: LabelAction;
      before?: LabelSnapshot | null;
      after?: LabelSnapshot | null;
    })
  | (ActivityInputBase & {
      action: MilestoneAction;
      before?: MilestoneSnapshot | null;
      after?: MilestoneSnapshot | null;
    })
  | (ActivityInputBase & {
      action: TimeAction;
      before?: TimeSnapshot | null;
      after?: TimeSnapshot | null;
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
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO activity_log
       (workspace_id, board_id, task_id, actor_type, actor_id, action, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
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
  // Webhooks ride the log (025): every mutation already lands here, so this is
  // the one seam that reaches them all. Queued, not sent — the delivery runs
  // via after(), post-commit, and re-reads the row first so a rollback after
  // this INSERT delivers nothing. See webhooks/server/dispatch.ts.
  queueDelivery(rows[0].id);
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
 * Readable by any workspace principal — a viewer who can see the task can see
 * what happened to it, and that includes an agent (009): §7.1's whole point is
 * that an agent is subject to the same access path a human is, and reading a
 * task's history is part of that path. requireTaskRole already takes a Principal
 * and scopes an agent to its own workspace, so an agent reads the history of the
 * tasks it may act on and no others — the reason this widened from a bare userId.
 * An agent that writes to the log (claim, comment) but cannot read it back is
 * blind to what it and everyone else did on a task it is working.
 *
 * Two LEFT JOINs resolve the actor's display name, one per actor kind, gated on
 * actor_type so each row matches at most one: a human row resolves through
 * "user", an agent row through "agent" (009) — which is what makes the feed read
 * "Triage Bot moved this" rather than attributing it to whoever minted the token.
 * Both tolerate absence: actor_id carries no foreign key, so a deleted user's or
 * a deleted agent's actions survive them as a null name, which the UI renders
 * rather than dropping the row — losing an audit entry because its author left
 * would defeat the purpose.
 */
export async function listActivityForTask(
  principal: string | Principal,
  taskId: number
): Promise<ActivityEntry[]> {
  await requireTaskRole(principal, taskId, "viewer");
  return query<ActivityEntry>(
    `SELECT ${ACTIVITY_COLUMNS},
            COALESCE(u.name, ag.name) AS "actorName",
            COALESCE(u.image, ag.image) AS "actorImage"
       FROM activity_log al
       LEFT JOIN "user" u
         ON u.id = al.actor_id AND al.actor_type = 'human'
       LEFT JOIN agent ag
         ON ag.id = al.actor_id AND al.actor_type = 'agent'
      WHERE al.task_id = $1
      ORDER BY al.id DESC`,
    [taskId]
  );
}

const NOTIFICATION_LIMIT = 30;

/**
 * The workspace's recent activity as a member's notification feed, plus how much
 * of it is unread.
 *
 * "By someone other than me": your own actions are not news to you, so a human
 * actor whose id is the reader is excluded — but only humans, since an agent
 * sharing no id space with a user could never collide, and an agent's actions
 * ARE news (the wedge: you want to know what the agent did on your board).
 *
 * taskTitle is COALESCEd out of the row first, then the snapshot: a live task
 * resolves through the join, and a deleted one — whose row is gone but whose
 * task.deleted entry is exactly what a reader wants to see — resolves from the
 * `before`/`after` snapshot that still names it. Null only for column and label
 * entries, which are not about a task at all.
 *
 * Unread is counted unbounded (idx_activity_log_workspace covers it) while the
 * list is capped, so a badge reads "50" even though the dropdown shows 30.
 */
export async function listWorkspaceNotifications(
  userId: string,
  workspaceId: string
): Promise<WorkspaceNotifications> {
  await requireWorkspaceRole(userId, workspaceId, "viewer");

  const seen = await query<{ lastSeenAt: string }>(
    `SELECT last_seen_at AS "lastSeenAt" FROM notification_seen
      WHERE user_id = $1 AND workspace_id = $2`,
    [userId, workspaceId]
  );
  const lastSeenAt = seen[0]?.lastSeenAt ?? null;

  const notMine = `NOT (al.actor_type = 'human' AND al.actor_id = $2)`;

  const items = await query<NotificationEntry>(
    `SELECT ${ACTIVITY_COLUMNS},
            COALESCE(u.name, ag.name) AS "actorName",
            COALESCE(u.image, ag.image) AS "actorImage",
            COALESCE(t.title, al.after->>'title', al.before->>'title')
              AS "taskTitle",
            EXISTS (SELECT 1 FROM comment_mention cm
                     WHERE cm.user_id = $2
                       AND cm.comment_id =
                           COALESCE((al.after->>'commentId')::int,
                                    (al.before->>'commentId')::int))
              AS "mentionedMe"
       FROM activity_log al
       LEFT JOIN "user" u
         ON u.id = al.actor_id AND al.actor_type = 'human'
       LEFT JOIN agent ag
         ON ag.id = al.actor_id AND al.actor_type = 'agent'
       LEFT JOIN task t ON t.id = al.task_id
      WHERE al.workspace_id = $1 AND ${notMine}
      ORDER BY al.id DESC
      LIMIT ${NOTIFICATION_LIMIT}`,
    [workspaceId, userId]
  );

  // COALESCE the marker to epoch so a member who has never looked sees every
  // entry counted rather than none.
  const counted = await query<{ n: string }>(
    `SELECT count(*) AS n FROM activity_log al
      WHERE al.workspace_id = $1 AND ${notMine}
        AND al.created_at > COALESCE($3::timestamptz, 'epoch'::timestamptz)`,
    [workspaceId, userId, lastSeenAt]
  );

  return { items, unreadCount: Number(counted[0]?.n ?? 0), lastSeenAt };
}

/**
 * Moves the reader's last-seen marker to now — "mark all read". One UPSERT, so
 * clearing a hundred unread entries is a single write, not a hundred.
 */
export async function markNotificationsSeen(
  userId: string,
  workspaceId: string
): Promise<string> {
  await requireWorkspaceRole(userId, workspaceId, "viewer");
  const rows = await query<{ lastSeenAt: string }>(
    `INSERT INTO notification_seen (user_id, workspace_id, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, workspace_id)
     DO UPDATE SET last_seen_at = now()
     RETURNING last_seen_at AS "lastSeenAt"`,
    [userId, workspaceId]
  );
  return rows[0].lastSeenAt;
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
