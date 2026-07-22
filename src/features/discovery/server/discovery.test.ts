import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
  listWorkspacesForUser,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createFeedback,
  createIdea,
  deleteIdea,
  getBoardDiscovery,
  promoteIdea,
  PromoteError,
  updateFeedback,
  updateIdea,
} from "./repository";

/**
 * The RICE maths and overview shape are unit-tested pure; the database facts
 * here are the demand rollup, the three-valued feedback filing, promotion
 * (creates a task, stamps promoted + promoted_task_id, refuses a second time),
 * and the SET-NULL of feedback off a deleted idea (043).
 */

const createdUsers: string[] = [];

async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("discovery", () => {
  let alice: string;
  let boardId: number;
  let firstColumnId: number;

  beforeAll(async () => {
    alice = await createUser("disc-alice");
    await ensurePersonalWorkspace(alice, "DiscAlice");
    await listWorkspacesForUser(alice);
    boardId = (await getDefaultBoard(alice))!.id;
    firstColumnId = (await getBoard(alice, boardId))!.columns[0].id;
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("rolls feedback demand up onto its idea", async () => {
    const idea = await createIdea(alice, boardId, {
      title: "Bulk archive",
      reach: 500,
      impact: 2,
      confidence: 100,
      effort: 2,
    });
    await createFeedback(alice, boardId, { body: "please!", ideaId: idea.id, });
    const f2 = await createFeedback(alice, boardId, { body: "need this" });
    // File the second one under the idea via the three-valued update.
    await updateFeedback(alice, f2.id, { ideaId: idea.id, vote: true });

    const overview = await getBoardDiscovery(alice, boardId);
    const signal = overview.ideas.find((i) => i.id === idea.id)!;
    expect(signal.rice).toBe(500); // 500×2×1/2
    expect(signal.feedbackCount).toBe(2);
    expect(signal.demand).toBe(3); // votes 1 + (1 base + 1 upvote)
  });

  it("promotes an idea into a task once, then refuses", async () => {
    const idea = await createIdea(alice, boardId, {
      title: "Dark mode",
      description: "Theme the whole app",
    });
    await createFeedback(alice, boardId, { body: "yes", ideaId: idea.id });

    const task = await promoteIdea(alice, idea.id);
    expect(task.title).toBe("Dark mode");
    expect(task.columnId).toBe(firstColumnId);
    expect(task.description).toContain("Promoted from discovery");

    const overview = await getBoardDiscovery(alice, boardId);
    const promoted = overview.ideas.find((i) => i.id === idea.id)!;
    expect(promoted.status).toBe("promoted");
    expect(promoted.promotedTaskId).toBe(task.id);

    await expect(promoteIdea(alice, idea.id)).rejects.toBeInstanceOf(PromoteError);
  });

  it("returns feedback to the inbox when its idea is deleted", async () => {
    const idea = await createIdea(alice, boardId, { title: "Throwaway" });
    const fb = await createFeedback(alice, boardId, {
      body: "orphan me",
      ideaId: idea.id,
    });
    await deleteIdea(alice, idea.id);

    const overview = await getBoardDiscovery(alice, boardId);
    const still = overview.feedback.find((f) => f.id === fb.id)!;
    expect(still.ideaId).toBeNull();
    expect(overview.ideas.find((i) => i.id === idea.id)).toBeUndefined();
  });

  it("moves an idea through the pipeline via update", async () => {
    const idea = await createIdea(alice, boardId, { title: "Validate me" });
    const updated = await updateIdea(alice, idea.id, { status: "validated" });
    expect(updated?.status).toBe("validated");
  });
});
