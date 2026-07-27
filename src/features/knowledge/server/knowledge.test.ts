import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  createBoard,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { askWorkspaceKnowledge } from "./repository";

/**
 * Knowledge Q&A is a retrieval surface over everything in a workspace, so its
 * authorization filter IS the feature: SPEC 4.3 says an answer must never leak
 * a board the asker cannot read. The filter lives entirely in SQL — a workspace
 * role, a board permission_grant, an object_share — which is exactly the shape
 * that fails silently, returning rows instead of raising. Every case below is
 * therefore a negative assertion as much as a positive one: what a principal
 * sees, and what they must not.
 *
 * The retrieval term is a nonsense word so these fixtures cannot collide with
 * anything another test file leaves in the shared database.
 */

const TERM = "zarquon";
const createdUsers: string[] = [];
let apiKey: string | undefined;

async function expectAuthzError(
  fn: () => Promise<unknown>,
  kind: "not_found" | "forbidden" | "conflict"
) {
  await expect(fn()).rejects.toThrow(AuthzError);
  await expect(fn()).rejects.toMatchObject({ kind });
}

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

async function firstColumn(userId: string, boardId: number): Promise<number> {
  return (await getBoard(userId, boardId))!.columns[0].id;
}

describe("workspace knowledge Q&A", () => {
  let alice: string; // owner
  let vera: string; // viewer
  let gary: string; // guest, granted read on the open board only
  let gina: string; // guest with no grants at all
  let stranger: string; // not a member
  let workspaceId: string;
  let openBoardId: number;
  let closedBoardId: number;
  let openTaskId: number;
  let closedTaskId: number;
  let docId: number;

  beforeAll(async () => {
    // A developer's .env.local may carry an ANTHROPIC_API_KEY, which would send
    // the un-injected cases below to the real model. Retrieval, not synthesis,
    // is what these tests are about — unset it and inject where prose matters.
    apiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    alice = await createUser("kb-alice");
    workspaceId = (await ensurePersonalWorkspace(alice, "KbAlice")).id;
    openBoardId = (await getDefaultBoard(alice))!.id;
    closedBoardId = (await createBoard(alice, workspaceId, "Closed")).id;

    openTaskId = (
      await createTask(alice, {
        columnId: await firstColumn(alice, openBoardId),
        title: `The ${TERM} rollout`,
        description: "Ship the open-board work first.",
      })
    ).id;
    closedTaskId = (
      await createTask(alice, {
        columnId: await firstColumn(alice, closedBoardId),
        title: `The ${TERM} acquisition`,
        description: "Confidential to the closed board.",
      })
    ).id;
    await query(
      `INSERT INTO comment (task_id, author_type, author_id, body)
       VALUES ($1, 'human', $2, $3)`,
      [closedTaskId, alice, `Board-only note about the ${TERM} numbers`]
    );
    docId = (
      await query<{ id: number }>(
        `INSERT INTO doc (workspace_id, title, body, is_published, created_by)
         VALUES ($1, $2, $3, true, $4) RETURNING id`,
        [workspaceId, `${TERM} handbook`, "How we work.", alice]
      )
    )[0].id;

    vera = await createUser("kb-vera");
    await addMember(alice, workspaceId, vera, "viewer");

    gary = await createUser("kb-gary");
    await addMember(alice, workspaceId, gary, "guest");
    await query(
      `INSERT INTO permission_grant
         (workspace_id, subject_type, subject_id, principal_type, principal_id, capability)
       VALUES ($1, 'board', $2, 'user', $3, 'read')`,
      [workspaceId, String(openBoardId), gary]
    );

    gina = await createUser("kb-gina");
    await addMember(alice, workspaceId, gina, "guest");

    stranger = await createUser("kb-stranger");
    await ensurePersonalWorkspace(stranger, "KbStranger");
  });

  afterAll(async () => {
    if (apiKey !== undefined) process.env.ANTHROPIC_API_KEY = apiKey;
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  const taskIds = (citations: { kind: string; taskId: number | null }[]) =>
    citations.filter((c) => c.kind === "task").map((c) => c.taskId);

  describe("retrieval reach", () => {
    it("gives an owner every board, comment, and published doc", async () => {
      const { citations } = await askWorkspaceKnowledge(alice, workspaceId, TERM);
      expect(taskIds(citations)).toEqual(
        expect.arrayContaining([openTaskId, closedTaskId])
      );
      expect(citations.some((c) => c.kind === "comment")).toBe(true);
      expect(citations.some((c) => c.id === docId && c.kind === "document")).toBe(
        true
      );
    });

    it("gives a viewer every board without needing a per-board grant", async () => {
      const { citations } = await askWorkspaceKnowledge(vera, workspaceId, TERM);
      expect(taskIds(citations)).toEqual(
        expect.arrayContaining([openTaskId, closedTaskId])
      );
    });
  });

  /**
   * 084 replaced 072's unstemmed, recency-ordered retrieval. These cases pin
   * what changed: stemming, relevance ordering, and a fuzzy arm for typos —
   * plus the fact that the fuzzy arm is a second query, and therefore a second
   * chance to leak a board, which it must not take.
   */
  describe("ranking and fuzzy matching", () => {
    const RANK = "quibblex";
    let denseId: number;
    let passingId: number;

    beforeAll(async () => {
      const columnId = await firstColumn(alice, openBoardId);
      denseId = (
        await createTask(alice, {
          columnId,
          title: `The ${RANK} ${RANK} migration`,
          description: `Everything about ${RANK}.`,
        })
      ).id;
      // Created second, so under 072's updated_at ordering this would have come
      // first despite mentioning the term once, in passing.
      passingId = (
        await createTask(alice, {
          columnId,
          title: "Unrelated cleanup",
          description: `Mentions ${RANK} once.`,
        })
      ).id;
    });

    it("ranks by relevance, not by recency", async () => {
      const { citations } = await askWorkspaceKnowledge(alice, workspaceId, RANK);
      const ranked = taskIds(citations);
      expect(ranked).toEqual(expect.arrayContaining([denseId, passingId]));
      expect(ranked.indexOf(denseId)).toBeLessThan(ranked.indexOf(passingId));
    });

    it("stems, so a plural finds the singular the workspace wrote", async () => {
      const { citations } = await askWorkspaceKnowledge(
        alice,
        workspaceId,
        `${RANK} migrations`
      );
      expect(taskIds(citations)).toContain(denseId);
    });

    it("falls back to fuzzy title matching for a typo", async () => {
      // No full-text match: 'migratoin' is not a word the workspace contains.
      const { citations } = await askWorkspaceKnowledge(
        alice,
        workspaceId,
        `${RANK} migratoin`
      );
      expect(taskIds(citations)).toContain(denseId);
    });

    it("keeps the fuzzy arm inside the same board filter", async () => {
      const typo = `${TERM} acquisitoin`;
      // The closed task's title, misspelled: the owner reaches it…
      expect(taskIds((await askWorkspaceKnowledge(alice, workspaceId, typo)).citations))
        .toContain(closedTaskId);
      // …and the guest granted only the open board still cannot.
      const guest = await askWorkspaceKnowledge(gary, workspaceId, typo);
      expect(taskIds(guest.citations)).not.toContain(closedTaskId);
    });
  });

  describe("the board-read filter", () => {
    it("shows a granted guest the open board and NOT the closed one", async () => {
      const { citations } = await askWorkspaceKnowledge(gary, workspaceId, TERM);

      expect(taskIds(citations)).toEqual([openTaskId]);
      // The comment lives on the closed board's task; a comment must not be a
      // side door into a board the grant never opened.
      expect(citations.some((c) => c.kind === "comment")).toBe(false);
      // Docs are workspace-level and readable at viewer+; a guest needs a share.
      expect(citations.some((c) => c.kind === "document")).toBe(false);
    });

    it("shows an ungranted guest nothing at all", async () => {
      const { answer, citations } = await askWorkspaceKnowledge(
        gina,
        workspaceId,
        TERM
      );
      expect(citations).toEqual([]);
      expect(answer).toContain("could not find authorized workspace sources");
    });

    it("opens a single board to a guest through an object_share", async () => {
      await query(
        `INSERT INTO object_share (subject_type, subject_id, user_id)
         VALUES ('board', $1, $2) ON CONFLICT DO NOTHING`,
        [String(closedBoardId), gina]
      );
      const { citations } = await askWorkspaceKnowledge(gina, workspaceId, TERM);
      expect(taskIds(citations)).toEqual([closedTaskId]);
      await query(
        `DELETE FROM object_share WHERE subject_type='board' AND subject_id=$1 AND user_id=$2`,
        [String(closedBoardId), gina]
      );
    });

    it("opens a single doc to a guest through an object_share", async () => {
      await query(
        `INSERT INTO object_share (subject_type, subject_id, user_id)
         VALUES ('doc', $1, $2) ON CONFLICT DO NOTHING`,
        [String(docId), gina]
      );
      const { citations } = await askWorkspaceKnowledge(gina, workspaceId, TERM);
      expect(citations.map((c) => c.kind)).toEqual(["document"]);
      await query(
        `DELETE FROM object_share WHERE subject_type='doc' AND subject_id=$1 AND user_id=$2`,
        [String(docId), gina]
      );
    });

    it("hides an unpublished doc even from the owner", async () => {
      const draft = (
        await query<{ id: number }>(
          `INSERT INTO doc (workspace_id, title, body, is_published, created_by)
           VALUES ($1, $2, $3, false, $4) RETURNING id`,
          [workspaceId, `${TERM} draft`, "Not ready.", alice]
        )
      )[0].id;
      const { citations } = await askWorkspaceKnowledge(alice, workspaceId, TERM);
      expect(citations.some((c) => c.kind === "document" && c.id === draft)).toBe(
        false
      );
      await query(`DELETE FROM doc WHERE id=$1`, [draft]);
    });

    it("answers not_found to a non-member, hiding that the workspace exists", async () => {
      await expectAuthzError(
        () => askWorkspaceKnowledge(stranger, workspaceId, TERM),
        "not_found"
      );
    });
  });

  describe("the answer", () => {
    it("does not search on an empty question", async () => {
      const { answer, citations } = await askWorkspaceKnowledge(alice, workspaceId, "   ");
      expect(citations).toEqual([]);
      expect(answer).toBe("Ask a question to search this workspace.");
    });

    it("uses the injected synthesis over the retrieved citations", async () => {
      const seen: number[] = [];
      const { answer, citations } = await askWorkspaceKnowledge(
        alice,
        workspaceId,
        TERM,
        {
          synthesize: async (question, cites) => {
            seen.push(cites.length);
            return `Synthesized for ${question} [1]`;
          },
        }
      );
      expect(answer).toBe(`Synthesized for ${TERM} [1]`);
      // The model sees only what the authz filter returned, never the raw rows.
      expect(seen[0]).toBe(citations.length);
    });

    it("degrades to the evidence listing when synthesis fails", async () => {
      const { answer, citations } = await askWorkspaceKnowledge(
        alice,
        workspaceId,
        TERM,
        {
          synthesize: async () => {
            throw new Error("model outage");
          },
        }
      );
      // The citations are the grounded part and must survive the outage.
      expect(citations.length).toBeGreaterThan(0);
      expect(answer).toContain("no AI synthesis configured");
      expect(answer).toContain(citations[0].title);
    });

    it("degrades when synthesis returns only whitespace", async () => {
      const { answer } = await askWorkspaceKnowledge(alice, workspaceId, TERM, {
        synthesize: async () => "   ",
      });
      expect(answer).toContain("no AI synthesis configured");
    });
  });
});
