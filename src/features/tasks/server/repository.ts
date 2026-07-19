import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, TaskSnapshot } from "@/features/activity/types";
import {
  asPrincipal,
  principalActor,
} from "@/features/auth/server/principal";
import type { Principal } from "@/features/auth/server/principal";
import {
  assertLabelsInWorkspace,
  setTaskLabels,
} from "@/features/labels/server/repository";
import { dispatchRun, enqueueRun } from "@/features/agents/server/runtime";
import {
  AuthzError,
  ROLE_RANK,
  requireColumnRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import { taskColumns, taskSnapshot } from "./task-row";
import type {
  CreateTaskInput,
  MoveTaskInput,
  RecurrenceFrequency,
  Task,
  UpdateTaskInput,
} from "../types";

export { taskColumns };

const TASK_COLUMNS = taskColumns();

function selectTask(client: PoolClient, id: number) {
  return client
    .query<Task>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = $1`, [id])
    .then((r) => r.rows[0]);
}

const snapshot = taskSnapshot;

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
  // type and estimate (022) ride under task.updated rather than earning actions
  // of their own: neither is a changeset unit any milestone reviews separately,
  // and 006's test — an action exists when its inverse is something someone
  // would want to apply on its own — has no taker for "un-retype" apart from
  // "revert the edit".
  return (
    a.title === b.title &&
    a.description === b.description &&
    (a.type ?? "task") === (b.type ?? "task") &&
    (a.estimate ?? null) === (b.estimate ?? null)
  );
}

function samePlacement(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.columnId === b.columnId && a.position === b.position;
}

function sameAssignee(a: TaskSnapshot, b: TaskSnapshot): boolean {
  const [x, y] = [a.assignee ?? null, b.assignee ?? null];
  if (x === null || y === null) return x === y;
  // sameActor (defined below with the claim helpers) compares type and id, so a
  // human and an agent that happened to share an id string never read as equal —
  // the type is half the identity. This is what makes reassignment from a person
  // to an agent register as a change rather than a no-op.
  return sameActor(x, y);
}

function samePriority(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.priority === b.priority;
}

function sameDueDate(a: TaskSnapshot, b: TaskSnapshot): boolean {
  return a.dueDate === b.dueDate;
}

/**
 * A set comparison, not an array one. Both sides come back ordered by id from
 * taskColumns, so a positional compare would work today — but it would be true
 * by luck, and the luck runs out the moment someone changes that ORDER BY or
 * sorts the picker's output. Comparing ids as a set says what is meant: the
 * question is whether the task wears the same labels, not whether two arrays
 * happen to agree element by element.
 *
 * Names are ignored deliberately. A rename changes every task's `labels`, and
 * the tasks did not change — the vocabulary did. Comparing names here would log
 * a task.labeled row per card on every rename, which is the bookkeeping
 * label.updated exists to avoid.
 */
function sameLabels(a: TaskSnapshot, b: TaskSnapshot): boolean {
  const ids = (s: TaskSnapshot) => (s.labels ?? []).map((l) => l.id).sort();
  const [x, y] = [ids(a), ids(b)];
  return x.length === y.length && x.every((id, i) => id === y[i]);
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
 * concepts are worth keeping apart — and it is exactly the separation M2 needs
 * for agents: what an agent has been handed is not what it is permitted to do.
 *
 * One function, two principals (011). A human's membership is an edge in
 * workspace_member; an agent's is its own row scoped to one workspace (009). The
 * "not_found" answer is the same for both, and for the same anti-enumeration
 * reason: "there is no such principal" and "that principal is in another
 * workspace" must be indistinguishable, or the id space becomes an oracle.
 */
async function assertAssignable(
  client: PoolClient,
  workspaceId: string,
  assignee: Actor
): Promise<void> {
  const { rows } =
    assignee.type === "human"
      ? await client.query(
          `SELECT 1 FROM workspace_member WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, assignee.id]
        )
      : await client.query(
          `SELECT 1 FROM agent WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, assignee.id]
        );
  if (rows.length === 0) {
    throw new AuthzError(
      "not_found",
      assignee.type === "human"
        ? "That person is not a member of this workspace"
        : "That agent is not part of this workspace"
    );
  }
}

/**
 * An Actor split into the two peer columns 011 stores it across — the human id in
 * assignee_id, the agent id in agent_id, and always exactly one (or neither) set.
 * Setting one clears the other by construction, which is what keeps the
 * task_one_assignee CHECK (011) satisfied without any writer having to remember
 * to null the peer.
 */
function assigneeColumns(assignee: Actor | null): {
  assigneeId: string | null;
  agentId: string | null;
} {
  if (!assignee) return { assigneeId: null, agentId: null };
  return assignee.type === "human"
    ? { assigneeId: assignee.id, agentId: null }
    : { assigneeId: null, agentId: assignee.id };
}

/**
 * How far a due date jumps for each cadence (020). Postgres interval arithmetic
 * does the hard part — `date + interval '1 month'` clamps Jan 31 to Feb 28
 * rather than rolling into March, which is the behaviour a monthly recurrence
 * wants and which no hand-rolled day count gets right.
 */
const RECURRENCE_INTERVAL: Record<RecurrenceFrequency, string> = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "1 month",
};

/**
 * Sets or clears a task's recurrence rule. null removes it (this task no longer
 * recurs); a frequency upserts it, so setting a rule twice lands on one row —
 * the 1:1 (task_id PK) the migration relies on.
 */
async function setRecurrence(
  client: PoolClient,
  taskId: number,
  frequency: RecurrenceFrequency | null
): Promise<void> {
  if (frequency === null) {
    await client.query(`DELETE FROM task_recurrence WHERE task_id = $1`, [taskId]);
    return;
  }
  await client.query(
    `INSERT INTO task_recurrence (task_id, frequency) VALUES ($1, $2)
     ON CONFLICT (task_id) DO UPDATE SET frequency = EXCLUDED.frequency`,
    [taskId, frequency]
  );
}

/**
 * Births the next occurrence of a recurring task, called when its predecessor
 * crosses into the board's done column (020, moveTask).
 *
 * The successor is a copy of the completed task's shape — title, description,
 * priority, assignee, labels — in the board's first column, with its due date
 * advanced by the rule (or no due date, if the original had none: recurrence
 * without a date just means "make another"). The rule *moves* here from the
 * predecessor, which is the invariant that stops a double-spawn: the completed
 * task in Done no longer recurs, so dragging it around does nothing, and this new
 * row is the only one that will recur next.
 *
 * Inline on the caller's transaction rather than a call to createTask, which owns
 * its own transaction — the copy and the hand-over of the rule must commit with
 * the move that triggered them. It logs task.created for the successor, the one
 * event a reader or an undo wants; the completion itself is the move, already
 * logged. No agent run is enqueued even for an agent-assigned copy: a spawn is a
 * copy, not an assignment, and firing runs off recurrence is future work.
 */
async function spawnNextOccurrence(
  client: PoolClient,
  before: Task,
  frequency: RecurrenceFrequency,
  boardId: number,
  workspaceId: string,
  by: Actor
): Promise<void> {
  const { rows: cols } = await client.query<{ id: number }>(
    `SELECT id FROM board_column WHERE board_id = $1 ORDER BY position, id LIMIT 1`,
    [boardId]
  );
  const firstColumnId = cols[0]?.id;
  if (!firstColumnId) return; // A board with no columns cannot hold a successor.

  const { assigneeId, agentId } = assigneeColumns(before.assignee);
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO task (column_id, title, description, position, assignee_id,
                       agent_id, priority, type, estimate, due_date)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(position) + 1, 0) FROM task
               WHERE column_id = $1 AND parent_id IS NULL),
             $4, $5, $6, $7, $8,
             CASE WHEN $9::date IS NULL THEN NULL
                  ELSE ($9::date + $10::interval)::date END)
     RETURNING id`,
    [
      firstColumnId,
      before.title,
      before.description,
      assigneeId,
      agentId,
      before.priority,
      before.type,
      before.estimate,
      before.dueDate,
      RECURRENCE_INTERVAL[frequency],
    ]
  );
  const newId = rows[0].id;

  await setTaskLabels(client, newId, before.labels.map((l) => l.id));
  // Hand the rule across: off the completed task, onto the successor.
  await setRecurrence(client, before.id, null);
  await setRecurrence(client, newId, frequency);

  const created = (await selectTask(client, newId))!;
  await logActivity(client, {
    workspaceId,
    boardId,
    taskId: newId,
    actor: by,
    action: "task.created",
    after: snapshot(created),
  });
}

