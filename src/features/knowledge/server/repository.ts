import Anthropic from "@anthropic-ai/sdk";

import { query } from "@/shared/db/client";
import { requireWorkspaceRole, ROLE_RANK } from "@/features/workspaces/server/authz";
import type { KnowledgeAnswer, KnowledgeCitation } from "../types";

const EXCERPT_LENGTH = 360;

/** The synthesis model call, injectable so a test never touches the network. */
export interface KnowledgeDeps {
  synthesize?: (question: string, citations: KnowledgeCitation[]) => Promise<string>;
}

/**
 * Workspace Q&A (4.3): authorization-filtered lexical retrieval, then — when a
 * model is configured — a single-shot synthesis over the retrieved evidence.
 *
 * RETRIEVAL is lexical, not semantic: stemmed PostgreSQL full text ranked by
 * ts_rank, with a trigram-similarity fallback on titles (084). There are no
 * embeddings and no ANN index — asking a question in words the workspace never
 * uses will not find the passage that means the same thing. The SPEC's
 * embeddings half is unbuilt by choice: it needs an embedding vendor this
 * self-hosted app does not otherwise depend on. See devdocs/SPEC.md 4.3.
 *
 * AUTHZ: retrieval is restricted to the boards the principal can actually READ,
 * not merely the workspace (SPEC 4.3 "never leaks a board they can't read").
 * The board-read rule mirrors requireBoardRole + assertBoardAccess: a workspace
 * role of viewer+ reads every board; below that (guest) a board is readable
 * only through an explicit permission_grant (board/read, to the user or their
 * role — 063) or an object_share (061). Tasks and comments are filtered to
 * those board ids in SQL; published docs are workspace-level and readable by
 * viewer+, while a guest sees only docs shared with them (object_share doc).
 *
 * ANSWER: with ANTHROPIC_API_KEY set (or an injected `synthesize`), the model
 * writes a short answer grounded in — and citing — the retrieved snippets, and
 * the citations always ride alongside in the response shape. With no key, the
 * response honestly lists top matching evidence instead of posing as an answer.
 */
