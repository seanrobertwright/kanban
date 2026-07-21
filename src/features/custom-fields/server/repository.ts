import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import type {
  CreateCustomFieldInput,
  CustomField,
  CustomFieldType,
  CustomFieldValueInput,
  TaskCustomField,
  UpdateCustomFieldInput,
} from "../types";

/**
 * Custom fields (035). Board-scoped definitions and per-task values.
 *
 * Definitions are member-gated (defining how a board models its work is a board
 * mutation, a column's rank). Values are member-gated too: filling a field is
 * editing the task's data. Reads are viewer, the ordinary floor.
 *
 * The log boundary moved once (035 → 036 follow-up). 035 kept everything here
 * out of activity_log because TaskSnapshot could not hold a dynamic field set.
 * Value edits now log a `customField.valued` row each — a dedicated snapshot
 * family (CustomFieldValueSnapshot) carries the before/after string, so the feed
 * reads the change and undo has what it needs. Definition management (create,
 * rename, delete) is still outside the log: a field-delete CASCADEs a whole
 * board's values, and teaching undo to recreate the definition and every value
 * it took is the larger cut 035 named and this follow-up does not take.
 */

const fieldColumns = (p: "" | "cf." = "") =>
  `${p}id, ${p}board_id AS "boardId", ${p}name, ${p}type,
   ${p}options, ${p}position, ${p}created_at AS "createdAt"`;

/** A board's fields in display order. Viewer — reading the board's shape. */
export async function listBoardFields(
  actor: string | Principal,
  boardId: number
): Promise<CustomField[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<CustomField>(
    `SELECT ${fieldColumns()} FROM custom_field
      WHERE board_id = $1 ORDER BY position, id`,
    [boardId]
  );
}

/** Options are meaningful only for 'select'; every other kind stores `[]`, so a
 *  stray options list on a text field cannot later read as choices. */
function normalizeOptions(type: CustomFieldType, options?: string[]): string[] {
  if (type !== "select") return [];
  const cleaned = (options ?? []).map((o) => o.trim()).filter((o) => o !== "");
  if (cleaned.length === 0) {
    throw new AuthzError("conflict", "A select field needs at least one option");
  }
  return cleaned;
}

export async function createField(
  userId: string,
  boardId: number,
  input: CreateCustomFieldInput
): Promise<CustomField> {
  await requireBoardRole(userId, boardId, "member");
  const options = normalizeOptions(input.type, input.options);

  return withTransaction(async (client) => {
    const { rows } = await client.query<CustomField>(
      `INSERT INTO custom_field (board_id, name, type, options, position)
       VALUES ($1, $2, $3, $4,
               (SELECT COALESCE(MAX(position) + 1, 0)
                  FROM custom_field WHERE board_id = $1))
       RETURNING ${fieldColumns()}`,
      [boardId, input.name.trim(), input.type, options]
    );
    return rows[0];
  });
}

/** Resolves a field and the caller's standing on its board in one join — a not
 *  found for anything the caller cannot reach (requireCommentAccess's anti-oracle
 *  shape), so a field id is not an existence oracle across boards. */
async function requireFieldBoard(
  userId: string,
  fieldId: number
): Promise<{ field: CustomField; role: string }> {
  const row = await queryOne<CustomField & { role: string }>(
    `SELECT ${fieldColumns("cf.")}, wm.role
       FROM custom_field cf
       JOIN board b ON b.id = cf.board_id
       JOIN workspace_member wm
         ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE cf.id = $1`,
    [fieldId, userId]
  );
  if (!row) throw new AuthzError("not_found", "Custom field not found");
  const { role, ...field } = row;
  return { field, role };
}

export async function updateField(
  userId: string,
  id: number,
  input: UpdateCustomFieldInput
): Promise<CustomField> {
  const { field } = await requireFieldBoard(userId, id);
  await requireBoardRole(userId, field.boardId, "member");

  // Options only ever apply to a select; re-normalise against the existing type
  // so a rename cannot smuggle options onto a text field.
  const options =
    input.options !== undefined
      ? normalizeOptions(field.type, input.options)
      : undefined;

  const rows = await query<CustomField>(
    `UPDATE custom_field
        SET name = COALESCE($2, name),
            options = COALESCE($3, options),
            position = COALESCE($4, position)
      WHERE id = $1
      RETURNING ${fieldColumns()}`,
    [id, input.name?.trim() ?? null, options ?? null, input.position ?? null]
  );
  return rows[0];
}

export async function deleteField(userId: string, id: number): Promise<boolean> {
  const { field } = await requireFieldBoard(userId, id);
  await requireBoardRole(userId, field.boardId, "member");
  // CASCADE clears this field's values across every task (035) — no log row, the
  // deliberate cut. The field's column simply disappears from the board.
  const deleted = await query<{ id: number }>(
    `DELETE FROM custom_field WHERE id = $1 RETURNING id`,
    [id]
  );
  return deleted.length === 1;
}

