import type { Principal } from "@/features/auth/server/principal";
import { asPrincipal, principalActor } from "@/features/auth/server/principal";
import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { RequestSnapshot } from "@/features/activity/types";
import { moveTask, updateTask } from "@/features/tasks/server/repository";
import {
  AuthzError,
  requireBoardRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import {
  TRIAGE_REASON_MAX,
  type RequestItem,
  type RequestTriage,
  type TriageRequestInput,
} from "../types";

/**
 * One request row, as both the queue and a single re-read see it. One list, for
 * taskColumns's reason: two hand-copied SELECTs drift, and the drift is
 * invisible to the compiler because `query<RequestItem>` is a cast, not a check.
 *
 * `assignee` is assembled as a json {type, id} in SQL rather than returned as
 * two flat columns, which is the shape task rows already take — the object that
 * lands must already be RequestItem-shaped.
 */
const REQUEST_COLUMNS = `
  t.id, t.title, bc.title AS "status", t.column_id AS "columnId",
  t.request_meta->>'source' AS "source",
  COALESCE(u.name, ag.name) AS "requesterName",
  (SELECT min(ts.due_at) FROM task_sla ts
    WHERE ts.task_id = t.id AND ts.breached_at IS NULL) AS "slaDueAt",
  (SELECT max(ts.breached_at) FROM task_sla ts
    WHERE ts.task_id = t.id) AS "slaBreachedAt",
  t.priority,
  CASE WHEN t.assignee_id IS NOT NULL
       THEN json_build_object('type', 'human', 'id', t.assignee_id)
       WHEN t.agent_id IS NOT NULL
       THEN json_build_object('type', 'agent', 'id', t.agent_id)
       ELSE NULL END AS assignee,
  t.request_meta->'triage' AS triage,
  t.created_at AS "createdAt"
`;

/**
 * The joins the columns above need. The requester name resolves through the two
 * actor tables the same way the activity feed does, tolerating a deleted
 * requester as a null name.
 */
const REQUEST_FROM = `
  FROM task t
  JOIN board_column bc ON bc.id = t.column_id
  LEFT JOIN "user" u
    ON u.id = t.request_meta->>'requesterId'
   AND t.request_meta->>'requesterType' = 'human'
  LEFT JOIN agent ag
    ON ag.id = t.request_meta->>'requesterId'
   AND t.request_meta->>'requesterType' = 'agent'
`;

/**
 * The board's request queue (1.8): intake tasks (those carrying request_meta),
 * with their status column, source form, requester, nearest open SLA due time,
 * and triage verdict — null while the request is still open, which is what the
 * lens groups on. Readable by any board viewer.
 */
export async function listRequests(
  actor: string | Principal,
  boardId: number
): Promise<RequestItem[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<RequestItem>(
    `SELECT ${REQUEST_COLUMNS}
       ${REQUEST_FROM}
      WHERE bc.board_id = $1
        AND t.request_meta IS NOT NULL
        AND t.parent_id IS NULL
      ORDER BY bc.position, t.position, t.id`,
    [boardId]
  );
}

/**
 * Triage one request (1.8): accept it into the queue's working column, decline
 * it with a reason, or reopen a verdict that was wrong.
 *
 * The routing half rides the ordinary task repositories — moveTask and
 * updateTask — rather than writing columns and assignees itself, so triage
 * inherits their tenancy checks, their position handling, their automation
 * triggers and their task.moved / task.assigned log rows for free. What this
 * function owns is the verdict: the `triage` stamp inside request_meta and the
 * one activity row that records who decided what, and why.
 *
 * Member, not admin: triaging intake is the daily work of whoever staffs the
 * queue, and every write it performs is one that same person could make by hand
 * on the board.
 */
export async function triageRequest(
  actor: string | Principal,
  boardId: number,
  taskId: number,
  input: TriageRequestInput
): Promise<RequestItem> {
  const by = principalActor(asPrincipal(actor));
  const { workspaceId, boardId: taskBoardId } = await requireTaskRole(
    actor,
    taskId,
    "member"
  );
  // The board id in the URL is not decoration: without this, a member of two
  // boards could triage board B's request through board A's endpoint, and the
  // lens that reloads afterwards would show nothing having changed.
  if (taskBoardId !== boardId) {
    throw new AuthzError("not_found", "That request is not on this board");
  }

  const existing = await queryOne<{
    source: string | null;
    triage: RequestTriage | null;
  }>(
    `SELECT request_meta->>'source' AS source, request_meta->'triage' AS triage
       FROM task WHERE id = $1 AND request_meta IS NOT NULL`,
    [taskId]
  );
  if (!existing) {
    throw new AuthzError("not_found", "That task is not a request");
  }

  if (input.action === "accept") {
    // Append to the end of the target column — moveTask clamps position to the
    // sibling count, so the sentinel lands it last rather than making triage
    // count rows itself (the automation runner's move, same reason).
    if (input.columnId !== undefined) {
      await moveTask(actor, taskId, {
        columnId: input.columnId,
        position: Number.MAX_SAFE_INTEGER,
      });
    }
    // `in`, not a truthiness check: null means "unassign", absent means "the
    // triager said nothing about the assignee" (updateTask's three-valued rule).
    const routing = {
      ...("assignee" in input ? { assignee: input.assignee } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    if (Object.keys(routing).length > 0) {
      await updateTask(actor, taskId, routing);
    }
  }

  const reason =
    input.action === "decline"
      ? (input.reason ?? "").trim().slice(0, TRIAGE_REASON_MAX) || undefined
      : undefined;
  const verdict: RequestTriage | null =
    input.action === "reopen"
      ? null
      : {
          state: input.action === "accept" ? "accepted" : "declined",
          at: new Date().toISOString(),
          actorType: by.type,
          actorId: by.id,
          ...(reason ? { reason } : {}),
        };

  const source = existing.source ?? "";
  const before: RequestSnapshot = {
    source,
    state: existing.triage?.state ?? "open",
    ...(existing.triage?.reason ? { reason: existing.triage.reason } : {}),
  };
  const after: RequestSnapshot = {
    source,
    state: verdict?.state ?? "open",
    ...(reason ? { reason } : {}),
  };

  await withTransaction(async (client) => {
    // A jsonb_set that adds the key, or a `- 'triage'` that removes it. Setting
    // the whole request_meta would be the obvious alternative and the wrong one:
    // it would clobber a source/requester stamp written since this row was read.
    await client.query(
      `UPDATE task
          SET request_meta = CASE
                WHEN $2::jsonb IS NULL THEN request_meta - 'triage'
                ELSE jsonb_set(request_meta, '{triage}', $2::jsonb)
              END
        WHERE id = $1`,
      [taskId, verdict ? JSON.stringify(verdict) : null]
    );
    await logActivity(client, {
      workspaceId,
      boardId,
      taskId,
      actor: by,
      action:
        input.action === "accept"
          ? "request.accepted"
          : input.action === "decline"
            ? "request.declined"
            : "request.reopened",
      before,
      after,
    });
  });

  const updated = await queryOne<RequestItem>(
    `SELECT ${REQUEST_COLUMNS} ${REQUEST_FROM} WHERE t.id = $1`,
    [taskId]
  );
  // Unreachable in practice — the row was just written inside a committed
  // transaction — but the queue's contract is "a request comes back", and a
  // silent undefined would surface in the lens as a card that vanished.
  if (!updated) throw new AuthzError("not_found", "Request not found");
  return updated;
}
