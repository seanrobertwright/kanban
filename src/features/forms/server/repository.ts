import type { PoolClient } from "pg";

import type { Principal } from "@/features/auth/server/principal";
import { asPrincipal, principalActor } from "@/features/auth/server/principal";
import { createTask } from "@/features/tasks/server/repository";
import type { Task } from "@/features/tasks/types";
import { query, queryOne, withTransaction } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import {
  compileSubmission,
  resolveRouting,
  type CreateFormInput,
  type Form,
  type FormField,
  type SubmitFormInput,
  type UpdateFormInput,
} from "../types";

/**
 * Forms / intake (039). A Form is a board-scoped intake definition; submitting it
 * creates a task from the answers.
 *
 * The rank rules are the milestone/epic ones: create, edit and delete are cheap
 * and reversible (member — a form deletion takes no task with it, its target
 * column is a SET NULL FK), reads are viewer+, and a submission is member — it is
 * a task creation by another name, so it rides createTask and inherits its member
 * gate rather than opening a wider door. Public/guest intake is the separate
 * "Public sharing" non-goal; this is internal intake by a workspace member.
 *
 * Form CRUD is deliberately not in the activity log — a form is intake plumbing
 * like a custom-field definition (035's cut), and the auditable event is the task
 * a submission creates, which logs task.created through createTask.
 */

/**
 * A bad submission (closed form, missing required answer) — a 400, not an authz
 * failure, so it rides its own error rather than AuthzError (whose kinds are
 * not_found/forbidden/conflict). The submit handler maps it to badRequest.
 */
export class FormSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormSubmitError";
  }
}

const FORM_COLUMNS = `id, board_id AS "boardId", name, description,
                      target_column_id AS "targetColumnId", fields,
                      is_open AS "isOpen", routing, created_at AS "createdAt"`;

async function selectForm(
  client: PoolClient,
  id: number
): Promise<Form | undefined> {
  const { rows } = await client.query<Form>(
    `SELECT ${FORM_COLUMNS} FROM form WHERE id = $1`,
    [id]
  );
  return rows[0];
}

export async function listForms(
  actor: string | Principal,
  boardId: number
): Promise<Form[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<Form>(
    `SELECT ${FORM_COLUMNS} FROM form WHERE board_id = $1
      ORDER BY name, id`,
    [boardId]
  );
}

/** Trims each question's label, dropping the type/required flags through as given.
 *  The handler has already checked the shape; this is the write-time cleanup. */
function cleanFields(fields: FormField[]): FormField[] {
  return fields.map((f) => ({
    label: f.label.trim(),
    type: f.type,
    required: f.required,
  }));
}

/**
 * A form may only target a column of its *own board* — assertObjectiveOnBoard's
 * guard, one table over, and "not_found" for the same anti-enumeration reason. A
 * bare FK to board_column would let one board point its form at another's column.
 */
async function assertColumnOnBoard(
  client: PoolClient,
  boardId: number,
  columnId: number
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM board_column WHERE id = $1 AND board_id = $2`,
    [columnId, boardId]
  );
  if (rows.length === 0) {
    throw new AuthzError("not_found", "That column is not on this board");
  }
}

export async function createForm(
  userId: string,
  boardId: number,
  input: CreateFormInput
): Promise<Form> {
  await requireBoardRole(userId, boardId, "member");

  return withTransaction(async (client) => {
    if (input.targetColumnId != null) {
      await assertColumnOnBoard(client, boardId, input.targetColumnId);
    }
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO form (board_id, name, description, target_column_id, fields,
                         is_open, routing)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb) RETURNING id`,
      [
        boardId,
        input.name.trim(),
        input.description?.trim() ?? "",
        input.targetColumnId ?? null,
        JSON.stringify(cleanFields(input.fields)),
        input.isOpen ?? true,
        JSON.stringify(input.routing ?? []),
      ]
    );
    return (await selectForm(client, rows[0].id))!;
  });
}

/** Resolves a form's own board — the one-join not_found rule (objectives'). */
async function requireForm(
  userId: string,
  id: number
): Promise<{ boardId: number }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM form WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Form not found");
  await requireBoardRole(userId, row.boardId, "member");
  return { boardId: row.boardId };
}

