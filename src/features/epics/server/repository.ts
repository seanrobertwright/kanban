import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, EpicSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import type { CreateEpicInput, Epic, UpdateEpicInput } from "../types";

/**
 * Epics (031). The rank rules are milestone's, for milestone's reasons: create
 * and edit are cheap and reversible (member), and even deletion is member —
 * ON DELETE SET NULL un-files an epic's tasks and milestones without taking work
 * with it, so there is no blast radius for admin to gate.
 */

const EPIC_COLUMNS = `e.id, e.board_id AS "boardId", e.name, e.status,
                      e.owner_id AS "ownerId", u.name AS "ownerName",
                      e.created_at AS "createdAt"`;

/**
 * total/done ride every read — the dialog's progress bar is the feature. An
 * epic's tasks are the union of two sets: tasks filed on the epic directly, and
 * tasks whose milestone is filed under the epic (031's "above the milestone"
 * rollup). A task counted through both paths is still one task — the OR yields it
 * once — so no DISTINCT is needed.
 */
const PROGRESS_COLUMNS = `
  (SELECT COUNT(*)::int FROM task t
    WHERE t.parent_id IS NULL
      AND (t.epic_id = e.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS total,
  (SELECT COUNT(*)::int FROM task t
     JOIN board b ON b.id = e.board_id
    WHERE t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id
      AND (t.epic_id = e.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS done`;

/**
 * The window an epic reports (089) — derived here rather than stored, which is
 * how 031's "an epic has no date of its own" and "when is Billing happening?"
 * both stay true. Same task set as the progress columns, so a task that reaches
 * the epic through a milestone dates it too.
 *
 * The target takes the later of two maxima: the epic's tasks' due dates, and its
 * member milestones' own. A milestone dated for August with nothing broken down
 * under it yet is the ordinary state of a plan, and reading only tasks would
 * report that epic as undated. GREATEST is right rather than merely convenient
 * here: Postgres's GREATEST skips nulls and yields null only when every argument
 * is null, which is exactly "undated until something inside carries a date".
 */
const WINDOW_COLUMNS = `
  (SELECT MIN(t.start_date) FROM task t
    WHERE t.parent_id IS NULL
      AND (t.epic_id = e.id
           OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))) AS "startDate",
  GREATEST(
    (SELECT MAX(t.due_date) FROM task t
      WHERE t.parent_id IS NULL
        AND (t.epic_id = e.id
             OR t.milestone_id IN (SELECT id FROM milestone WHERE epic_id = e.id))),
    (SELECT MAX(m.due_date) FROM milestone m WHERE m.epic_id = e.id)
  ) AS "targetDate"`;

/**
 * The whole epic read, joined to its owner — exported because getBoard rides
 * epics along for the task dialog's picker (031) and had been carrying its own
 * copy of this SQL. Two copies of a derived read is how one of them comes to
 * report a different total from the other; there is one now.
 *
 * LEFT, so an epic whose owner was deleted still lists, with a null name — the
 * comment feed's rule for a departed author (024).
 */
export const EPIC_SELECT = `SELECT ${EPIC_COLUMNS}, ${PROGRESS_COLUMNS}, ${WINDOW_COLUMNS}
       FROM epic e
       LEFT JOIN "user" u ON u.id = e.owner_id`;

function snapshot(epic: Epic): EpicSnapshot {
  return {
    epicId: epic.id,
    name: epic.name,
    status: epic.status,
    ownerId: epic.ownerId,
  };
}

async function selectEpic(
  client: PoolClient,
  id: number
): Promise<Epic | undefined> {
  const { rows } = await client.query<Epic>(`${EPIC_SELECT} WHERE e.id = $1`, [
    id,
  ]);
  return rows[0];
}

/**
 * An epic's owner is a member of the epic's own workspace — the invariant 089's
 * foreign key cannot express, and assertAssignable (004) states one table over
 * for the same reason: the FK only proves the user exists *somewhere*, so
 * without this any user id in the database could be painted onto a stranger's
 * board. "not_found" rather than "forbidden" for the anti-enumeration reason
 * those checks already establish — "no such user" and "that user is in someone
 * else's workspace" must be indistinguishable.
 *
 * Any member may own one, viewers included: owning an outcome and being allowed
 * to move cards are different things, which is the separation assignment
 * already draws.
 */
async function assertOwnerIsMember(
  client: PoolClient,
  workspaceId: string,
  ownerId: string
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, ownerId]
  );
  if (rows.length === 0) throw notAMember();
}

function notAMember() {
  return new AuthzError(
    "not_found",
    "That person is not a member of this workspace"
  );
}

