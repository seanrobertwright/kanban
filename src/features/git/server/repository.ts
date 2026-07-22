import { randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import { pool, query, queryOne, withTransaction } from "@/shared/db/client";
import type { Principal } from "@/features/auth/server/principal";
import {
  AuthzError,
  requireTaskRole,
  requireWorkspaceRole,
} from "@/features/workspaces/server/authz";
import { logActivity } from "@/features/activity/server/repository";
import { decryptSecret, encryptSecret } from "@/shared/crypto/secret-box";
import { taskColumns, taskSnapshot } from "@/features/tasks/server/task-row";
import type { Task } from "@/features/tasks/types";
import { resolveTaskRefs } from "../lib/parse";
import {
  isGitProvider,
  type NormalizedGitEvent,
  type RepoConnection,
  type TaskGitLink,
} from "../types";

/**
 * Git provider connection + link model (2.0). Two authz postures, the webhooks
 * (025) split: managing a *connection* is admin (connecting a repo is
 * infrastructure — an OAuth consent and a stored secret, blast radius), while a
 * task's *links* are viewer+ (seeing which PRs deliver a task is part of seeing
 * the task). The ingress path takes no principal at all — the provider's verified
 * signature is the credential, the boardForTriggerToken (1.12) precedent.
 *
 * The signing secret never leaves this module in the clear except on the ingress
 * path that must verify with it: CONNECTION_COLUMNS omits it, and it is stored
 * encrypted (6.5) and decrypted only in connectionForIngress.
 */

const CONNECTION_COLUMNS = `id, workspace_id AS "workspaceId", provider,
  external_repo AS "externalRepo", install_id AS "installId", active,
  created_by AS "createdBy", created_at AS "createdAt",
  last_event_at AS "lastEventAt"`;

const LINK_COLUMNS = `id, task_id AS "taskId", connection_id AS "connectionId",
  provider, kind, external_id AS "externalId", url, state, title,
  updated_at AS "updatedAt"`;

export async function listConnections(
  userId: string,
  workspaceId: string
): Promise<RepoConnection[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  return query<RepoConnection>(
    `SELECT ${CONNECTION_COLUMNS} FROM repo_connection
      WHERE workspace_id = $1 ORDER BY provider, external_repo`,
    [workspaceId]
  );
}

/**
 * Connects a repository, minting its inbound signing secret. The secret is
 * returned exactly once (the 025 / agent-token convention) for the admin to
 * configure into the provider's webhook settings, and stored encrypted (6.5).
 * Re-connecting the same repo rotates the row — a fresh secret, install id, and
 * active flag — rather than duplicating it (the UNIQUE key).
 */
export async function createConnection(
  userId: string,
  workspaceId: string,
  input: { provider: unknown; externalRepo?: string; installId?: string | null }
): Promise<{ connection: RepoConnection; secret: string }> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  if (!isGitProvider(input.provider)) {
    throw new AuthzError("conflict", "Unknown git provider");
  }
  const repo = input.externalRepo?.trim();
  if (!repo) {
    throw new AuthzError("conflict", "A repository (owner/name) is required");
  }

  const secret = `ghw_${randomBytes(32).toString("hex")}`;
  const connection = (await queryOne<RepoConnection>(
    `INSERT INTO repo_connection
       (workspace_id, provider, external_repo, install_id, secret, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, provider, external_repo)
     DO UPDATE SET secret = EXCLUDED.secret, install_id = EXCLUDED.install_id,
                   active = true, created_by = EXCLUDED.created_by
     RETURNING ${CONNECTION_COLUMNS}`,
    [workspaceId, input.provider, repo, input.installId ?? null, encryptSecret(secret), userId]
  ))!;
  return { connection, secret };
}

/** Admin of the connection's own workspace — resolved from the row, the
 *  requireXAccess one-join rule. Deleting SET-NULLs the task links (053). */
