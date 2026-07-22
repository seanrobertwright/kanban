import type { PoolClient } from "pg";

import type { Principal } from "@/features/auth/server/principal";
import { createTask } from "@/features/tasks/server/repository";
import type { Task } from "@/features/tasks/types";
import { query, queryOne, withTransaction } from "@/shared/db/client";
import {
  AuthzError,
  requireBoardRole,
} from "@/features/workspaces/server/authz";
import {
  buildDiscoveryOverview,
  compilePromotion,
  riceScore,
} from "../lib/discovery";
import type {
  CreateFeedbackInput,
  CreateIdeaInput,
  DiscoveryOverview,
  Feedback,
  Idea,
  UpdateFeedbackInput,
  UpdateIdeaInput,
} from "../types";

/**
 * Product discovery + Feedback intake (043).
 *
 * The rank rules are the forms/milestone ones: reads are viewer+ (a member sees
 * where the board's product thinking stands), and idea/feedback create-edit-
 * delete-promote are member — discovery is cheap, reversible authoring (an idea
 * deletion takes no task with it; feedback SET-NULLs off a deleted idea), and a
 * promotion is a task creation by another name, so it rides createTask and
 * inherits that member gate rather than opening a wider door.
 *
 * No activity log: discovery is pre-commitment product plumbing (the custom-
 * field-def / forms cut). The auditable event is the task a promotion creates,
 * which logs task.created through createTask.
 */

const IDEA_COLUMNS = `id, board_id AS "boardId", title, description, status,
                      reach, impact, confidence, effort,
                      promoted_task_id AS "promotedTaskId", created_at AS "createdAt"`;

const FEEDBACK_COLUMNS = `id, board_id AS "boardId", idea_id AS "ideaId", body,
                          source, sentiment, votes, created_at AS "createdAt"`;

export async function getBoardDiscovery(
  actor: string | Principal,
  boardId: number
): Promise<DiscoveryOverview> {
  await requireBoardRole(actor, boardId, "viewer");

  const ideas = await query<Idea>(
    `SELECT ${IDEA_COLUMNS} FROM idea WHERE board_id = $1`,
    [boardId]
  );
  const feedback = await query<Feedback>(
    `SELECT ${FEEDBACK_COLUMNS} FROM feedback WHERE board_id = $1
      ORDER BY votes DESC, created_at DESC, id DESC`,
    [boardId]
  );

  return buildDiscoveryOverview(ideas, feedback);
}

export async function createIdea(
  userId: string,
  boardId: number,
  input: CreateIdeaInput
): Promise<Idea> {
  await requireBoardRole(userId, boardId, "member");
  const row = await queryOne<Idea>(
    `INSERT INTO idea (board_id, title, description, reach, impact, confidence, effort)
     VALUES ($1, $2, $3,
             COALESCE($4, 0), COALESCE($5, 1), COALESCE($6, 100), COALESCE($7, 1))
     RETURNING ${IDEA_COLUMNS}`,
    [
      boardId,
      input.title.trim(),
      input.description?.trim() ?? "",
      input.reach ?? null,
      input.impact ?? null,
      input.confidence ?? null,
      input.effort ?? null,
    ]
  );
  return row!;
}

/** Resolves an idea's own board and proves the caller is a member there
 *  (objectives' one-join not_found rule). */