/**
 * Enforces the two rules 008 states but cannot express — that a subtask sits on
 * its parent's board, and that a subtask has no subtasks of its own.
 *
 * The authz check is requireTaskRole rather than a hand-written lookup, and that
 * is what makes the 404-vs-403 split come out right without restating it. A
 * parent in another workspace is "not_found" — the id space must not become an
 * oracle. A parent on another board of a workspace the caller *does* belong to is
 * "forbidden", which leaks nothing they cannot already see. That is exactly
 * moveTask's pair of checks, one level out, and for the same reason: an authz
 * check proves the caller may touch each side, never that the two sides belong
 * together.
 *
 * "member", not "viewer": creating a subtask is a board mutation, so the rank is
 * the one createTask already demanded of the column. A viewer being handed a
 * piece is 004's rule and a different question — that is assignment, not
 * authorship.
 *
 * The depth check needs no lock, and the absence is the interesting part. 007's
 * column guard had to take FOR UPDATE because it counted rows and a count changes
 * underneath you. This reads parent_id, which 008's trigger makes immutable — so
 * the answer is permanent the instant it is read, and there is no window to
 * close. The invariant is held by the value not moving rather than by us holding
 * it still.
 *
 * "conflict", not "forbidden": the caller is allowed to attempt this, and the
 * refusal is an invariant rather than a permission. The same distinction
 * members.ts draws for the last owner and columns.ts for a populated column.
 */
