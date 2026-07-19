import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  ROLE_RANK,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import type { WorkspaceRole } from "@/features/workspaces/types";
import type { TaskTime, TimeEntry } from "../types";

/**
 * Time tracking (027). Logging is viewer-open, commenting's rule and for its
 * reason: a viewer can be handed work (004), and reporting the hours spent on
 * it is reporting back, not board mutation. Deleting is own-or-admin, the
 * comment-delete rule — a wrong entry is retracted by whoever made it, or
 * moderated away.
 */

/** Prefixed for joins, bare for RETURNING — commentColumns' shape. */
const timeColumns = (p: "" | "te." = "") =>
  `${p}id, ${p}task_id AS "taskId", ${p}user_id AS "userId", ${p}minutes,
   ${p}spent_on AS "spentOn", ${p}note, ${p}created_at AS "createdAt"`;

export async function listTaskTime(
  actor: string | Principal,
  taskId: number
): Promise<TaskTime> {
  const { role } = await requireTaskRole(actor, taskId, "viewer");
  const userId =
    typeof actor === "string"
      ? actor
      : actor.kind === "human"
        ? actor.userId
        : actor.agentId;

  const entries = await query<
    TimeEntry & { userName: string | null }
  >(
    `SELECT ${timeColumns("te.")},
            u.name AS "userName"
       FROM time_entry te
       LEFT JOIN "user" u ON u.id = te.user_id
      WHERE te.task_id = $1
      ORDER BY te.spent_on DESC, te.id DESC`,
    [taskId]
  );

  return {
    entries: entries.map((e) => ({
      ...e,
      canDelete:
        e.userId === userId || ROLE_RANK[role as WorkspaceRole] >= ROLE_RANK.admin,
    })),
    totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
  };
}

export async function addTimeEntry(
  userId: string,
  taskId: number,
  input: { minutes: number; spentOn?: string | null; note?: string }
): Promise<TimeEntry> {
  const { boardId, workspaceId } = await requireTaskRole(
    userId,
    taskId,
    "viewer"
  );
  const by: Actor = { type: "human", id: userId };

  return withTransaction(async (client) => {
    const { rows } = await client.query<TimeEntry>(
      `INSERT INTO time_entry (task_id, user_id, minutes, spent_on, note)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5)
       RETURNING ${timeColumns()}`,
      [taskId, userId, input.minutes, input.spentOn ?? null, input.note ?? ""]
    );
    const entry = rows[0];

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId,
      actor: by,
      action: "time.logged",
      after: {
        timeEntryId: entry.id,
        minutes: entry.minutes,
        spentOn: entry.spentOn,
        note: entry.note,
        by,
      },
    });
    return entry;
  });
}

export async function deleteTimeEntry(
  userId: string,
  id: number
): Promise<boolean> {
  // One join resolves the entry and the caller's standing — the
  // requireCommentAccess shape, for its anti-oracle reason.
  const row = await queryOne<TimeEntry & { role: WorkspaceRole; boardId: number; workspaceId: string }>(
    `SELECT ${timeColumns("te.")},
            wm.role, bc.board_id AS "boardId", b.workspace_id AS "workspaceId"
       FROM time_entry te
       JOIN task t ON t.id = te.task_id
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
       JOIN workspace_member wm
         ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE te.id = $1`,
    [id, userId]
  );
  if (!row) throw new AuthzError("not_found", "Time entry not found");
  if (row.userId !== userId && ROLE_RANK[row.role] < ROLE_RANK.admin) {
    throw new AuthzError(
      "forbidden",
      "Only the author or an admin can delete a time entry"
    );
  }

  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM time_entry WHERE id = $1`,
      [id]
    );
    if (!rowCount) return false;

    await logActivity(client, {
      workspaceId: row.workspaceId,
      boardId: row.boardId,
      taskId: row.taskId,
      actor: { type: "human", id: userId },
      action: "time.deleted",
      before: {
        timeEntryId: row.id,
        minutes: row.minutes,
        spentOn: row.spentOn,
        note: row.note,
        by: { type: "human", id: row.userId },
      },
    });
    return true;
  });
}