async function requireIdea(
  userId: string,
  id: number
): Promise<{ boardId: number }> {
  const row = await queryOne<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM idea WHERE id = $1`,
    [id]
  );
  if (!row) throw new AuthzError("not_found", "Idea not found");
  await requireBoardRole(userId, row.boardId, "member");
  return row;
}

export async function updateIdea(
  userId: string,
  id: number,
  input: UpdateIdeaInput
): Promise<Idea | undefined> {
  await requireIdea(userId, id);
  const row = await queryOne<Idea>(
    `UPDATE idea
        SET title = COALESCE($2, title),
            description = COALESCE($3, description),
            status = COALESCE($4, status),
            reach = COALESCE($5, reach),
            impact = COALESCE($6, impact),
            confidence = COALESCE($7, confidence),
            effort = COALESCE($8, effort)
      WHERE id = $1
      RETURNING ${IDEA_COLUMNS}`,
    [
      id,
      input.title?.trim() ?? null,
      input.description?.trim() ?? null,
      input.status ?? null,
      input.reach ?? null,
      input.impact ?? null,
      input.confidence ?? null,
      input.effort ?? null,
    ]
  );
  return row ?? undefined;
}

export async function deleteIdea(userId: string, id: number): Promise<boolean> {
  await requireIdea(userId, id);
  await query(`DELETE FROM idea WHERE id = $1`, [id]);
  return true;
}

/**
 * A promotion that cannot proceed (already promoted) — a 400, not an authz
 * failure, so it rides its own error like FormSubmitError (039). The handler maps
 * it to badRequest.
 */
export class PromoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromoteError";
  }
}

/**
 * Promotes a validated idea into a task and returns it. Member (it is a task
 * creation), riding createTask so the new task logs task.created and lands in the
 * board like any other. The task's title is the idea's; its description is the
 * idea's detail plus a discovery footer (RICE + demand) so delivery remembers
 * why. The task lands in the board's first column (forms' fallback), and the idea
 * is stamped promoted + promoted_task_id in the same transaction.
 *
 * Re-promoting is refused — an idea becomes one task, and a second promotion
 * would silently fork the discovery record from its delivery record.
 */
export async function promoteIdea(
  actor: string | Principal,
  id: number
): Promise<Task> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Idea>(
      `SELECT ${IDEA_COLUMNS} FROM idea WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const idea = rows[0];
    if (!idea) throw new AuthzError("not_found", "Idea not found");
    await requireBoardRole(actor, idea.boardId, "member");

    if (idea.promotedTaskId !== null) {
      throw new PromoteError("This idea has already been promoted");
    }

    const column = await client.query<{ id: number }>(
      `SELECT id FROM board_column WHERE board_id = $1 ORDER BY position, id LIMIT 1`,
      [idea.boardId]
    );
    const columnId = column.rows[0]?.id;
    if (columnId === undefined) {
      throw new AuthzError("not_found", "This board has no column to promote into");
    }

    const demand = await client.query<{ count: number; votes: number }>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(votes), 0)::int AS votes
         FROM feedback WHERE idea_id = $1`,
      [id]
    );
    const signal = {
      rice: riceScore(idea),
      feedbackCount: demand.rows[0].count,
      demand: demand.rows[0].votes,
    };

    const task = await createTask(actor, {
      columnId,
      title: idea.title,
      description: compilePromotion(idea, signal),
    });

    await client.query(
      `UPDATE idea SET status = 'promoted', promoted_task_id = $2 WHERE id = $1`,
      [id, task.id]
    );
    return task;
  });
}

// --- Feedback ---------------------------------------------------------------

/** An idea id must name an idea on the *same board* the feedback belongs to —
 *  assertColumnOnBoard's cross-board guard (039), so a bare FK cannot file
 *  feedback under another board's idea. not_found for the anti-enumeration reason. */
async function assertIdeaOnBoard(
  client: PoolClient,
  boardId: number,
  ideaId: number
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM idea WHERE id = $1 AND board_id = $2`,
    [ideaId, boardId]
  );
  if (rows.length === 0) {
    throw new AuthzError("not_found", "That idea is not on this board");
  }
}

export async function createFeedback(
  userId: string,
  boardId: number,
  input: CreateFeedbackInput
): Promise<Feedback> {
  await requireBoardRole(userId, boardId, "member");
  return withTransaction(async (client) => {
    if (input.ideaId != null) {
      await assertIdeaOnBoard(client, boardId, input.ideaId);
    }
    const { rows } = await client.query<Feedback>(
      `INSERT INTO feedback (board_id, idea_id, body, source, sentiment)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'idea'))
       RETURNING ${FEEDBACK_COLUMNS}`,
      [
        boardId,
        input.ideaId ?? null,
        input.body.trim(),
        input.source?.trim() ?? "",
        input.sentiment ?? null,
      ]
    );
    return rows[0];
  });
}

/** Resolves a feedback row's own board and proves the caller is a member. */
async function requireFeedback(
  userId: string,
  id: number,
  client: PoolClient
): Promise<{ boardId: number }> {
  const { rows } = await client.query<{ boardId: number }>(
    `SELECT board_id AS "boardId" FROM feedback WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw new AuthzError("not_found", "Feedback not found");
  await requireBoardRole(userId, rows[0].boardId, "member");
  return rows[0];
}

/**
 * Edits a feedback row: re-file it under an idea (or back to the inbox) and/or
 * upvote it. ideaId is three-valued (forms' targetColumn shape): absent leaves
 * the filing, null returns it to the inbox, a number re-files it (checked on-board).
 */
export async function updateFeedback(
  userId: string,
  id: number,
  input: UpdateFeedbackInput
): Promise<Feedback | undefined> {
  return withTransaction(async (client) => {
    const { boardId } = await requireFeedback(userId, id, client);

    const setsIdea = "ideaId" in input;
    if (setsIdea && input.ideaId != null) {
      await assertIdeaOnBoard(client, boardId, input.ideaId);
    }
    const { rows } = await client.query<Feedback>(
      `UPDATE feedback
          SET idea_id = CASE WHEN $2::boolean THEN $3::int ELSE idea_id END,
              votes = votes + CASE WHEN $4::boolean THEN 1 ELSE 0 END
        WHERE id = $1
        RETURNING ${FEEDBACK_COLUMNS}`,
      [id, setsIdea, input.ideaId ?? null, input.vote === true]
    );
    return rows[0];
  });
}

export async function deleteFeedback(
  userId: string,
  id: number
): Promise<boolean> {
  return withTransaction(async (client) => {
    await requireFeedback(userId, id, client);
    await client.query(`DELETE FROM feedback WHERE id = $1`, [id]);
    return true;
  });
}
