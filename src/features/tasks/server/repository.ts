import type { PoolClient } from "pg";

import { queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, TaskSnapshot } from "@/features/activity/types";
import {
  AuthzError,
  requireColumnRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import type {
  CreateTaskInput,
  MoveTaskInput,
  Task,
  UpdateTaskInput,
} from "../types";

// Postgres folds unquoted identifiers to lowercase, so `AS columnId` would
// arrive as `columnid`. The double quotes are load-bearing.
//
// due_date needs no cast or to_char: shared/db/client.ts parses DATE to the raw
// 'YYYY-MM-DD' string globally, which is what keeps a due date from becoming a
// JS Date at the one boundary where that silently changes the day.
const TASK_COLUMNS = `id, column_id AS "columnId", title, description, position,
                      assignee_id AS "assigneeId", priority,
                      due_date AS "dueDate", created_at AS "createdAt"`;

function selectTask(client: PoolClient, id: number) {
  return client
    .query<Task>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = $1`, [id])
    .then((r) => r.rows[0]);
}

/** Every caller here is a signed-in person; agents become actors at M2. */
function human(userId: string): Actor {
  return { type: "human", id: userId };
}

function snapshot(task: Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description,
    columnId: task.columnId,
    position: task.position,
    assigneeId: task.assigneeId,
    priority: task.priority,
    dueDate: task.dueDate,
  };
}

/**
 * The comparisons below exist so a write only logs what it actually changed. A
 * no-op is not a mutation: the dialog PATCHes on close whether or not anything
 * was edited, so without these the history fills with entries whose before and
 * after are identical. That is not pedantry — at M2 undo replays these rows, and
 * the inverse of "nothing changed" is a confusing no-op the user has to reason
 * about. Cheap to skip now, impossible to clean up later on an append-only
 * table.
 *
 * They are split by *concern* rather than being one whole-snapshot equality
 * check, because one PATCH can change a task's details, its assignee, its
 * priority and its due date at once — and those are four events, logged as four
 * rows, invertible separately. The partition is the same one ActivityAction
 * draws, and for the same reason: each of these is a thing someone would want to
 * undo without undoing the others.
 */
function sameDetails(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.title === b.title && a.description === b.description;
}

function samePlacement(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.columnId === b.columnId && a.position === b.position;
}

function sameAssignee(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.assigneeId === b.assigneeId;
}

function samePriority(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.priority === b.priority;
}

function sameDueDate(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.dueDate === b.dueDate;
}

/**
 * Enforces the invariant 004_assignee.sql documents but cannot express: a task's
 * assignee is a member of that task's workspace. The foreign key only proves the
 * user exists somewhere; without this, any user id in the database could be
 * written onto any board — a cross-tenant reference that would render a
 * stranger's name and avatar to everyone in the workspace.
 *
 * "not_found", not "forbidden", following the rule the authz checks already
 * establish: "there is no such user" and "that user is in someone else's
 * workspace" must be indistinguishable, or the id space becomes an oracle for
 * enumerating who exists.
 *
 * Any member may be assigned, viewers included. A viewer cannot move the card
 * they have been handed, which looks like a bug and is not one: assignment says
 * whose work it is, and roles say who may edit the board. A stakeholder who owns
 * an outcome without touching the board is a real arrangement, and the two
 * concepts are worth keeping apart — especially before M2, where an agent's
 * permissions are likewise separate from what it has been handed.
 */
async function assertAssignable(
  client: PoolClient,
  workspaceId: string,
  assigneeId: string
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, assigneeId]
  );
  if (rows.length === 0) {
    throw new AuthzError(
      "not_found",
      "That person is not a member of this workspace"
    );
  }
}

export async function getTask(
  userId: string,
  id: number
): Promise<Task | undefined> {
  await requireTaskRole(userId, id, "viewer");
  return queryOne<Task>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = $1`, [id]);
}

export async function createTask(
  userId: string,
  input: CreateTaskInput
): Promise<Task> {
  const { boardId, workspaceId } = await requireColumnRole(
    userId,
    input.columnId,
    "member"
  );

  // Now a transaction: the insert and its log entry must land together, or a
  // crash between them leaves a task nobody can prove the creation of.
  return withTransaction(async (client) => {
    if (input.assigneeId != null) {
      await assertAssignable(client, workspaceId, input.assigneeId);
    }

    // priority falls back to 'none' rather than being left to the column
    // default, so the INSERT states the value it means. due_date has no such
    // fallback to state: null is the value.
    const { rows } = await client.query<Task>(
      `INSERT INTO task (column_id, title, description, position, assignee_id,
                         priority, due_date)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(position) + 1, 0) FROM task WHERE column_id = $1),
               $4, $5, $6)
       RETURNING ${TASK_COLUMNS}`,
      [
        input.columnId,
        input.title,
        input.description ?? "",
        input.assigneeId ?? null,
        input.priority ?? "none",
        input.dueDate ?? null,
      ]
    );
    const task = rows[0];

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: task.id,
      actor: human(userId),
      action: "task.created",
      // No `before`: the task did not exist. Undo inverts this to a delete.
      after: snapshot(task),
    });
    return task;
  });
}

