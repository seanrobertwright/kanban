import { query } from "@/shared/db/client";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { KnowledgeAnswer, KnowledgeCitation } from "../types";

const EXCERPT_LENGTH = 360;

/**
 * Authorization-filtered lexical retrieval across the workspace's own work and
 * published knowledge. The answer remains deliberately deterministic: every
 * claim is a short excerpt from a citation, never an untraceable model guess.
 * This is also a useful retrieval layer for a hosted embedding provider later;
 * its output and permission boundary do not have to change when vectors land.
 */
export async function askWorkspaceKnowledge(
  actor: string,
  workspaceId: string,
  question: string
): Promise<KnowledgeAnswer> {
  await requireWorkspaceRole(actor, workspaceId, "viewer");
  const term = question.trim();
  if (!term) return { answer: "Ask a question to search this workspace.", citations: [] };

  const citations = await query<KnowledgeCitation>(
    `WITH matches AS (
       SELECT 'task'::text AS kind, t.id, t.title,
              COALESCE(t.description, '') AS body, t.id AS "taskId",
              t.created_at AS updated_at
         FROM task t
         JOIN board_column bc ON bc.id = t.column_id
         JOIN board b ON b.id = bc.board_id
        WHERE b.workspace_id = $1
       UNION ALL
       SELECT 'comment'::text, c.id, 'Comment on ' || t.title, c.body, t.id, c.created_at
         FROM comment c
         JOIN task t ON t.id = c.task_id
         JOIN board_column bc ON bc.id = t.column_id
         JOIN board b ON b.id = bc.board_id
        WHERE b.workspace_id = $1
       UNION ALL
       SELECT 'document'::text, d.id, d.title, d.body, NULL::int, d.updated_at
         FROM doc d
        WHERE d.workspace_id = $1 AND d.is_published
     )
     SELECT kind::text AS kind, id, title,
            left(regexp_replace(body, '\\s+', ' ', 'g'), $3) AS excerpt,
            "taskId"
       FROM matches
      WHERE to_tsvector('simple', title || ' ' || body) @@ websearch_to_tsquery('simple', $2)
      ORDER BY updated_at DESC, id DESC
      LIMIT 12`,
    [workspaceId, term, EXCERPT_LENGTH]
  );

  if (!citations.length) {
    return { answer: "I could not find authorized workspace sources that match that question.", citations: [] };
  }
  const evidence = citations.slice(0, 3).map((citation) => `${citation.title}: ${citation.excerpt || "matching source"}`).join("\n");
  return {
    answer: `Here is the most relevant evidence from your workspace:\n${evidence}`,
    citations,
  };
}
