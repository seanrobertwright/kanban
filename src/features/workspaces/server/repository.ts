import { randomUUID } from "node:crypto";

import { query, queryOne, withTransaction } from "@/shared/db/client";
import { requireWorkspaceRole } from "./authz";
import type { Board, WorkspaceMembership, WorkspaceRole } from "../types";

const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Suffix rather than a uniqueness retry loop: the slug is an addressing
  // detail, not something a user picked, so a collision is not worth a round trip.
  return `${base || "workspace"}-${randomUUID().slice(0, 6)}`;
}

/** Workspaces the user belongs to, with their own role in each. */
export async function listWorkspacesForUser(
  userId: string
): Promise<WorkspaceMembership[]> {
  return query<WorkspaceMembership>(
    `SELECT w.id, w.name, w.slug, w.created_at AS "createdAt", wm.role
       FROM workspace w
       JOIN workspace_member wm ON wm.workspace_id = w.id
      WHERE wm.user_id = $1
      ORDER BY w.created_at`,
    [userId]
  );
}

export async function listBoards(
  userId: string,
  workspaceId: string
): Promise<Board[]> {
  await requireWorkspaceRole(userId, workspaceId, "viewer");
  return query<Board>(
    `SELECT id, workspace_id AS "workspaceId", name, position,
            created_at AS "createdAt"
       FROM board
      WHERE workspace_id = $1
      ORDER BY position, id`,
    [workspaceId]
  );
}

export async function createBoard(
  userId: string,
  workspaceId: string,
  name: string
): Promise<Board> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return withTransaction(async (client) => {
    const { rows } = await client.query<Board>(
      `INSERT INTO board (workspace_id, name, position)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position) + 1, 0)
                          FROM board WHERE workspace_id = $1))
       RETURNING id, workspace_id AS "workspaceId", name, position,
                 created_at AS "createdAt"`,
      [workspaceId, name]
    );
    const board = rows[0];
    await seedColumns(client, board.id);
    return board;
  });
}

async function seedColumns(
  client: { query: (t: string, p?: unknown[]) => Promise<unknown> },
  boardId: number
) {
  for (const [i, title] of DEFAULT_COLUMNS.entries()) {
    await client.query(
      "INSERT INTO board_column (board_id, title, position) VALUES ($1, $2, $3)",
      [boardId, title, i]
    );
  }
}

export async function addMember(
  actorId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<void> {
  await requireWorkspaceRole(actorId, workspaceId, "admin");
  await query(
    `INSERT INTO workspace_member (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [workspaceId, userId, role]
  );
}

/**
 * Gives a freshly signed-in user somewhere to land: a workspace they own, one
 * board, and the three default columns. No-op once they have any membership.
 *
 * This is the bootstrap that used to be the `DEFAULT_COLUMNS` seed in the old
 * SQLite client — the difference is it now runs per user rather than per database.
 */
export async function ensurePersonalWorkspace(
  userId: string,
  displayName: string | null | undefined
): Promise<WorkspaceMembership> {
  const existing = await listWorkspacesForUser(userId);
  if (existing.length > 0) return existing[0];

  const name = displayName ? `${displayName}'s Workspace` : "My Workspace";

  return withTransaction(async (client) => {
    const id = randomUUID();
    const { rows } = await client.query<WorkspaceMembership>(
      `INSERT INTO workspace (id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, created_at AS "createdAt"`,
      [id, name, slugify(name)]
    );
    await client.query(
      `INSERT INTO workspace_member (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [id, userId]
    );
    const { rows: boardRows } = await client.query<{ id: number }>(
      `INSERT INTO board (workspace_id, name, position)
       VALUES ($1, 'Kanban Board', 0) RETURNING id`,
      [id]
    );
    await seedColumns(client, boardRows[0].id);

    return { ...rows[0], role: "owner" as const };
  });
}

/** The board a user lands on by default: first board of their first workspace. */
export async function getDefaultBoard(userId: string): Promise<Board | undefined> {
  return queryOne<Board>(
    `SELECT b.id, b.workspace_id AS "workspaceId", b.name, b.position,
            b.created_at AS "createdAt"
       FROM board b
       JOIN workspace w ON w.id = b.workspace_id
       JOIN workspace_member wm ON wm.workspace_id = w.id AND wm.user_id = $1
      ORDER BY w.created_at, b.position, b.id
      LIMIT 1`,
    [userId]
  );
}
