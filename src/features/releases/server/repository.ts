import type { PoolClient } from "pg";

import { pool, query, queryOne, withTransaction } from "@/shared/db/client";
import { logActivity } from "@/features/activity/server/repository";
import type { Actor, ReleaseSnapshot } from "@/features/activity/types";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireBoardRole,
  requireTaskRole,
} from "@/features/workspaces/server/authz";
import type { RepoConnection, NormalizedReleaseEvent } from "@/features/git/types";
import { compileReleaseNotes } from "../lib/notes";
import type {
  CreateReleaseInput,
  Release,
  UpdateReleaseInput,
} from "../types";

/**
 * Release management (2.8). Milestone-shaped authz — creating, editing, shipping,
 * and deleting are all member (a release delete SET-NULLs task.release_id, so
 * there is no blast radius). The one path that takes no principal is
 * ingestReleaseEvent: a git tag publishing a release is driven by the verified
 * webhook signature, the git ingress' rule (boardForTriggerToken's shape).
 */

const RELEASE_COLUMNS = `r.id, r.board_id AS "boardId", r.name, r.state,
  r.released_at AS "releasedAt", r.notes, r.url, r.created_at AS "createdAt"`;

/** total/done ride every read — the dialog's progress bar (milestone's rule). */
const PROGRESS_COLUMNS = `
  (SELECT COUNT(*)::int FROM task t
    WHERE t.release_id = r.id AND t.parent_id IS NULL) AS total,
  (SELECT COUNT(*)::int FROM task t
     JOIN board b ON b.id = r.board_id
    WHERE t.release_id = r.id AND t.parent_id IS NULL
      AND b.done_column_id IS NOT NULL
      AND t.column_id = b.done_column_id) AS done`;

function snapshot(release: Release): ReleaseSnapshot {
  return { releaseId: release.id, name: release.name, state: release.state };
}

async function selectRelease(
  client: PoolClient,
  id: number
): Promise<Release | undefined> {
  const { rows } = await client.query<Release>(
    `SELECT ${RELEASE_COLUMNS}, ${PROGRESS_COLUMNS} FROM release r WHERE r.id = $1`,
    [id]
  );
  return rows[0];
}

export async function listReleases(
  actor: string | Principal,
  boardId: number
): Promise<Release[]> {
  await requireBoardRole(actor, boardId, "viewer");
  return query<Release>(
    `SELECT ${RELEASE_COLUMNS}, ${PROGRESS_COLUMNS} FROM release r
      WHERE r.board_id = $1
      ORDER BY r.state, r.released_at DESC NULLS LAST, r.id DESC`,
    [boardId]
  );
}

export async function createRelease(
  userId: string,
  boardId: number,
  input: CreateReleaseInput,
  by: Actor
): Promise<Release> {
  const { workspaceId } = await requireBoardRole(userId, boardId, "member");
  return withTransaction(async (client) => {
    let row;
    try {
      ({ rows: [row] } = await client.query<{ id: number }>(
        `INSERT INTO release (board_id, name, notes) VALUES ($1, $2, $3) RETURNING id`,
        [boardId, input.name, input.notes ?? null]
      ));
    } catch (e) {
      // The (board_id, name) UNIQUE — a duplicate version is a conflict, not a 500.
      if ((e as { code?: string }).code === "23505") {
        throw new AuthzError("conflict", "A release with that name already exists");
      }
      throw e;
    }
    const release = (await selectRelease(client, row.id))!;
    await logActivity(client, {
      workspaceId,
      boardId,
      taskId: null,
      actor: by,
      action: "release.created",
      after: snapshot(release),
    });
    return release;
  });
}

async function requireRelease(
  userId: string,
  id: number
): Promise<{ boardId: number; workspaceId: string }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM release WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Release not found");
  const { workspaceId } = await requireBoardRole(userId, row.boardId, "member");
  return { boardId: row.boardId, workspaceId };
}

/**
 * Ships a release: stamps released_at + state, and freezes its notes if it has
 * none yet — author notes win, then the provider's tag body, then an auto-compiled
 * list of the tasks it carries. Logs release.released. Shared by the manual ship
 * (updateRelease state='released') and the git-tag ingress, so a release ships the
 * same way whichever wakes it. A no-op if already released.
 */
async function shipRelease(
  client: PoolClient,
  release: Release,
  workspaceId: string,
  by: Actor,
  opts: { url?: string | null; notes?: string | null } = {}
): Promise<Release> {
  if (release.state === "released") return release;

  let notes = release.notes ?? opts.notes ?? null;
  if (!notes) {
    const { rows } = await client.query<{ title: string }>(
      `SELECT title FROM task WHERE release_id = $1 AND parent_id IS NULL ORDER BY id`,
      [release.id]
    );
    notes = compileReleaseNotes(rows.map((r) => r.title));
  }

  await client.query(
    `UPDATE release
        SET state = 'released', released_at = now(),
            notes = $2, url = COALESCE($3, url)
      WHERE id = $1`,
    [release.id, notes, opts.url ?? null]
  );
  const after = (await selectRelease(client, release.id))!;
  await logActivity(client, {
    workspaceId,
    boardId: release.boardId,
    taskId: null,
    actor: by,
    action: "release.released",
    before: snapshot(release),
    after: snapshot(after),
  });
  return after;
}

