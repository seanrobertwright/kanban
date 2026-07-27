import { query, withTransaction } from "@/shared/db/client";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { DiscoveryHit } from "../types";

/**
 * eDiscovery (6.7) — an admin-only, audited search across everything in a
 * workspace, for answering a compliance or legal request.
 *
 * It reads the **live** tables rather than a snapshot, which is what makes it
 * reach content still inside retention and content frozen by a legal hold
 * (064): the sweeper never deleted it, so it is simply there. Each hit says
 * whether it is under an active hold, because "is this preserved?" is the first
 * question asked of a discovery bundle and the answer is a join away.
 *
 * Matching is deliberately **two-armed**:
 *
 *   * stemmed full text over the 084 `search_tsv` columns, ranked by `ts_rank`,
 *     so "terminated" finds "terminate" and the strongest evidence sorts first;
 *   * plus a raw `ILIKE` substring pass, because discovery searches for things
 *     full text tokenizes away — an email address, a domain, an order number, a
 *     fragment of an id. Relevance is nice; **recall is the requirement**.
 *
 * The union is what a compliance search needs and neither arm gives alone. The
 * audit-log arm stays ILIKE-only: it has no tsvector (its content is jsonb), and
 * substring is the right question to ask of it anyway.
 */

/** A bundle is bounded. When the bound bites, callers are told — see below. */
export const DISCOVERY_LIMIT = 500;

/**
 * The hit cap is a real limit on a legal answer, so it is never silent: this
 * comes back on the export beside the hits, and the panel says so. A truncated
 * bundle that looks complete is worse than no bundle.
 */
export interface DiscoveryResult {
  generatedAt: string;
  query: string;
  hits: DiscoveryHit[];
  attachments: DiscoveryAttachment[];
  /** True when the search hit DISCOVERY_LIMIT and more may exist. */
  truncated: boolean;
  limit: number;
}

export interface DiscoveryAttachment {
  id: number;
  taskId: number;
  name: string;
  contentType: string;
  size: string;
  onHold: boolean;
}

/**
 * `hold(kind, id)` — is this record frozen? Written once and interpolated per
 * arm because the subject id column differs (and `subject_id` is TEXT, so every
 * comparison casts).
 */
function hold(kind: string, idExpr: string): string {
  return `EXISTS (SELECT 1 FROM legal_hold h
                   WHERE h.workspace_id = $1 AND h.released_at IS NULL
                     AND h.subject_type = '${kind}' AND h.subject_id = ${idExpr}::text)`;
}

export async function searchWorkspace(
  userId: string,
  workspaceId: string,
  term: string
): Promise<DiscoveryHit[]> {
  await requireWorkspaceRole(userId, workspaceId, "admin");
  const trimmed = term.trim();
  if (!trimmed) return [];
  const like = `%${trimmed}%`;

  return query<DiscoveryHit>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $3) AS tsq)
     SELECT "subjectType", id, title, excerpt, "createdAt", "onHold"
       FROM (
       SELECT 'task'::text AS "subjectType", t.id::text AS id, t.title,
              left(t.description, 500) AS excerpt, t.created_at AS "createdAt",
              ${hold("task", "t.id")} AS "onHold",
              ts_rank(t.search_tsv, q.tsq) AS rank
         FROM task t
         JOIN board_column c ON c.id = t.column_id
         JOIN board b ON b.id = c.board_id
         CROSS JOIN q
        WHERE b.workspace_id = $1
          AND (t.search_tsv @@ q.tsq OR t.title ILIKE $2 OR t.description ILIKE $2)
       UNION ALL
       SELECT 'comment', cm.id::text, t.title, left(cm.body, 500), cm.created_at,
              ${hold("comment", "cm.id")},
              ts_rank(cm.search_tsv, q.tsq)
         FROM comment cm
         JOIN task t ON t.id = cm.task_id
         JOIN board_column c ON c.id = t.column_id
         JOIN board b ON b.id = c.board_id
         CROSS JOIN q
        WHERE b.workspace_id = $1
          AND (cm.search_tsv @@ q.tsq OR cm.body ILIKE $2)
       UNION ALL
       SELECT 'doc', d.id::text, d.title, left(d.body, 500), d.created_at,
              ${hold("doc", "d.id")},
              ts_rank(d.search_tsv, q.tsq)
         FROM doc d CROSS JOIN q
        WHERE d.workspace_id = $1
          AND (d.search_tsv @@ q.tsq OR d.title ILIKE $2 OR d.body ILIKE $2)
       UNION ALL
       -- The audit trail has no tsvector (jsonb content), and substring is the
       -- right question for it: find the id, the actor, the action name.
       SELECT 'activity', a.id::text, a.action,
              left(coalesce(a.after::text, a.before::text, ''), 500), a.created_at,
              false, 0
         FROM activity_log a
        WHERE a.workspace_id = $1
          AND (a.action ILIKE $2 OR a.after::text ILIKE $2 OR a.before::text ILIKE $2)
       ) hits
      ORDER BY rank DESC, "createdAt" DESC
      LIMIT ${DISCOVERY_LIMIT}`,
    [workspaceId, like, trimmed]
  );
}

export async function exportDiscovery(
  userId: string,
  workspaceId: string,
  term: string
): Promise<DiscoveryResult> {
  const hits = await searchWorkspace(userId, workspaceId, term);
  const trimmed = term.trim();
  const like = `%${trimmed}%`;

  // The manifest is scoped to the query, like the hits above it: attachments on
  // a task the term matched (title, description, or a comment on it) or whose
  // own filename matches — never the whole workspace's file listing. Empty term,
  // empty manifest, matching searchWorkspace's empty hits.
  const attachments = !trimmed
    ? []
    : await query<DiscoveryAttachment>(
        `SELECT a.id, a.task_id AS "taskId", a.name, a.content_type AS "contentType",
                a.size::text AS size,
                ${hold("attachment", "a.id")} AS "onHold"
           FROM attachment a
           JOIN task t ON t.id = a.task_id
           JOIN board_column c ON c.id = t.column_id
           JOIN board b ON b.id = c.board_id
          WHERE b.workspace_id = $1
            AND (a.name ILIKE $2 OR t.title ILIKE $2 OR t.description ILIKE $2
                 OR EXISTS (SELECT 1 FROM comment cm
                             WHERE cm.task_id = t.id AND cm.body ILIKE $2))`,
        [workspaceId, like]
      );

  const truncated = hits.length === DISCOVERY_LIMIT;

  // The casts are load-bearing: jsonb_build_object is variadic "any", so
  // Postgres cannot infer a placeholder's type from it and rejects the whole
  // statement ("could not determine data type of parameter"). Without them
  // every export throws before it returns.
  //
  // Truncation is audited, not just returned: the record of what was produced
  // should say whether it was complete.
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO activity_log
         (workspace_id, board_id, task_id, actor_type, actor_id, action, after)
       VALUES ($1, NULL, NULL, 'human', $2, 'ediscovery.export',
               jsonb_build_object('query', $3::text, 'hitCount', $4::int,
                                  'truncated', $5::boolean))`,
      [workspaceId, userId, term, hits.length, truncated]
    );
  });

  return {
    generatedAt: new Date().toISOString(),
    query: term,
    hits,
    attachments,
    truncated,
    limit: DISCOVERY_LIMIT,
  };
}