async function assertDecomposable(
  client: PoolClient,
  actor: string | Principal,
  parentId: number,
  boardId: number
): Promise<void> {
  const parent = await requireTaskRole(actor, parentId, "member");
  if (parent.boardId !== boardId) {
    throw new AuthzError(
      "forbidden",
      "A subtask must be on the same board as its task"
    );
  }

  const { rows } = await client.query<{ parentId: number | null }>(
    `SELECT parent_id AS "parentId" FROM task WHERE id = $1`,
    [parentId]
  );
  // rows[0] exists: requireTaskRole just resolved this task through three joins.
  if (rows[0].parentId !== null) {
    throw new AuthzError(
      "conflict",
      "A subtask cannot have subtasks of its own"
    );
  }
}

export async function getTask(
  actor: string | Principal,
  id: number
): Promise<Task | undefined> {
  await requireTaskRole(actor, id, "viewer");
  return queryOne<Task>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = $1`, [id]);
}

/**
 * A task's subtasks, grouped by status in the board's own column order.
 *
 * "viewer", matching getTask: reading a task's pieces is reading the task.
 *
 * Ordered by the column's position rather than the subtask's alone, because a
 * piece's position is scoped to (column_id, parent_id) — so three pieces spread
 * across three columns are each at position 0, and ordering by position alone
 * would interleave them arbitrarily. Sorting by the column first groups the
 * pieces by status in the same left-to-right order the board shows, which is the
 * order the reader already has in their head. `bc.id` breaks ties for the same
 * reason getBoard's column read does.
 *
 * Fetched per dialog rather than ridden along on getBoard, which is the shape
 * comments already established. The board renders a count; the pieces are a
 * second board's worth of rows that nobody is looking at until they open one.
 */
export async function listSubtasks(
  actor: string | Principal,
  taskId: number
): Promise<Task[]> {
  await requireTaskRole(actor, taskId, "viewer");
  return query<Task>(
    `SELECT ${taskColumns("t")}
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
      WHERE t.parent_id = $1
      ORDER BY bc.position, bc.id, t.position`,
    [taskId]
  );
}

export async function createTask(
  actor: string | Principal,
  input: CreateTaskInput
): Promise<Task> {
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId } = await requireColumnRole(
    actor,
    input.columnId,
    "member"
  );

  // Now a transaction: the insert and its log entry must land together, or a
  // crash between them leaves a task nobody can prove the creation of.
  return withTransaction(async (client) => {
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      await assertDecomposable(client, actor, parentId, boardId);
    }
    if (input.assignee != null) {
      await assertAssignable(client, workspaceId, input.assignee);
    }
    if (input.labelIds?.length) {
      await assertLabelsInWorkspace(client, workspaceId, input.labelIds);
    }

    // priority falls back to 'none' rather than being left to the column
    // default, so the INSERT states the value it means. due_date has no such
    // fallback to state: null is the value.
    //
    // The position subquery is scoped to (column_id, parent_id), which is what
    // 008 generalized position to mean — the order among the tasks this one
    // renders beside. Without the parent clause a subtask would take the next
    // position in the *column*, leaving a hole the board renders as a gap and
    // the drag maths reads as a card that is not there.
    //
    // IS NOT DISTINCT FROM, not `=`: parent_id is NULL for every top-level task,
    // and `NULL = NULL` is NULL, so `=` would match no rows and hand every
    // top-level task position 0. That is the ordinary path, so it would be a bug
    // in every board rather than only in subtasks — which is why the operator is
    // worth naming rather than pattern-matching from the query above it.
    // The two peer columns from one Actor (011). assigneeColumns clears whichever
    // the assignee is not, so the task_one_assignee CHECK holds by construction.
    const { assigneeId, agentId } = assigneeColumns(input.assignee ?? null);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO task (column_id, title, description, position, assignee_id,
                         agent_id, priority, type, estimate, due_date, parent_id)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(position) + 1, 0) FROM task
                 WHERE column_id = $1 AND parent_id IS NOT DISTINCT FROM $10),
               $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.columnId,
        input.title,
        input.description ?? "",
        assigneeId,
        agentId,
        input.priority ?? "none",
        // 'task' stated rather than left to the column default, priority's
        // reason: the INSERT says the value it means. estimate has no such
        // fallback to state: null is the value.
        input.type ?? "task",
        input.estimate ?? null,
        input.dueDate ?? null,
        parentId,
      ]
    );

    // The labels have to be linked before the task is read back, because
    // taskColumns resolves them with a subquery — RETURNING on the INSERT would
    // report a task with no labels no matter what was asked for, and both the
    // caller and the log row below would believe it.
    await setTaskLabels(client, rows[0].id, input.labelIds ?? []);
    // Before the read-back, so the returned task's `recurrence` reflects it —
    // task_recurrence is resolved by a subquery, so RETURNING would report none.
    // Only a frequency writes a row; null/absent means the task does not recur.
    if (input.recurrence) {
      await setRecurrence(client, rows[0].id, input.recurrence);
    }
    const task = (await selectTask(client, rows[0].id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: task.id,
      actor: by,
      action: "task.created",
      // No `before`: the task did not exist. Undo inverts this to a delete.
      after: snapshot(task),
    });
    // A task created with labels logs task.created only. The labels are part of
    // what was created, not a change to it — there is no `before` for them to
    // differ from, and a task.labeled row here would invert to "remove the
    // labels from a task that no longer exists".
    //
    // Creating a subtask logs task.created too, with no new action beside it, and
    // 006's rule is what says so without a fresh argument: an action exists when
    // its inverse is something someone would want to apply on its own. The
    // inverse of "created a piece of this" is "delete that piece" — which is
    // task.deleted, already here. `after.parentId` is what makes the row say it
    // was a piece, which is all a reader or an undo needs. A `task.decomposed`
    // would be task.created spelled twice.
    return task;
  });
}

export async function updateTask(
  actor: string | Principal,
  id: number,
  input: UpdateTaskInput
): Promise<Task | undefined> {
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId } = await requireTaskRole(actor, id, "member");

  // `in`, not a null check — the distinction is the whole point. `undefined`
  // means the caller said nothing about the assignee; `null` means the caller
  // said "unassign". Collapsing them would make unassigning impossible.
  //
  // due_date needs the same treatment for the same reason (clearing a date is
  // setting null), and priority conspicuously does not: clearing a priority is
  // setting 'none', so null keeps its ordinary meaning of "absent" there.
  const setsAssignee = "assignee" in input;
  const setsDueDate = "dueDate" in input;
  // Three-valued like dueDate (022): null clears the estimate, a number sets
  // it, absent leaves it — 0 is an estimate, so no COALESCE sentinel exists.
  const setsEstimate = "estimate" in input;
  // Three-valued like the two above: the key's presence, not the value, decides
  // whether the rule is touched — null clears it, a frequency sets it, absent
  // leaves it. There is no frequency meaning "off", so COALESCE cannot serve.
  const setsRecurrence = "recurrence" in input;

  let queuedRunId: string | null = null;
  const updated = await withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return undefined;

    if (setsAssignee && input.assignee != null) {
      await assertAssignable(client, workspaceId, input.assignee);
    }
    if (input.labelIds?.length) {
      await assertLabelsInWorkspace(client, workspaceId, input.labelIds);
    }
    // Before the UPDATE, so `after` reads them back. No supplied-flag: `[]` is
    // "no labels" and undefined is "not supplied", which is 006's rule holding
    // for a third field without needing to be re-derived.
    if (input.labelIds !== undefined) {
      await setTaskLabels(client, id, input.labelIds);
    }
    // Before the UPDATE, so its RETURNING (which resolves recurrence by subquery)
    // reads the new rule back. No log row and no snapshot field — the rule is
    // task config, not state undo reconstructs (020).
    if (setsRecurrence) {
      await setRecurrence(client, id, input.recurrence ?? null);
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
    // assignee and due_date have no such value: null IS the cleared state.
    // COALESCE would silently turn every unassign and every date-clear into a
    // no-op. Hence the explicit supplied-flag, which is the one thing COALESCE
    // cannot encode.
    //
    // The assignee is now two columns behind one supplied-flag (011): the same
    // flag writes both, and assigneeColumns has already cleared whichever the new
    // assignee is not, so a reassignment from a person to an agent nulls
    // assignee_id and sets agent_id in one write and the task_one_assignee CHECK
    // never sees both set. When the flag is false, both columns are left alone.
    const { assigneeId, agentId } = assigneeColumns(input.assignee ?? null);
    const { rows } = await client.query<Task>(
      `UPDATE task
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              assignee_id = CASE WHEN $4::boolean
                                 THEN $5::text
                                 ELSE assignee_id END,
              agent_id = CASE WHEN $4::boolean
                              THEN $6::text
                              ELSE agent_id END,
              priority = COALESCE($7::task_priority, priority),
              type = COALESCE($8::task_type, type),
              estimate = CASE WHEN $9::boolean
                              THEN $10::integer
                              ELSE estimate END,
              due_date = CASE WHEN $11::boolean
                              THEN $12::date
                              ELSE due_date END
        WHERE id = $1
        RETURNING ${TASK_COLUMNS}`,
      [
        id,
        input.title ?? null,
        input.description ?? null,
        setsAssignee,
        assigneeId,
        agentId,
        input.priority ?? null,
        input.type ?? null,
        setsEstimate,
        input.estimate ?? null,
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
        actor: by,
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
        actor: by,
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
        actor: by,
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
        actor: by,
        action: "task.scheduled",
        before: from,
        after: to,
      });
    }

    if (!sameLabels(from, to)) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: id,
        actor: by,
        action: "task.labeled",
        before: from,
        after: to,
      });
    }

    // The trigger seam 011 named: assigning a task to a *native* agent starts a
    // run. Enqueued in this same transaction, right after the task.assigned it
    // follows, so the 'queued' run and the assignment commit together — the run
    // is the durable record that work was requested, not a side effect a crash
    // after commit could drop. enqueueRun returns null for a human or an external
    // agent, which start no native run.
    const newAssignee = to.assignee;
    if (!sameAssignee(from, to) && newAssignee?.type === "agent") {
      queuedRunId = await enqueueRun(client, {
        agentId: newAssignee.id,
        taskId: id,
        workspaceId,
      });
    }
    return after;
  });

  // Off the request path: after() runs executeRun once the response is sent, so
  // this PATCH returns immediately. dispatchRun no-ops outside a request scope
  // (a test, the isolated script), leaving the run queued for the endpoint or a
  // worker to drain — the recoverability that making a run a record buys (017).
  if (queuedRunId) dispatchRun(queuedRunId);
  return updated;
}

export async function moveTask(
  actor: string | Principal,
  id: number,
  input: MoveTaskInput
): Promise<Task | undefined> {
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId } = await requireTaskRole(actor, id, "member");
  const target = await requireColumnRole(actor, input.columnId, "member");

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

    // The board's completion column (020), or null if none is designated —
    // recurrence is inert until an admin names one. Read here so the spawn below
    // can tell whether this move crosses into Done.
    const { rows: boardRows } = await client.query<{ doneColumnId: number | null }>(
      `SELECT done_column_id AS "doneColumnId" FROM board WHERE id = $1`,
      [boardId]
    );
    const doneColumnId = boardRows[0]?.doneColumnId ?? null;

    // Every position query below is scoped to the moving task's siblings — the
    // rows sharing its column AND its parent (008). The parent is not read from
    // the input because it cannot be changed: a task is born a piece of something
    // or is never one, so a move is always within one sibling set, and this value
    // is the same before and after.
    //
    // Unscoped, these three queries shuffle every row in the column, including
    // the subtasks the board cannot see — and the drag silently does the wrong
    // thing. See 008 for the worked case; it is a two-card column and it fails.
    const { parentId } = before;

    // Close the gap the task leaves behind among its siblings.
    await client.query(
      `UPDATE task SET position = position - 1
        WHERE column_id = $1 AND position > $2
          AND parent_id IS NOT DISTINCT FROM $3`,
      [before.columnId, before.position, parentId]
    );

    // Clamp the target position to the end of the destination sibling set.
    // COUNT(*) is bigint, which pg returns as a *string* — ::int keeps the
    // Math.min below doing arithmetic rather than string comparison.
    const { rows } = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM task
        WHERE column_id = $1 AND id <> $2
          AND parent_id IS NOT DISTINCT FROM $3`,
      [input.columnId, id, parentId]
    );
    const position = Math.max(0, Math.min(input.position, rows[0].count));

    // Make room at the target position.
    await client.query(
      `UPDATE task SET position = position + 1
        WHERE column_id = $1 AND position >= $2 AND id <> $3
          AND parent_id IS NOT DISTINCT FROM $4`,
      [input.columnId, position, id, parentId]
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
        actor: by,
        action: "task.moved",
        before: snapshot(before),
        after: snapshot(after),
      });
    }

    // On-complete recurrence (020). A move *crosses into* Done when the task was
    // somewhere else and now sits in the done column — not a reorder within it,
    // which is why both sides are tested. A recurring task that crosses spawns its
    // successor and hands over the rule; a one-off, or a board with no done column
    // (doneColumnId null, so this is never true), does nothing.
    if (
      before.recurrence &&
      doneColumnId !== null &&
      before.columnId !== doneColumnId &&
      input.columnId === doneColumnId
    ) {
      await spawnNextOccurrence(
        client,
        before,
        before.recurrence,
        boardId,
        workspaceId,
        by
      );
    }
    return after;
  });
}