export async function updateTask(
  userId: string,
  id: number,
  input: UpdateTaskInput
): Promise<Task | undefined> {
  const { boardId, workspaceId } = await requireTaskRole(userId, id, "member");

  // `in`, not a null check — the distinction is the whole point. `undefined`
  // means the caller said nothing about the assignee; `null` means the caller
  // said "unassign". Collapsing them would make unassigning impossible.
  //
  // due_date needs the same treatment for the same reason (clearing a date is
  // setting null), and priority conspicuously does not: clearing a priority is
  // setting 'none', so null keeps its ordinary meaning of "absent" there.
  const setsAssignee = "assigneeId" in input;
  const setsDueDate = "dueDate" in input;

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return undefined;

    if (setsAssignee && input.assigneeId != null) {
      await assertAssignable(client, workspaceId, input.assigneeId);
    }

    // Both idioms appear below, and which one a field gets is not a style
    // choice — it follows from whether the field has a non-null value meaning
    // "empty".
    //
    // COALESCE reads null as "not supplied", so it is correct exactly when null
    // cannot be a value the caller wants to write. That holds for title and
    // description (not nullable), and for priority (nullable in neither the
    // column nor the intent — 'none' is how you clear it).
    //
    // assignee_id and due_date have no such value: null IS the cleared state.
    // COALESCE would silently turn every unassign and every date-clear into a
    // no-op. Hence the explicit supplied-flag, which is the one thing COALESCE
    // cannot encode.
    const { rows } = await client.query<Task>(
      `UPDATE task
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              assignee_id = CASE WHEN $4::boolean
                                 THEN $5::text
                                 ELSE assignee_id END,
              priority = COALESCE($6::task_priority, priority),
              due_date = CASE WHEN $7::boolean
                              THEN $8::date
                              ELSE due_date END
        WHERE id = $1
        RETURNING ${TASK_COLUMNS}`,
      [
        id,
        input.title ?? null,
        input.description ?? null,
        setsAssignee,
        input.assigneeId ?? null,
        input.priority ?? null,
        setsDueDate,
        input.dueDate ?? null,
      ]
    );
    const after = rows[0];

    // A row per concern that actually changed, not one per PATCH. The dialog can
    // rename a task, reassign it, prioritize it and date it in one submit, and
    // those are four events: the feed reads better for it, and undo can revert
    // any one without reverting the others. Each row carries the full snapshot —
    // as task.moved already does — so `action` names which fields the entry is
    // *about* while the snapshots say what the whole task looked like on either
    // side.
    //
    // This is also the shape M2's changeset review needs. An agent that triages
    // a bug sets a priority and comments its reasoning; a reviewer accepting the
    // former while rejecting the latter needs them to be separate rows, and no
    // amount of diffing a single task.updated snapshot recovers that.
    const [from, to] = [snapshot(before), snapshot(after)];

    if (!sameDetails(from, to)) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.updated",
        before: from,
        after: to,
      });
    }

    if (!sameAssignee(from, to)) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.assigned",
        before: from,
        after: to,
      });
    }

    if (!samePriority(from, to)) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.prioritized",
        before: from,
        after: to,
      });
    }

    if (!sameDueDate(from, to)) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.scheduled",
        before: from,
        after: to,
      });
    }
    return after;
  });
}