/** A task's fields with its answers — every board field, joined to this task's
 *  value (null when unanswered). Viewer, matching getTask. */
export async function getTaskFields(
  actor: string | Principal,
  taskId: number
): Promise<TaskCustomField[]> {
  const { boardId } = await requireTaskRole(actor, taskId, "viewer");
  return query<TaskCustomField>(
    `SELECT ${fieldColumns("cf.")}, cfv.value
       FROM custom_field cf
       LEFT JOIN custom_field_value cfv
         ON cfv.field_id = cf.id AND cfv.task_id = $2
      WHERE cf.board_id = $1
      ORDER BY cf.position, cf.id`,
    [boardId, taskId]
  );
}

/** Validates one answer against its field's type, returning the text to store, or
 *  null to clear. A mismatch is a conflict: the caller may set values, but this
 *  value does not fit the field it is for (035). */
function coerceValue(field: CustomField, value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const v = value.trim();
  switch (field.type) {
    case "number":
      if (!/^-?\d+(\.\d+)?$/.test(v)) {
        throw new AuthzError("conflict", `"${field.name}" must be a number`);
      }
      return v;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new AuthzError("conflict", `"${field.name}" must be a YYYY-MM-DD date`);
      }
      return v;
    case "checkbox":
      if (v !== "true" && v !== "false") {
        throw new AuthzError("conflict", `"${field.name}" must be true or false`);
      }
      return v;
    case "select":
      if (!field.options.includes(v)) {
        throw new AuthzError("conflict", `"${v}" is not an option for "${field.name}"`);
      }
      return v;
    case "text":
      return v;
  }
}

/**
 * Sets (or clears) a task's answers. Member — filling a field is editing the
 * task's data. Each value is validated against its field's type, and each field
 * must belong to the task's board (not_found otherwise, the tenancy check every
 * cross-reference here makes). A null/empty value deletes the answer row.
 */
export async function setTaskFieldValues(
  userId: string,
  taskId: number,
  values: CustomFieldValueInput[]
): Promise<TaskCustomField[]> {
  const { boardId, workspaceId } = await requireTaskRole(userId, taskId, "member");
  // Human-only path: the value editor is the task dialog's section, driven by a
  // member session — no agent tool writes custom fields, so the actor is always
  // the calling user. See the 036-follow-up note in the module header.
  const actor: Actor = { type: "human", id: userId };

  await withTransaction(async (client) => {
    // The board's fields, by id, so each input is checked for tenancy and type
    // against a definition read once rather than per value.
    const fields = await boardFieldsById(client, boardId);
    // The answers as they stand, so a change can be diffed against them: a value
    // set to what it already was writes nothing and logs nothing (the label
    // set's no-op guard), and a real change carries its before into the log.
    const current = await currentValues(client, taskId);
    for (const { fieldId, value } of values) {
      const field = fields.get(fieldId);
      if (!field) {
        throw new AuthzError("not_found", "That field is not on this task's board");
      }
      const coerced = coerceValue(field, value);
      const before = current.get(fieldId) ?? null;
      // Nothing actually changed — neither a write nor a log row. Clearing an
      // already-empty answer and re-setting an identical value both land here.
      if (coerced === before) continue;

      if (coerced === null) {
        await client.query(
          `DELETE FROM custom_field_value WHERE task_id = $1 AND field_id = $2`,
          [taskId, fieldId]
        );
      } else {
        await client.query(
          `INSERT INTO custom_field_value (task_id, field_id, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
          [taskId, fieldId, coerced]
        );
      }

      // One row per changed answer (035 → 036 follow-up), inside the same
      // transaction as the write — logActivity's atomicity requirement. before
      // and after carry the field name so a later-deleted field still reads.
      await logActivity(client, {
        workspaceId,
        boardId,
        taskId,
        actor,
        action: "customField.valued",
        before: { fieldId, fieldName: field.name, value: before },
        after: { fieldId, fieldName: field.name, value: coerced },
      });
    }
  });

  return getTaskFields(userId, taskId);
}

/** A task's stored answers as a {fieldId → value} map, for diffing a write
 *  against what is already there. Read on the caller's transaction client so it
 *  cannot shift between the diff and the writes that trust it. */
async function currentValues(
  client: PoolClient,
  taskId: number
): Promise<Map<number, string>> {
  const { rows } = await client.query<{ fieldId: number; value: string }>(
    `SELECT field_id AS "fieldId", value FROM custom_field_value WHERE task_id = $1`,
    [taskId]
  );
  return new Map(rows.map((r) => [r.fieldId, r.value]));
}

async function boardFieldsById(
  client: PoolClient,
  boardId: number
): Promise<Map<number, CustomField>> {
  const { rows } = await client.query<CustomField>(
    `SELECT ${fieldColumns()} FROM custom_field WHERE board_id = $1`,
    [boardId]
  );
  return new Map(rows.map((f) => [f.id, f]));
}