export async function updateForm(
  userId: string,
  id: number,
  input: UpdateFormInput
): Promise<Form | undefined> {
  const { boardId } = await requireForm(userId, id);

  return withTransaction(async (client) => {
    const before = await selectForm(client, id);
    if (!before) return undefined;

    // targetColumnId is three-valued (026's dueDate shape): absent leaves it,
    // null clears to "board's first column", a number re-targets (checked here).
    const setsTarget = "targetColumnId" in input;
    if (setsTarget && input.targetColumnId != null) {
      await assertColumnOnBoard(client, boardId, input.targetColumnId);
    }
    const setsFields = input.fields !== undefined;
    const setsRouting = input.routing !== undefined;
    await client.query(
      `UPDATE form
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              target_column_id = CASE WHEN $4::boolean THEN $5::int ELSE target_column_id END,
              fields = CASE WHEN $6::boolean THEN $7::jsonb ELSE fields END,
              is_open = COALESCE($8, is_open),
              routing = CASE WHEN $9::boolean THEN $10::jsonb ELSE routing END
        WHERE id = $1`,
      [
        id,
        input.name?.trim() ?? null,
        input.description?.trim() ?? null,
        setsTarget,
        input.targetColumnId ?? null,
        setsFields,
        setsFields ? JSON.stringify(cleanFields(input.fields!)) : null,
        input.isOpen ?? null,
        setsRouting,
        setsRouting ? JSON.stringify(input.routing) : null,
      ]
    );
    return (await selectForm(client, id))!;
  });
}

export async function deleteForm(userId: string, id: number): Promise<boolean> {
  // requireForm already proved the row exists (or threw not_found), so the DELETE
  // always removes it — no need to re-read a row count query does not return.
  await requireForm(userId, id);
  await query(`DELETE FROM form WHERE id = $1`, [id]);
  return true;
}

/**
 * Submits a form: creates a task from the answers and returns it. Member (it is a
 * task creation), and it rides createTask so the new task logs task.created and
 * lands in the board with a position like any other.
 *
 * The target column is the form's target_column_id when set, else the board's
 * first column (lowest position) — so a form whose column was deleted still
 * intakes, into the front of the board, rather than failing. A closed form
 * refuses; a submission missing a required answer refuses.
 */
export async function submitForm(
  actor: string | Principal,
  id: number,
  input: SubmitFormInput
): Promise<Task> {
  // Read the form and resolve the destination column under one board-role check;
  // the actual write is createTask, which re-checks member on that column.
  const form = await queryOne<Form>(
    `SELECT ${FORM_COLUMNS} FROM form WHERE id = $1`,
    [id]
  );
  if (!form) throw new AuthzError("not_found", "Form not found");
  await requireBoardRole(actor, form.boardId, "member");

  if (!form.isOpen) {
    throw new FormSubmitError("This form is closed to submissions");
  }

  // Every required question must be answered; the first answer (the title) must
  // be present whether or not it was flagged required — a titleless task is not a
  // task. Answers align to fields by index.
  for (let i = 0; i < form.fields.length; i++) {
    const answer = (input.answers[i] ?? "").trim();
    if ((form.fields[i].required || i === 0) && answer === "") {
      throw new FormSubmitError(`"${form.fields[i].label}" is required`);
    }
  }

  // Routing (1.7): the first matching route overrides the target column and sets
  // assignee + labels; when nothing matches, the form's defaults stand. Evaluated
  // over the answers before the column falls back to the board's first.
  const routed = resolveRouting(form.routing ?? [], form.fields, input.answers);
  const columnId =
    (routed.columnId ?? undefined) ??
    form.targetColumnId ??
    (
      await queryOne<{ id: number }>(
        `SELECT id FROM board_column WHERE board_id = $1
          ORDER BY position, id LIMIT 1`,
        [form.boardId]
      )
    )?.id;
  if (columnId === undefined) {
    throw new AuthzError("not_found", "This board has no column to intake into");
  }

  const { title, description } = compileSubmission(form.fields, input.answers);
  const task = await createTask(actor, {
    columnId,
    title,
    description,
    assignee: routed.assignee ?? undefined,
    labelIds: routed.labelIds,
  });

  // Stamp the intake identity (1.8): which form it came through and who filed it.
  // Its presence is what marks the task as a request for the Requests queue.
  const by = principalActor(asPrincipal(actor));
  await query(
    `UPDATE task SET request_meta = $2::jsonb WHERE id = $1`,
    [task.id, JSON.stringify({ source: form.name, requesterType: by.type, requesterId: by.id })]
  );
  return task;
}
