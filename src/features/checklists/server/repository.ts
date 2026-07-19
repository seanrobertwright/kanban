import { query } from "@/shared/db/client";
import { AuthzError, requireTaskRole } from "@/features/workspaces/server/authz";
import type {
  ChecklistItem,
  CreateChecklistItemInput,
  UpdateChecklistItemInput,
} from "../types";

const ITEM_COLUMNS = `id, task_id AS "taskId", content, done, position,
                      created_at AS "createdAt"`;

/**
 * Resolves a checklist item to its task and checks the caller's role on it, or
 * 404 — "no such item" and "an item on a task you cannot reach" are one answer,
 * following M0's rule so the id space is not an oracle.
 */
async function requireItemRole(
  userId: string,
  itemId: number,
  role: "viewer" | "member"
): Promise<{ taskId: number }> {
  const rows = await query<{ taskId: number }>(
    `SELECT task_id AS "taskId" FROM checklist_item WHERE id = $1`,
    [itemId]
  );
  const row = rows[0];
  if (!row) throw new AuthzError("not_found", "Checklist item not found");
  await requireTaskRole(userId, row.taskId, role);
  return { taskId: row.taskId };
}

/** A task's checklist, in order. Viewer is enough — reading is not editing. */
export async function listChecklist(
  userId: string,
  taskId: number
): Promise<ChecklistItem[]> {
  await requireTaskRole(userId, taskId, "viewer");
  return query<ChecklistItem>(
    `SELECT ${ITEM_COLUMNS} FROM checklist_item
      WHERE task_id = $1 ORDER BY position, id`,
    [taskId]
  );
}

/**
 * Appends an item. Position is MAX+1 computed in the INSERT, so two adds cannot
 * both read the same max and collide on order (they serialize on the task's
 * rows) — the same trick a fresh column's tasks use.
 */
export async function createChecklistItem(
  userId: string,
  taskId: number,
  input: CreateChecklistItemInput
): Promise<ChecklistItem> {
  await requireTaskRole(userId, taskId, "member");
  const rows = await query<ChecklistItem>(
    `INSERT INTO checklist_item (task_id, content, position)
     VALUES ($1, $2,
       (SELECT COALESCE(MAX(position), -1) + 1
          FROM checklist_item WHERE task_id = $1))
     RETURNING ${ITEM_COLUMNS}`,
    [taskId, input.content]
  );
  return rows[0];
}

/**
 * Edits an item's text and/or done state. COALESCE for both: neither is
 * nullable, so an absent field means "leave it" (006's two-valued rule).
 */
export async function updateChecklistItem(
  userId: string,
  itemId: number,
  input: UpdateChecklistItemInput
): Promise<ChecklistItem> {
  await requireItemRole(userId, itemId, "member");
  const rows = await query<ChecklistItem>(
    `UPDATE checklist_item
        SET content = COALESCE($2, content),
            done = COALESCE($3, done)
      WHERE id = $1
      RETURNING ${ITEM_COLUMNS}`,
    [itemId, input.content ?? null, input.done ?? null]
  );
  return rows[0];
}

/** Removes an item. Returns false if it was not the caller's to remove. */
export async function deleteChecklistItem(
  userId: string,
  itemId: number
): Promise<boolean> {
  try {
    await requireItemRole(userId, itemId, "member");
  } catch (error) {
    if (error instanceof AuthzError && error.kind === "not_found") return false;
    throw error;
  }
  await query<{ id: number }>(
    `DELETE FROM checklist_item WHERE id = $1 RETURNING id`,
    [itemId]
  );
  return true;
}