/**
 * The same check outside a transaction, for the Door 2 handlers to run *before*
 * a proposal is held (§7.4's `authorize` hook). Without it an agent naming an
 * owner it cannot see gets a queued proposal that throws when a human accepts
 * it — and a throw mid-review abandons the rest of that changeset, so one bad
 * proposal would poison a batch of good ones. Refuse at the door instead.
 */
export async function assertOwnerAssignable(
  workspaceId: string,
  ownerId: string
): Promise<void> {
  const row = await queryOne(
    `SELECT 1 AS ok FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, ownerId]
  );
  if (!row) throw notAMember();
}

export async function listEpics(
  actor: string | Principal,
  boardId: number
): Promise<Epic[]> {
  await requireBoardRole(actor, boardId, "viewer");
  // By name, not by date: an epic's window is derived from its contents (089),
  // so ordering on it would reshuffle the list whenever a task inside moved.
  // A stable alphabetical list is the scannable one; id breaks ties.
  return query<Epic>(`${EPIC_SELECT} WHERE e.board_id = $1 ORDER BY e.name, e.id`, [
    boardId,
  ]);
}

export async function createEpic(
  actor: string | Principal,
  boardId: number,
  input: CreateEpicInput,
  by: Actor
): Promise<Epic> {
  const { workspaceId } = await requireBoardRole(actor, boardId, "member");

  return withTransaction(async (client) => {
    if (input.ownerId != null)
      await assertOwnerIsMember(client, workspaceId, input.ownerId);

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO epic (board_id, name, status, owner_id)
       VALUES ($1, $2, COALESCE($3, 'active'), $4) RETURNING id`,
      [boardId, input.name, input.status ?? null, input.ownerId ?? null]
    );
    const epic = (await selectEpic(client, rows[0].id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "epic.created",
      after: snapshot(epic),
    });
    return epic;
  });
}

/**
 * Enforces the invariant 031 states but a bare foreign key cannot: a task or a
 * milestone is filed only under an epic of its *own board*. The FK proves the
 * epic exists somewhere; without this, any epic id in the database could be
 * written onto any task — assertMilestoneOnBoard's cross-tenant reference, one
 * table over. "not_found" for the same anti-enumeration reason. Exported because
 * both the tasks repository and the milestones repository file against an epic.
 */
export async function assertEpicOnBoard(
  client: PoolClient,
  boardId: number,
  epicId: number
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM epic WHERE id = $1 AND board_id = $2`,
    [epicId, boardId]
  );
  if (rows.length === 0) {
    throw new AuthzError("not_found", "That epic is not on this board");
  }
}

/**
 * Resolves the epic's own board — the one-join not_found rule. Exported so the
 * Door 2 edit handler can run the same check before holding a proposal: an
 * agent that cannot write this board should be refused now, not after a human
 * has read and accepted its proposal.
 */
export async function requireEpic(
  actor: string | Principal,
  id: number
): Promise<{ boardId: number; workspaceId: string }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM epic WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Epic not found");
  const { workspaceId } = await requireBoardRole(actor, row.boardId, "member");
  return { boardId: row.boardId, workspaceId };
}

export async function updateEpic(
  actor: string | Principal,
  id: number,
  input: UpdateEpicInput,
  by: Actor
): Promise<Epic | undefined> {
  const { boardId, workspaceId } = await requireEpic(actor, id);

  return withTransaction(async (client) => {
    const before = await selectEpic(client, id);
    if (!before) return undefined;

    // The no-op rule 031 established, now that there are three fields to say
    // nothing about: saving a form unchanged is the commonest edit there is and
    // must not add a row to a feed people read to see what changed. Absent and
    // "same as it already was" are the same non-edit. ownerId is three-valued —
    // undefined leaves the owner, null clears it (the milestone dueDate rule).
    const name = input.name ?? before.name;
    const status = input.status ?? before.status;
    const ownerId =
      input.ownerId === undefined ? before.ownerId : input.ownerId;
    if (
      name === before.name &&
      status === before.status &&
      ownerId === before.ownerId
    )
      return before;

    if (ownerId != null && ownerId !== before.ownerId)
      await assertOwnerIsMember(client, workspaceId, ownerId);

    await client.query(
      `UPDATE epic SET name = $2, status = $3, owner_id = $4 WHERE id = $1`,
      [id, name, status, ownerId]
    );
    const after = (await selectEpic(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "epic.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Deletion un-files, never destroys: 031's two SET NULL FKs clear epic_id on
 * every task and every milestone that pointed here, which is why member suffices
 * — the work and its history are untouched, only the grouping is gone.
 */
export async function deleteEpic(
  actor: string | Principal,
  id: number,
  by: Actor
): Promise<boolean> {
  const { boardId, workspaceId } = await requireEpic(actor, id);

  return withTransaction(async (client) => {
    const before = await selectEpic(client, id);
    if (!before) return false;

    await client.query(`DELETE FROM epic WHERE id = $1`, [id]);

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "epic.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