/**
 * Two actors are the same principal when their kind and id both match. A human
 * and an agent can never collide — the ids come from different spaces — but the
 * type is compared anyway, because a claim's identity is (type, id) and half of
 * it is not identity.
 */
function sameActor(a: Actor, b: Actor): boolean {
  return a.type === b.type && a.id === b.id;
}

/**
 * Locks a task row for the duration of the caller's transaction and reads it
 * back, or undefined if it is gone. FOR UPDATE is what makes claim and release
 * check-then-act atomic: two actors racing to claim the same free task serialize
 * here — the second blocks until the first commits, then reads the row the first
 * claimed and is refused. This is 007's column-delete guard, one table over and
 * for a different column.
 *
 * The lock and the read are two statements rather than one `SELECT … FOR UPDATE`
 * because taskColumns carries correlated subqueries (labels, subtaskCount), and
 * FOR UPDATE on a select that aggregates in the target list is a footgun not
 * worth walking up to. The lock is a bare primary-key select; the snapshot reads
 * the whole row on the connection that now holds the lock.
 */
async function lockTask(
  client: PoolClient,
  id: number
): Promise<Task | undefined> {
  const locked = await client.query("SELECT id FROM task WHERE id = $1 FOR UPDATE", [
    id,
  ]);
  if (locked.rowCount === 0) return undefined;
  return selectTask(client, id);
}