export async function deleteConnection(
  userId: string,
  id: number
): Promise<boolean> {
  const row = await queryOne<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM repo_connection WHERE id = $1`,
    [id]
  );
  if (!row) return false;
  await requireWorkspaceRole(userId, row.workspaceId, "admin");
  const { rowCount } = await pool.query(
    `DELETE FROM repo_connection WHERE id = $1`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The connection plus its decrypted signing secret, for the provider route to
 * verify an inbound webhook's signature. No principal: the signature IS the auth
 * (boardForTriggerToken's shape). Returns null for an unknown/inactive connection
 * or one whose secret no longer decrypts (a rotated ENCRYPTION_KEY) — the caller
 * then answers a flat 404, never leaking which case it was.
 */
export async function connectionForIngress(
  id: number
): Promise<{ connection: RepoConnection; secret: string } | null> {
  const row = await queryOne<RepoConnection & { secret: string }>(
    `SELECT ${CONNECTION_COLUMNS}, secret FROM repo_connection
      WHERE id = $1 AND active`,
    [id]
  );
  if (!row) return null;
  const { secret, ...connection } = row;
  try {
    return { connection, secret: decryptSecret(secret) };
  } catch {
    return null;
  }
}

export async function listTaskGitLinks(
  principal: string | Principal,
  taskId: number
): Promise<TaskGitLink[]> {
  await requireTaskRole(principal, taskId, "viewer");
  return query<TaskGitLink>(
    `SELECT ${LINK_COLUMNS} FROM task_git_link
      WHERE task_id = $1 ORDER BY kind, id`,
    [taskId]
  );
}

/**
 * The ingress core — provider-agnostic. Resolves the tasks a normalized event
 * references, upserts a link for each, and logs a git.* activity on any that
 * genuinely change (so a rule fires). Every task id is validated against the
 * connection's workspace before it is touched: a `#123` in a repo's payload names
 * a task only if that task lives in the workspace that connected the repo — repo
 * A can never move repo B's board.
 *
 * Returns the task ids whose links changed (the ones that logged an event).
 */
export async function ingestEvent(
  connection: RepoConnection,
  event: NormalizedGitEvent
): Promise<{ linkedTaskIds: number[] }> {
  const candidates = resolveTaskRefs(event);
  if (candidates.length === 0) return { linkedTaskIds: [] };

  const linked: number[] = [];
  for (const taskId of candidates) {
    const changed = await withTransaction((client) =>
      upsertLink(client, connection, taskId, event)
    );
    if (changed) linked.push(taskId);
  }
  if (linked.length > 0) {
    await query(
      `UPDATE repo_connection SET last_event_at = now() WHERE id = $1`,
      [connection.id]
    );
  }
  return { linkedTaskIds: linked };
}

/**
 * Upserts one task's link for the event's artifact and logs the git event iff
 * the artifact's state actually changed. The state gate is the idempotency story:
 * a webhook redelivery of the same PR-open carries the same state/url/title, so
 * nothing is logged and no rule re-fires — provider-agnostic, no delivery-id
 * bookkeeping. Returns whether it logged (i.e. whether anything changed).
 */
async function upsertLink(
  client: PoolClient,
  connection: RepoConnection,
  taskId: number,
  event: NormalizedGitEvent
): Promise<boolean> {
  // Tenancy + the board/workspace for the log row, in one read. A task outside
  // this connection's workspace resolves to no row and is silently ignored.
  const { rows } = await client.query<
    Task & { boardId: number; workspaceId: string }
  >(
    `SELECT ${taskColumns("t")},
            b.id AS "boardId", b.workspace_id AS "workspaceId"
       FROM task t
       JOIN board_column bc ON bc.id = t.column_id
       JOIN board b ON b.id = bc.board_id
      WHERE t.id = $1 AND b.workspace_id = $2`,
    [taskId, connection.workspaceId]
  );
  const task = rows[0];
  if (!task) return false;

  const prev = await client.query<{
    state: string | null;
    url: string;
    title: string | null;
  }>(
    `SELECT state, url, title FROM task_git_link
      WHERE task_id = $1 AND provider = $2 AND kind = $3 AND external_id = $4`,
    [taskId, event.provider, event.kind, event.externalId]
  );
  const before = prev.rows[0];
  if (
    before &&
    before.state === event.state &&
    before.url === event.url &&
    before.title === event.title
  ) {
    return false; // redelivery of an unchanged artifact — idempotent no-op
  }

  await client.query(
    `INSERT INTO task_git_link
       (task_id, connection_id, provider, kind, external_id, url, state, title, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (task_id, provider, kind, external_id)
     DO UPDATE SET connection_id = EXCLUDED.connection_id, url = EXCLUDED.url,
                   state = EXCLUDED.state, title = EXCLUDED.title, updated_at = now()`,
    [
      taskId,
      connection.id,
      event.provider,
      event.kind,
      event.externalId,
      event.url,
      event.state,
      event.title,
    ]
  );

  // Log the event as the connecting admin (created_by), so it has a real actor
  // and rides the post-commit sink into webhooks + the automation engine. `after`
  // is the task's own snapshot plus the git artifact — the shape a git.* rule and
  // the feed both read.
  await logActivity(client, {
    workspaceId: task.workspaceId,
    boardId: task.boardId,
    taskId,
    actor: { type: "human", id: connection.createdBy },
    action: event.action,
    before: null,
    after: {
      ...taskSnapshot(task),
      git: {
        provider: event.provider,
        kind: event.kind,
        externalId: event.externalId,
        url: event.url,
        state: event.state,
        title: event.title,
      },
    },
  });
  return true;
}