export async function updateRelease(
  userId: string,
  id: number,
  input: UpdateReleaseInput,
  by: Actor
): Promise<Release | undefined> {
  const { workspaceId } = await requireRelease(userId, id);
  const setsNotes = "notes" in input;

  return withTransaction(async (client) => {
    const before = await selectRelease(client, id);
    if (!before) return undefined;

    // Shipping is its own path (stamps + freezes notes + its own event).
    if (input.state === "released" && before.state !== "released") {
      return shipRelease(client, before, workspaceId, by, {
        notes: setsNotes ? input.notes : undefined,
      });
    }

    const unshipping = input.state === "planned" && before.state === "released";
    const nameChanged = input.name !== undefined && input.name !== before.name;
    const notesChanged = setsNotes && (input.notes ?? null) !== before.notes;
    if (!unshipping && !nameChanged && !notesChanged) return before;

    await client.query(
      `UPDATE release
          SET name = COALESCE($2, name),
              notes = CASE WHEN $3::boolean THEN $4::text ELSE notes END,
              state = CASE WHEN $5::boolean THEN 'planned' ELSE state END,
              released_at = CASE WHEN $5::boolean THEN NULL ELSE released_at END
        WHERE id = $1`,
      [id, input.name ?? null, setsNotes, input.notes ?? null, unshipping]
    );
    const after = (await selectRelease(client, id))!;
    await logActivity(client, {
      workspaceId,
      boardId: after.boardId,
      taskId: null,
      actor: by,
      action: "release.updated",
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  });
}

export async function deleteRelease(
  userId: string,
  id: number,
  by: Actor
): Promise<boolean> {
  const { workspaceId } = await requireRelease(userId, id);
  return withTransaction(async (client) => {
    const before = await selectRelease(client, id);
    if (!before) return false;
    await client.query(`DELETE FROM release WHERE id = $1`, [id]);
    await logActivity(client, {
      workspaceId,
      boardId: before.boardId,
      taskId: null,
      actor: by,
      action: "release.deleted",
      before: snapshot(before),
    });
    return true;
  });
}

/** The tasks a release carries, for the dialog's assignment list. Viewer+. */
export async function listReleaseTasks(
  actor: string | Principal,
  releaseId: number
): Promise<{ id: number; title: string }[]> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM release WHERE id = $1`,
    [releaseId]
  );
  if (!row) throw new AuthzError("not_found", "Release not found");
  await requireBoardRole(actor, row.boardId, "viewer");
  return query<{ id: number; title: string }>(
    `SELECT id, title FROM task WHERE release_id = $1 AND parent_id IS NULL ORDER BY id`,
    [releaseId]
  );
}

/**
 * Aims a task at a release (or clears it, releaseId null). Member. The task must
 * live on the release's own board — a cross-board aim is refused with not_found
 * (assertMilestoneOnBoard's anti-oracle rule). Kept off the task create/update hot
 * path deliberately: a release grouping is managed in its own surface, so the
 * well-tested task mutation path stays untouched.
 */
export async function setTaskRelease(
  userId: string,
  taskId: number,
  releaseId: number | null
): Promise<void> {
  await requireTaskRole(userId, taskId, "member");
  if (releaseId !== null) {
    const ok = await queryOne<{ id: number }>(
      `SELECT r.id FROM release r
         JOIN task t ON t.id = $2
         JOIN board_column bc ON bc.id = t.column_id
        WHERE r.id = $1 AND r.board_id = bc.board_id`,
      [releaseId, taskId]
    );
    if (!ok) throw new AuthzError("not_found", "Release not found");
  }
  await pool.query(`UPDATE task SET release_id = $2 WHERE id = $1`, [taskId, releaseId]);
}

/**
 * The git release/tag ingress (2.8). A published tag ships the planned release it
 * names: matched by name within the connection's workspace (a repo can only ship
 * its own workspace's releases — the ingestEvent tenancy rule). Idempotent — a
 * redelivered publish finds the release already released and no-ops. Returns the
 * shipped release ids.
 */
export async function ingestReleaseEvent(
  connection: RepoConnection,
  event: NormalizedReleaseEvent
): Promise<{ releasedIds: number[] }> {
  if (!event.published) return { releasedIds: [] };

  return withTransaction(async (client) => {
    const { rows } = await client.query<Release & { workspaceId: string }>(
      `SELECT ${RELEASE_COLUMNS}, ${PROGRESS_COLUMNS}, b.workspace_id AS "workspaceId"
         FROM release r
         JOIN board b ON b.id = r.board_id
        WHERE b.workspace_id = $1 AND r.name = $2 AND r.state = 'planned'`,
      [connection.workspaceId, event.tag]
    );
    const released: number[] = [];
    // The connection's admin is the actor a git event attributes to (ingestEvent's rule).
    const by: Actor = { type: "human", id: connection.createdBy };
    for (const row of rows) {
      const { workspaceId, ...release } = row;
      await shipRelease(client, release, workspaceId, by, {
        url: event.url || null,
        notes: event.notes,
      });
      released.push(release.id);
    }
    return { releasedIds: released };
  });
}
