import type { Principal } from "@/features/auth/server/principal";
import { query } from "@/shared/db/client";
import { requireBoardRole } from "@/features/workspaces/server/authz";
import type { RequestItem } from "../types";

/**
 * The board's request queue (1.8): intake tasks (those carrying request_meta),
 * with their status column, source form, requester, and nearest open SLA due
 * time. Readable by any board viewer. The requester name resolves through the
 * two actor tables (user/agent) the same way the activity feed does, tolerating
 * a deleted requester as a null name.
 */
export async function listRequests(
  actor: string | Principal,
  boardId: number
): Promise<RequestItem[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<RequestItem>(
    `SELECT t.id, t.title, bc.title AS "status", t.column_id AS "columnId",
            t.request_meta->>'source' AS "source",
            COALESCE(u.name, ag.name) AS "requesterName",
            (SELECT min(ts.due_at) FROM task_sla ts
              WHERE ts.task_id = t.id AND ts.breached_at IS NULL) AS "slaDueAt",
            t.created_at AS "createdAt"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       LEFT JOIN "user" u
         ON u.id = t.request_meta->>'requesterId'
        AND t.request_meta->>'requesterType' = 'human'
       LEFT JOIN agent ag
         ON ag.id = t.request_meta->>'requesterId'
        AND t.request_meta->>'requesterType' = 'agent'
      WHERE bc.board_id = $1
        AND t.request_meta IS NOT NULL
        AND t.parent_id IS NULL
      ORDER BY bc.position, t.position, t.id`,
    [boardId]
  );
}