/**
 * Takes the exclusive working claim on a task (010, PRD §4.3) — the hold that
 * keeps a second agent off a task a first is already working. Acceptance
 * criterion #4 in one function: two agents cannot claim the same task.
 *
 * "member", not "viewer": a claim asserts "I am going to work this", and working
 * a task is a board mutation. 004's line holds — a viewer can be *assigned* a
 * task (whose work it is) but cannot claim one (declaring active work on it),
 * the same split moveTask draws. It is also §7.4's auto tier, so the rank is the
 * floor a board mutation already asks, not more.
 *
 * Idempotent for the holder, and that is not a nicety but a correctness
 * requirement of the door it serves: an external agent (009) that retries after
 * a dropped MCP connection must not be told the task it already holds is taken.
 * Re-claiming your own hold returns the task and writes nothing — a no-op is not
 * a mutation, the rule the whole updateTask no-op machinery rests on.
 *
 * "conflict" for a claim held by another, not "forbidden": the caller has the
 * rank and is allowed to attempt this; the task's state refuses it. That is the
 * 409-vs-403 line members.ts and columns.ts already draw — an invariant blocking
 * an allowed action, not a rank the caller lacks.
 */
export async function claimTask(
  actor: string | Principal,
  id: number
): Promise<Task | undefined> {
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId } = await requireTaskRole(actor, id, "member");

  return withTransaction(async (client) => {
    const before = await lockTask(client, id);
    if (!before) return undefined;

    if (before.claimedBy) {
      if (sameActor(before.claimedBy, by)) return before;
      throw new AuthzError("conflict", "This task is already claimed");
    }

    await client.query(
      `UPDATE task
          SET claimed_by = $2, claimed_by_type = $3, claimed_at = now()
        WHERE id = $1`,
      [id, by.id, by.type]
    );
    const after = (await selectTask(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: id,
      actor: by,
      action: "task.claimed",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Drops a claim (010). The holder releases their own; an admin may release
 * anyone's, and that escape hatch is not optional — it is the answer to the
 * failure mode claiming introduces. An external agent that crashes mid-run
 * leaves a hold nothing will ever drop, and without a way to break it that task
 * is locked forever. So the rule is the one "an admin may delete any comment"
 * drew (005): the ordinary member acts on what is theirs, and an admin has a
 * moderator's reach over what is stuck.
 *
 * "forbidden", not "conflict", when a member reaches for another's claim: this
 * one *is* a rank the caller lacks — breaking someone else's hold requires
 * admin, and a member simply is not one. Contrast claimTask's conflict, where
 * the caller had the rank and the state refused them. The difference is exactly
 * authz.ts's: forbidden is "you lack the rank", conflict is "the state says no".
 *
 * Releasing an unclaimed task is a no-op, not an error — it returns the task and
 * logs nothing. An agent closing out a task it never formally claimed should not
 * fail on the release; there is simply nothing to release.
 */
export async function releaseTask(
  actor: string | Principal,
  id: number
): Promise<Task | undefined> {
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId, role } = await requireTaskRole(actor, id, "member");

  return withTransaction(async (client) => {
    const before = await lockTask(client, id);
    if (!before) return undefined;
    if (!before.claimedBy) return before;

    if (!sameActor(before.claimedBy, by) && ROLE_RANK[role] < ROLE_RANK.admin) {
      throw new AuthzError(
        "forbidden",
        "Only an admin can release a claim held by someone else"
      );
    }

    await client.query(
      `UPDATE task
          SET claimed_by = NULL, claimed_by_type = NULL, claimed_at = NULL
        WHERE id = $1`,
      [id]
    );
    const after = (await selectTask(client, id))!;

    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: id,
      actor: by,
      action: "task.released",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

/**
 * Releases every claim a departing human holds across a workspace, logging each.
 *
 * The exact companion to unassignFromWorkspace, and it exists for the identical
 * reason: claimTask keeps a non-member from *taking* a claim, but says nothing
 * about the claims a member already holds — and membership is revocable. A claim
 * is current state, not history (010), so a hold by someone who has left is
 * stale and blocks the task for everyone else until an admin breaks it by hand.
 * An invariant enforced on the way in and abandoned on the way out is not one.
 *
 * Only claimed_by_type = 'human': a departing user's holds, not an agent's. An
 * agent's stale holds are swept by releaseAgentClaims on the one path that can
 * strand one — deleting the agent itself (admin.ts). Splitting the two by
 * claimed_by_type keeps each sweep to the principal whose departure caused it.
 *
 * Takes the caller's transaction client, like unassignFromWorkspace and for its
 * reason: these releases must commit with the membership deletion that caused
 * them. One log row per task, never one summarizing the batch — a reader of a
 * task's history is the only audience for why its claim vanished.
 */
export async function releaseClaimsOf(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  actor: Actor
): Promise<number> {
  const { rows } = await client.query<Task & { boardId: number }>(
    `SELECT ${taskColumns("t")}, bc.board_id AS "boardId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
      WHERE b.workspace_id = $1
        AND t.claimed_by = $2 AND t.claimed_by_type = 'human'`,
    [workspaceId, userId]
  );
  if (rows.length === 0) return 0;

  await client.query(
    `UPDATE task
        SET claimed_by = NULL, claimed_by_type = NULL, claimed_at = NULL
      WHERE id = ANY($1::int[])`,
    [rows.map((t) => t.id)]
  );

  for (const task of rows) {
    await logActivity(client, {
      workspaceId,
      boardId: task.boardId,
      taskId: task.id,
      actor,
      action: "task.released",
      before: snapshot(task),
      after: { ...snapshot(task), claimedBy: null },
    });
  }
  return rows.length;
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
  // Aliased, because `id` is ambiguous across this join — task, board_column and
  // board all have one. This is the case that made taskColumns a function: the
  // hand-written list it replaces is how getBoard silently lost two fields at
  // 006, and these rows have further to fall. They become `before`/`after` on an
  // append-only table, where a missing field lands as undefined in JSONB and is
  // indistinguishable, forever, from "written before 006".
  const { rows } = await client.query<Task & { boardId: number }>(
    `SELECT ${taskColumns("t")}, bc.board_id AS "boardId"
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
      after: { ...snapshot(task), assignee: null },
    });
  }
  return rows.length;
}

/**
 * releaseClaimsOf and unassignFromWorkspace, aimed at a departing *agent* rather
 * than a departing human — the cleanup deleteAgent (admin.ts) must run before it
 * drops the row.
 *
 * They are two functions, not one filtered by actor kind, because the two peers
 * (011) live in different columns and dangle in different ways when the agent is
 * deleted. task.agent_id carries an FK with ON DELETE SET NULL, so a raw DELETE
 * would null the assignment on its own — but *silently*, with no activity_log row
 * to say the agent left the card. task.claimed_by carries no FK at all (010, it
 * is polymorphic TEXT), so a raw DELETE leaves a hold pointing at an agent that
 * no longer exists, blocking the task for everyone until an admin breaks it. One
 * is an audit gap, the other is a stuck task; both are closed here, on the way
 * out, for the reason stated one function up — an invariant abandoned on the way
 * out is not an invariant.
 */
export async function releaseAgentClaims(
  client: PoolClient,
  workspaceId: string,
  agentId: string,
  actor: Actor
): Promise<number> {
  const { rows } = await client.query<Task & { boardId: number }>(
    `SELECT ${taskColumns("t")}, bc.board_id AS "boardId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
      WHERE b.workspace_id = $1
        AND t.claimed_by = $2 AND t.claimed_by_type = 'agent'`,
    [workspaceId, agentId]
  );
  if (rows.length === 0) return 0;

  await client.query(
    `UPDATE task
        SET claimed_by = NULL, claimed_by_type = NULL, claimed_at = NULL
      WHERE id = ANY($1::int[])`,
    [rows.map((t) => t.id)]
  );

  for (const task of rows) {
    await logActivity(client, {
      workspaceId,
      boardId: task.boardId,
      taskId: task.id,
      actor,
      action: "task.released",
      before: snapshot(task),
      after: { ...snapshot(task), claimedBy: null },
    });
  }
  return rows.length;
}

/** Clears an agent's assignments across a workspace, logging each — the agent
 *  twin of unassignFromWorkspace, filtered on agent_id. See releaseAgentClaims
 *  for why the assignment is unassigned here rather than left to the SET NULL. */
export async function unassignAgent(
  client: PoolClient,
  workspaceId: string,
  agentId: string,
  actor: Actor
): Promise<number> {
  const { rows } = await client.query<Task & { boardId: number }>(
    `SELECT ${taskColumns("t")}, bc.board_id AS "boardId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
      WHERE b.workspace_id = $1 AND t.agent_id = $2`,
    [workspaceId, agentId]
  );
  if (rows.length === 0) return 0;

  await client.query(
    `UPDATE task SET agent_id = NULL WHERE id = ANY($1::int[])`,
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
      after: { ...snapshot(task), assignee: null },
    });
  }
  return rows.length;
}

/**
 * Deleting a task deletes its subtasks, and the two decisions that shape this are
 * 007's — reached the same way and landing opposite ways.
 *
 * **It is allowed, where deleting a populated column is refused with a 409.** The
 * difference is what the CASCADE destroys, which is the line 007 already drew
 * between board_column and task_label. A column is a workflow state, and the
 * tasks in it are other people's work that merely happens to be there — so the
 * button that would take them is refused. A subtask is not incidentally under its
 * parent; it *is* part of it. Deleting "build auth" and being told to hand-delete
 * its three pieces first would be ceremony, which is the same call 007 made for
 * the last column.
 *
 * **But it cannot just DELETE and let the CASCADE run**, which is precisely what
 * 007's guard exists to prevent one table over: the pieces would vanish without a
 * single activity_log row to say where they went. So each is logged first.
 * unassignFromWorkspace's rule, for the third time — one row per task, never one
 * summarizing the batch, because a reader of a task's history is the only
 * audience for why it disappeared, and undo needs to recreate each piece rather
 * than a count of them.
 */
export async function deleteTask(
  actor: string | Principal,
  id: number
): Promise<boolean> {
  const by = principalActor(asPrincipal(actor));
  const { boardId, workspaceId } = await requireTaskRole(actor, id, "member");

  return withTransaction(async (client) => {
    const before = await selectTask(client, id);
    if (!before) return false;

    // Read before the DELETE, because after it the CASCADE has taken them and
    // there is nothing left to snapshot. Depth is 1, so this needs no recursion:
    // a piece has no pieces, and 008's trigger is what keeps that true.
    const { rows: subtasks } = await client.query<Task>(
      `SELECT ${TASK_COLUMNS} FROM task WHERE parent_id = $1`,
      [id]
    );

    await client.query("DELETE FROM task WHERE id = $1", [id]);
    await client.query(
      `UPDATE task SET position = position - 1
        WHERE column_id = $1 AND position > $2
          AND parent_id IS NOT DISTINCT FROM $3`,
      [before.columnId, before.position, before.parentId]
    );

    // The pieces first, the parent last — so that read newest-first, which is the
    // only order the log is read in, the parent's deletion comes before the
    // pieces'. Undo replays inverses in that order and needs the parent to exist
    // before it can recreate anything under it. A piece restored to a parent that
    // is not back yet is a foreign key violation at best.
    //
    // No position fix-up for the pieces: they are gone, and their siblings under
    // this parent are gone with them. The only rows whose positions moved are the
    // parent's own siblings, closed above.
    for (const subtask of subtasks) {
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId: subtask.id,
        actor: by,
        action: "task.deleted",
        before: snapshot(subtask),
      });
    }

    // Logged after the DELETE, and it survives it: activity_log.task_id carries
    // no foreign key precisely so the record of a deletion outlives its subject.
    // `before` is the whole task, which is what undo needs to recreate it.
    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: id,
      actor: by,
      action: "task.deleted",
      before: snapshot(before),
    });
    return true;
  });
}