export async function askWorkspaceKnowledge(
  actor: string,
  workspaceId: string,
  question: string,
  deps: KnowledgeDeps = {}
): Promise<KnowledgeAnswer> {
  const role = await requireWorkspaceRole(actor, workspaceId, "guest");
  const fullReader = ROLE_RANK[role] >= ROLE_RANK.viewer;
  const term = question.trim();
  if (!term) return { answer: "Ask a question to search this workspace.", citations: [] };

  const readable = await query<{ id: number }>(
    `SELECT b.id FROM board b
      WHERE b.workspace_id = $1
        AND ($2::boolean
          OR EXISTS (SELECT 1 FROM permission_grant g
                      WHERE g.workspace_id = b.workspace_id
                        AND g.subject_type = 'board' AND g.subject_id = b.id::text
                        AND g.capability = 'read'
                        AND ((g.principal_type = 'workspace_role' AND g.principal_id = $3)
                          OR (g.principal_type = 'user' AND g.principal_id = $4)))
          OR EXISTS (SELECT 1 FROM object_share s
                      WHERE s.subject_type = 'board' AND s.subject_id = b.id::text
                        AND s.user_id = $4))`,
    [workspaceId, fullReader, role, actor]
  );
  const boardIds = readable.map((b) => b.id);

  const params = [workspaceId, term, EXCERPT_LENGTH, boardIds, fullReader, actor];

  // Two arms over the same authorized source set (084). The strict arm is
  // stemmed full text ranked by ts_rank — relevance, not recency, decides which
  // twelve rows the model gets to read. The fuzzy arm is trigram
  // word_similarity on titles (the whole-string `similarity` scores a one-word
  // query against a multi-word title far too low to be useful), and it only
  // runs when the strict arm found nothing: a misspelled or partial name should
  // still reach its task instead of answering "no sources".
  //
  // Both arms select from the same `sources` CTE, so the fuzzy path inherits
  // the board filter rather than becoming a second, unguarded way in.
  const sources = `
       SELECT 'task'::text AS kind, t.id, t.title,
              COALESCE(t.description, '') AS body, t.id AS "taskId",
              t.search_tsv AS tsv, t.title AS fuzzy
         FROM task t
         JOIN board_column bc ON bc.id = t.column_id
        WHERE bc.board_id = ANY($4::int[])
       UNION ALL
       SELECT 'comment'::text, c.id, 'Comment on ' || t.title, c.body, t.id,
              c.search_tsv, NULL::text
         FROM comment c
         JOIN task t ON t.id = c.task_id
         JOIN board_column bc ON bc.id = t.column_id
        WHERE bc.board_id = ANY($4::int[])
       UNION ALL
       SELECT 'document'::text, d.id, d.title, d.body, NULL::int,
              d.search_tsv, d.title
         FROM doc d
        WHERE d.workspace_id = $1 AND d.is_published
          AND ($5::boolean
            OR EXISTS (SELECT 1 FROM object_share s
                        WHERE s.subject_type = 'doc' AND s.subject_id = d.id::text
                          AND s.user_id = $6))`;

  const select = `SELECT kind::text AS kind, id, title,
            left(regexp_replace(body, '\\s+', ' ', 'g'), $3) AS excerpt,
            "taskId"`;

  let citations = await query<KnowledgeCitation>(
    `WITH matches AS (${sources})
     ${select}
       FROM matches, websearch_to_tsquery('english', $2) AS q
      WHERE tsv @@ q
      ORDER BY ts_rank(tsv, q) DESC, id DESC
      LIMIT 12`,
    params
  );

  if (!citations.length) {
    citations = await query<KnowledgeCitation>(
      `WITH matches AS (${sources})
       ${select}
         FROM matches
        WHERE fuzzy IS NOT NULL AND word_similarity($2, fuzzy) > 0.5
        ORDER BY word_similarity($2, fuzzy) DESC, id DESC
        LIMIT 12`,
      params
    );
  }

  if (!citations.length) {
    return { answer: "I could not find authorized workspace sources that match that question.", citations: [] };
  }

  const synthesize =
    deps.synthesize ?? (process.env.ANTHROPIC_API_KEY ? synthesizeWithModel : null);
  if (synthesize) {
    try {
      const answer = (await synthesize(term, citations)).trim();
      if (answer) return { answer, citations };
    } catch {
      // A model outage degrades to the evidence listing rather than a 500 —
      // the citations are the grounded part; the prose was the garnish.
    }
  }
  return { answer: evidenceListing(citations), citations };
}

/** The no-model (and model-failure) answer: honest evidence, not fake prose. */
function evidenceListing(citations: KnowledgeCitation[]): string {
  const evidence = citations
    .slice(0, 3)
    .map((c, i) => `[${i + 1}] ${c.title}: ${c.excerpt || "matching source"}`)
    .join("\n");
  return `Top matching evidence from your workspace (no AI synthesis configured):\n${evidence}`;
}

/**
 * The default single-shot synthesis: a small, capped model call that must
 * ground every claim in the numbered snippets it is handed, citing them as
 * [n] so the answer maps back onto the citations the response carries.
 */
async function synthesizeWithModel(
  question: string,
  citations: KnowledgeCitation[]
): Promise<string> {
  const client = new Anthropic();
  const snippets = citations
    .map((c, i) => `[${i + 1}] (${c.kind}) ${c.title}\n${c.excerpt}`)
    .join("\n\n");
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: { effort: "low" },
    system:
      "You answer questions about a project workspace using ONLY the numbered evidence snippets provided. " +
      "Cite the snippets you rely on as [1], [2], … after each claim. " +
      "If the evidence does not answer the question, say so plainly. " +
      "Answer in at most one short paragraph. Never invent facts beyond the snippets.",
    messages: [
      {
        role: "user",
        content: `Evidence from the workspace:\n\n${snippets}\n\nQuestion: ${question}`,
      },
    ],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