export async function moveTask(
  userId: string,
  id: number,
  input: MoveTaskInput
): Promise<Task | undefined> {
  const { boardId, workspaceId } = await requireTaskRole(userId, id, "member");
  const target = await requireColumnRole(userId, input.columnId, "member");

  // Both checks above only prove the caller can touch each side. Without this
  // equality the API would happily move a task into a column of another board
  // the caller also belongs to — and, once workspaces are shared, across the
  // tenancy boundary itself.
  if (target.boardId !== boardId) {
    throw new AuthzError(
      "forbidden",
      "Cannot move a task to a column on a different board"
    );
  }

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return undefined;

    // Close the gap the task leaves behind in its source column.
    await client.query(
      "UPDATE task SET position = position - 1 WHERE column_id = $1 AND position > $2",
      [before.columnId, before.position]
    );

    // Clamp the target position to the end of the destination column.
    // COUNT(*) is bigint, which pg returns as a *string* — ::int keeps the
    // Math.min below doing arithmetic rather than string comparison.
    const { rows } = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM task WHERE column_id = $1 AND id <> $2`,
      [input.columnId, id]
    );
    const position = Math.max(0, Math.min(input.position, rows[0].count));

    // Make room at the target position.
    await client.query(
      `UPDATE task SET position = position + 1
        WHERE column_id = $1 AND position >= $2 AND id <> $3`,
      [input.columnId, position, id]
    );

    await client.query(
      "UPDATE task SET column_id = $1, position = $2 WHERE id = $3",
      [input.columnId, position, id]
    );
    const after = await selectTask(client, id);

    // Only the moved task is logged, not the siblings whose positions shifted
    // to accommodate it. Those are consequences of this action, not actions
    // anyone took — logging them would bury the real event under bookkeeping,
    // and undo replays the move, which reproduces the shifts anyway.
    if (after && !samePlacement(snapshot(before), snapshot(after))) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: human(userId),
        action: "task.moved",
        before: snapshot(before),
        after: snapshot(after),
      });
    }
    return after;
  });
}

/**
 * Clears one person's assignments across a workspace, logging each.
 *
 * assertAssignable keeps a non-member from *becoming* an assignee, but says
 * nothing about rows that already exist — and membership is revocable. Without
 * this, removing someone leaves their name and avatar on cards in a workspace
 * they can no longer see, and the invariant 004_assignee.sql states holds only
 * for tasks assigned after the fact. An invariant enforced on the way in and
 * abandoned on the way out is not an invariant.
 *
 * Takes the caller's transaction client rather than opening its own, for the
 * same reason logActivity does: these unassignments must commit with the
 * membership deletion that caused them. A crash between the two would leave
 * exactly the orphaned state this exists to prevent.
 *
 * One log row per task, not one summarizing the batch. The M1 criterion is that
 * every mutation is attributable and revertible, and a single "unassigned 12
 * tasks" row is neither — undo needs to know which task went from whom to null,
 * and a task's own history is the only place its reader will look.
 */
export async function unassignFromWorkspace(
  client: PoolClient,
  workspaceId: string,
  assigneeId: string,
  actor: Actor
): Promise<number> {
  // TASK_COLUMNS is unqualified, and `id` is ambiguous across this join — task,
  // board_column and board all have one. Hence the explicit t. prefixes rather
  // than the shared constant.
  //
  // Every column snapshot() reads has to be listed here, including the ones this
  // function never touches: the rows below become `before`/`after` on an
  // append-only table, and a field missing from this SELECT would land as
  // undefined in JSONB — indistinguishable, forever, from "written before 006".
  // That is the failure this list exists to prevent, and the reason it is worth
  // the duplication of TASK_COLUMNS rather than a partial select.
  const { rows } = await client.query<Task & { boardId: number }>(
    `SELECT t.id, t.column_id AS "columnId", t.title, t.description, t.position,
            t.assignee_id AS "assigneeId", t.priority, t.due_date AS "dueDate",
            t.created_at AS "createdAt",
            bc.board_id AS "boardId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
      WHERE b.workspace_id = $1 AND t.assignee_id = $2`,
    [workspaceId, assigneeId]
  );
  if (rows.length === 0) return 0;

  await client.query(
    `UPDATE task SET assignee_id = NULL WHERE id = ANY($1::int[])`,
    [rows.map((t) => t.id)]
  );

  for (const task of rows) {
    await logActivity(client, {
      workspaceId,
      boardId: task.boardId,
      taskId: task.id,
      actor,
      action: "task.assigned",
      before: snapshot(task),
      after: { ...snapshot(task), assigneeId: null },
    });
  }
  return rows.length;
}

export async function deleteTask(userId: string, id: number): Promise<boolean> {
  const { boardId, workspaceId } = await requireTaskRole(userId, id, "member");

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return false;

    await client.query("DELETE FROM task WHERE id = $1", [id]);
    await client.query(
      "UPDATE task SET position = position - 1 WHERE column_id = $1 AND position > $2",
      [before.columnId, before.position]
    );

    // Logged after the DELETE, and it survives it: activity_log.task_id carries
    // no foreign key precisely so the record of a deletion outlives its subject.
    // `before` is the whole task, which is what undo needs to recreate it.
    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: id,
      actor: human(userId),
      action: "task.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
