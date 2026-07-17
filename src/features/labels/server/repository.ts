import type { PoolClient } from "pg";

import { logActivity } from "@/features/activity/server/repository";
import type { Actor, LabelRef, LabelSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import { taskColumns, taskSnapshot } from "@/features/tasks/server/task-row";
import type { Task } from "@/features/tasks/types";
import { query, withTransaction } from "@/shared/db/client";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import type { CreateLabelInput, Label, UpdateLabelInput } from "../types";

const LABEL_COLUMNS = `id, workspace_id AS "workspaceId", name, color,
                       created_at AS "createdAt"`;

/** Every caller here is a signed-in person; agents become actors at M2. */
function human(userId: string): Actor {
  return { type: "human", id: userId };
}

function snapshot(label: Label): LabelSnapshot {
  return { labelId: label.id, name: label.name, color: label.color };
}

/**
 * Resolves a label id to the workspace that owns it, or 404.
 *
 * "not_found" rather than "forbidden", following M0's rule: "there is no such
 * label" and "that label is another workspace's" must be the same answer, or the
 * id space becomes an oracle.
 */
async function requireLabelRole(
  userId: string,
  labelId: number,
  role: "viewer" | "member" | "admin"
): Promise<{ workspaceId: string; label: Label }> {
  const rows = await query<Label>(
    `SELECT ${LABEL_COLUMNS} FROM label WHERE id = $1`,
    [labelId]
  );
  const label = rows[0];
  if (!label) throw new AuthzError("not_found", "Label not found");
  await requireWorkspaceRole(userId, label.workspaceId, role);
  return { workspaceId: label.workspaceId, label };
}

/**
 * The vocabulary. Ordered by name rather than creation, because this is a list
 * someone reads and picks from — arrival order is an implementation detail of
 * whoever set the workspace up, and it makes a label impossible to find once
 * there are twenty.
 *
 * lower(), so the order does not depend on case: 'Bug' before 'api' is what a
 * plain ORDER BY name gives, since uppercase sorts first in most collations.
 */
export async function listLabels(
  actor: string | Principal,
  workspaceId: string
): Promise<Label[]> {
  // Agent-readable (viewer+): a native or external agent needs the label ids to
  // label a task (set_labels / update_task), and a vocabulary is not PII the way
  // the member list's emails are. requireWorkspaceRole scopes an agent to its own
  // workspace, so it reads only its own workspace's labels.
  await requireWorkspaceRole(actor, workspaceId, "viewer");
  return query<Label>(
    `SELECT ${LABEL_COLUMNS} FROM label WHERE workspace_id = $1
      ORDER BY lower(name)`,
    [workspaceId]
  );
}

/**
 * Every `name` reaching this file is already trimmed and length-checked by the
 * handler, which is where the columns work put the same job — 400 is a shape
 * answer, and shape is the API's to police.
 *
 * It matters more here than it does for a column title, and the reason is the
 * uniqueness index rather than tidiness: `lower('bug ')` and `lower('bug')` are
 * different strings, so an untrimmed name slips straight past the one constraint
 * that makes the vocabulary controlled, and lands as two labels that render
 * identically. Whoever reports that bug will not be able to see it.
 */

/**
 * Creating takes `member`, deleting takes `admin` — §7.4's blast-radius rule,
 * applied to people, as the columns work already applies it. Adding a label is
 * an ordinary act; deleting one reaches every task that wears it.
 */
export async function createLabel(
  userId: string,
  workspaceId: string,
  input: CreateLabelInput
): Promise<Label> {
  await requireWorkspaceRole(userId, workspaceId, "member");
  const { name } = input;

  return withTransaction(async (client) => {
    // Checked here so the answer is a sentence rather than a 23505 surfacing as
    // a 500. The unique index is still what makes it *true* — two requests can
    // both pass this check and both insert, and only the index is there for
    // that. Belt and braces, where the braces are the ones that hold.
    const clash = await client.query(
      `SELECT name FROM label WHERE workspace_id = $1 AND lower(name) = lower($2)`,
      [workspaceId, name]
    );
    if (clash.rows.length > 0) {
      throw new AuthzError(
        "conflict",
        `This workspace already has a label called "${clash.rows[0].name}"`
      );
    }

    const { rows } = await client.query<Label>(
      `INSERT INTO label (workspace_id, name, color) VALUES ($1, $2, $3)
       RETURNING ${LABEL_COLUMNS}`,
      [workspaceId, name, input.color ?? "slate"]
    );
    const label = rows[0];

    await logActivity(client, {
      workspaceId,
      // Null: a label belongs to a workspace, not a board (007). The one action
      // family whose rows can name neither a board nor a task.
      boardId: null,
      taskId: null,
      actor: human(userId),
      action: "label.created",
      after: snapshot(label),
    });
    return label;
  });
}

export async function updateLabel(
  userId: string,
  labelId: number,
  input: UpdateLabelInput
): Promise<Label> {
  const { workspaceId } = await requireLabelRole(userId, labelId, "member");
  const { name } = input;

  return withTransaction(async (client) => {
    const before = (
      await client.query<Label>(
        `SELECT ${LABEL_COLUMNS} FROM label WHERE id = $1`,
        [labelId]
      )
    ).rows[0];

    if (name !== undefined) {
      const clash = await client.query(
        `SELECT 1 FROM label
          WHERE workspace_id = $1 AND lower(name) = lower($2) AND id <> $3`,
        [workspaceId, name, labelId]
      );
      if (clash.rows.length > 0) {
        throw new AuthzError(
          "conflict",
          `This workspace already has a label called "${name}"`
        );
      }
    }

    // COALESCE for both: neither field is nullable, so null can only mean "not
    // supplied". 006's rule — the supplied-flag is needed iff the field has no
    // non-null value meaning empty — and neither of these does.
    const { rows } = await client.query<Label>(
      `UPDATE label
          SET name = COALESCE($2, name),
              color = COALESCE($3::label_color, color)
        WHERE id = $1
        RETURNING ${LABEL_COLUMNS}`,
      [labelId, name ?? null, input.color ?? null]
    );
    const after = rows[0];

    // A rename touches every card that wears this label, and still logs one row.
    // The tasks did not change — the vocabulary did — and five hundred
    // task.labeled rows for one rename would bury the event under bookkeeping.
    // The same call task.moved makes about the siblings it shifts.
    if (before.name !== after.name || before.color !== after.color) {
      await logActivity(client, {
        workspaceId,
        boardId: null,
        taskId: null,
        actor: human(userId),
        action: "label.updated",
        before: snapshot(before),
        after: snapshot(after),
      });
    }
    return after;
  });
}

/**
 * Deletes a label and unlabels every task that wore it.
 *
 * Allowed while in use, unlike deleting a populated column — and the difference
 * is what the CASCADE destroys. task.column_id CASCADEs to tasks, so that button
 * would delete work and the repository refuses with a 409. task_label CASCADEs
 * to *links*: the tasks are untouched and simply lose a label, which is what
 * "delete this label" means. Refusing until every task is unlabelled by hand
 * would be ceremony, not an invariant.
 *
 * The per-task rows below are why this cannot just DELETE and let the CASCADE
 * run. unassignFromWorkspace's reasoning: a reader of a task's history is the
 * only audience for why a label vanished from their card, and one "deleted a
 * label" row in a workspace feed is neither attributable per task nor
 * revertible. The M1 criterion is every mutation, and this is N of them.
 */
export async function deleteLabel(
  userId: string,
  labelId: number
): Promise<boolean> {
  const { workspaceId, label } = await requireLabelRole(userId, labelId, "admin");

  return withTransaction(async (client) => {
    // The whole task, not just its id and labels — task.labeled carries a full
    // TaskSnapshot like every other task action, because `action` says what the
    // entry is about while the snapshot says what the task was. Read before the
    // delete, so `before` is the truth; `after` is derived rather than re-read,
    // since the only thing that changes is this one label leaving the set.
    const { rows: affected } = await client.query<Task & { boardId: number }>(
      `SELECT ${taskColumns("t")}, bc.board_id AS "boardId"
         FROM task_label tl
         JOIN task t ON t.id = tl.task_id
         JOIN board_column bc ON bc.id = t.column_id
        WHERE tl.label_id = $1`,
      [labelId]
    );

    // Explicit, though the CASCADE would do it. The rows above were read before
    // the delete and the log below describes the state after it, so the delete
    // has to happen between them rather than as a side effect of a foreign key
    // whose ordering this function does not control.
    await client.query(`DELETE FROM task_label WHERE label_id = $1`, [labelId]);
    const deleted = await client.query(`DELETE FROM label WHERE id = $1`, [labelId]);
    if (deleted.rowCount === 0) return false;

    for (const task of affected) {
      const before = taskSnapshot(task);
      await logActivity(client, {
        workspaceId,
        boardId: task.boardId,
        taskId: task.id,
        actor: human(userId),
        action: "task.labeled",
        before,
        after: {
          ...before,
          labels: (before.labels ?? []).filter((l) => l.id !== labelId),
        },
      });
    }

    await logActivity(client, {
      workspaceId,
      boardId: null,
      taskId: null,
      actor: human(userId),
      action: "label.deleted",
      before: snapshot(label),
    });
    return true;
  });
}

/**
 * Enforces the invariant 007 documents but cannot express: a task's labels
 * belong to the task's workspace.
 *
 * The foreign key proves the label exists *somewhere*. Without this, any label
 * id in the database could be written onto any task, and a stranger's vocabulary
 * would render on a board that never defined it — 004's assignee problem, one
 * table over, and refused the same way for the same reason (the CHECK cannot see
 * the join, and denormalizing workspace_id onto task is what M0 rejected).
 *
 * One query, not one per label: `= ANY` and a count. A loop would be N round
 * trips inside a transaction to answer a set question.
 */
export async function assertLabelsInWorkspace(
  client: PoolClient,
  workspaceId: string,
  labelIds: number[]
): Promise<void> {
  if (labelIds.length === 0) return;

  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM label WHERE workspace_id = $1 AND id = ANY($2::int[])`,
    [workspaceId, labelIds]
  );
  if (rows.length !== new Set(labelIds).size) {
    throw new AuthzError("not_found", "No such label in this workspace");
  }
}

/**
 * Replaces a task's label set, returning the labels before and after.
 *
 * A set, not a delta — the caller says what the labels should be and this makes
 * it so. That matches how the dialog works (submit the form, not a stream of
 * add/remove events), and it is what lets the log carry a whole snapshot on
 * either side, which is what undo restores.
 *
 * Takes the caller's transaction client for logActivity's reason: the write and
 * the row that records it must commit together.
 */
export async function setTaskLabels(
  client: PoolClient,
  taskId: number,
  labelIds: number[]
): Promise<void> {
  const wanted = [...new Set(labelIds)];

  // Delete what is no longer wanted, insert what is new — rather than delete-all
  // then insert-all, which would churn every row on every save and make the
  // primary key do work for nothing. `<> ALL('{}')` is true for every row, so an
  // empty `wanted` clears the set, which is exactly what [] means.
  await client.query(
    `DELETE FROM task_label WHERE task_id = $1 AND label_id <> ALL($2::int[])`,
    [taskId, wanted]
  );
  if (wanted.length > 0) {
    await client.query(
      `INSERT INTO task_label (task_id, label_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT DO NOTHING`,
      [taskId, wanted]
    );
  }
}

/**
 * The label set of a task, as the log wants to remember it: id and name, so an
 * entry stays readable after the label is deleted (ColumnSnapshot's rule).
 */
export async function labelRefsForTask(
  client: PoolClient,
  taskId: number
): Promise<LabelRef[]> {
  const { rows } = await client.query<LabelRef>(
    `SELECT l.id, l.name FROM task_label tl
       JOIN label l ON l.id = tl.label_id
      WHERE tl.task_id = $1
      ORDER BY l.id`,
    [taskId]
  );
  return rows;
}
