import { query, withTransaction } from "@/shared/db/client";
import {
  AuthzError,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import type { CreateSavedViewInput, SavedView } from "../types";

const VIEW_COLUMNS = `id, workspace_id AS "workspaceId", name,
                      view_mode AS "viewMode", filter,
                      created_at AS "createdAt"`;

/**
 * Resolves a saved-view id to its workspace, or 404 — and 404 (not 403) when the
 * view belongs to another person, following M0's rule: "no such view" and "not
 * yours" are the same answer, or the id space becomes an oracle for what other
 * members have saved.
 */
async function requireOwnView(
  userId: string,
  viewId: number
): Promise<{ workspaceId: string }> {
  const rows = await query<{ workspaceId: string; userId: string }>(
    `SELECT workspace_id AS "workspaceId", user_id AS "userId"
       FROM saved_view WHERE id = $1`,
    [viewId]
  );
  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new AuthzError("not_found", "Saved view not found");
  }
  // Still a member of the workspace it belongs to (a removed member keeps no
  // reach into it, even over their own rows).
  await requireWorkspaceRole(userId, row.workspaceId, "viewer");
  return { workspaceId: row.workspaceId };
}

/**
 * This member's saved views for one workspace, by name. Viewer is enough — a
 * saved view is a way of looking, which even a view-only member does.
 */
export async function listSavedViews(
  userId: string,
  workspaceId: string
): Promise<SavedView[]> {
  await requireWorkspaceRole(userId, workspaceId, "viewer");
  return query<SavedView>(
    `SELECT ${VIEW_COLUMNS} FROM saved_view
      WHERE workspace_id = $1 AND user_id = $2
      ORDER BY lower(name)`,
    [workspaceId, userId]
  );
}

/**
 * Saves a view, overwriting the caller's own view of the same name — "save"
 * means "this is my Urgent view now", not "add a second Urgent". The unique
 * index on (workspace_id, user_id, lower(name)) is what makes the upsert land on
 * one row; ON CONFLICT updates the lens and filter it carries.
 */
export async function createSavedView(
  userId: string,
  workspaceId: string,
  input: CreateSavedViewInput
): Promise<SavedView> {
  await requireWorkspaceRole(userId, workspaceId, "viewer");

  return withTransaction(async (client) => {
    const { rows } = await client.query<SavedView>(
      `INSERT INTO saved_view (workspace_id, user_id, name, view_mode, filter)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (workspace_id, user_id, lower(name))
       DO UPDATE SET view_mode = EXCLUDED.view_mode, filter = EXCLUDED.filter
       RETURNING ${VIEW_COLUMNS}`,
      [
        workspaceId,
        userId,
        input.name,
        input.viewMode,
        JSON.stringify(input.filter),
      ]
    );
    return rows[0];
  });
}

/** Deletes one of the caller's own views. Returns false if it was not theirs. */
export async function deleteSavedView(
  userId: string,
  viewId: number
): Promise<boolean> {
  try {
    await requireOwnView(userId, viewId);
  } catch (error) {
    // Not theirs / no such view is a 404 to the caller, not a thrown 500.
    if (error instanceof AuthzError && error.kind === "not_found") return false;
    throw error;
  }
  await query<{ id: number }>(
    `DELETE FROM saved_view WHERE id = $1 RETURNING id`,
    [viewId]
  );
  return true;
}
