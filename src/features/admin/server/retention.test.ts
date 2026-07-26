import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { placeLegalHold, saveRetentionPolicy } from "./retention";
import { sweepRetention } from "./retention-sweeper";

/**
 * The sweeper is the only code in the app that deletes data nobody asked it to
 * delete, on a timer, with no undo. Two ways it can be wrong, both silent: it
 * takes rows it should have kept (a legal hold ignored, another workspace's
 * content swept, fresh content aged out), or it keeps rows it should have taken
 * (a policy the UI accepts but the sweep never honours — the original §2 finding
 * that only activity_log was ever purged). Every case below pins one of those.
 *
 * The whole fixture is built old-then-swept: rows are created through the real
 * repositories, then backdated with a direct UPDATE, because created_at is what
 * the policy compares and there is no other way to reach an aged row.
 */

const AGED = "400 days";
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

async function backdate(table: string, id: number | string) {
  await query(
    `UPDATE ${table} SET created_at = now() - interval '${AGED}' WHERE id = $1`,
    [id]
  );
}

async function exists(table: string, id: number | string): Promise<boolean> {
  return Boolean(await queryOne(`SELECT 1 FROM ${table} WHERE id = $1`, [id]));
}

describe("retention", () => {
  let alice: string; // owner
  let ann: string; // admin — may read policies, may not set them
  let stranger: string;
  let workspaceId: string;
  let boardId: number;
  let columnId: number;

  beforeAll(async () => {
    alice = await createUser("ret-alice");
    workspaceId = (await ensurePersonalWorkspace(alice, "RetAlice")).id;
    boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;

    ann = await createUser("ret-ann");
    await addMember(alice, workspaceId, ann, "admin");
    stranger = await createUser("ret-stranger");
    await ensurePersonalWorkspace(stranger, "RetStranger");
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

  describe("policy administration", () => {
    it("refuses an out-of-range or non-integer age", async () => {
      for (const days of [0, -1, 36501, 1.5]) {
        await expect(
          saveRetentionPolicy(alice, workspaceId, "task", days)
        ).rejects.toMatchObject({ kind: "conflict" });
      }
    });

    it("refuses a subject the sweeper does not sweep", async () => {
      await expect(
        // A subject outside retention.ts's five — the UI must not be able to
        // save a policy nothing will ever act on.
        saveRetentionPolicy(alice, workspaceId, "whiteboard" as never, 30)
      ).rejects.toMatchObject({ kind: "conflict" });
    });

    it("refuses an admin and answers not_found to a non-member", async () => {
      await expect(
        saveRetentionPolicy(ann, workspaceId, "task", 30)
      ).rejects.toMatchObject({ kind: "forbidden" });
      await expect(
        saveRetentionPolicy(stranger, workspaceId, "task", 30)
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("upserts one policy per subject", async () => {
      const first = await saveRetentionPolicy(alice, workspaceId, "task", 30);
      const second = await saveRetentionPolicy(alice, workspaceId, "task", 45);
      expect(second).toMatchObject({ subjectType: "task", maxAgeDays: 45 });
      const rows = await query(
        `SELECT id FROM retention_policy WHERE workspace_id=$1 AND subject_type='task'`,
        [workspaceId]
      );
      expect(rows).toHaveLength(1);
      expect(first).toBeTruthy();
    });
  });

  describe("the sweep", () => {
    // Every subject the UI accepts a policy for, swept in one pass.
    let agedTask: number;
    let freshTask: number;
    let heldHostTask: number; // fresh; hosts the aged comment/attachment cases
    let agedComment: number;
    let heldComment: number;
    let agedAttachment: number;
    let heldAttachment: number;
    let agedDoc: number;
    let parentDoc: number;
    let heldChildDoc: number;
    let cascadeParentTask: number;
    let heldSubtask: number;
    let agedActivity: string;
    let otherWorkspaceTask: number;

    beforeAll(async () => {
      for (const subject of [
        "activity_log",
        "task",
        "comment",
        "attachment",
        "doc",
      ] as const) {
        await saveRetentionPolicy(alice, workspaceId, subject, 30);
      }

      agedTask = (await createTask(alice, { columnId, title: "Aged" })).id;
      freshTask = (await createTask(alice, { columnId, title: "Fresh" })).id;
      heldHostTask = (await createTask(alice, { columnId, title: "Host" })).id;
      await backdate("task", agedTask);

      // A task whose SUBTASK is held: the delete would cascade, so the hold on
      // the child has to protect the parent too.
      cascadeParentTask = (await createTask(alice, { columnId, title: "Parent" })).id;
      heldSubtask = (
        await createTask(alice, {
          columnId,
          title: "Held child",
          parentId: cascadeParentTask,
        })
      ).id;
      await backdate("task", cascadeParentTask);
      await backdate("task", heldSubtask);
      await placeLegalHold(alice, workspaceId, "task", String(heldSubtask), "Litigation");

      const comments = await query<{ id: number }>(
        `INSERT INTO comment (task_id, author_type, author_id, body)
         VALUES ($1,'human',$2,'aged'), ($1,'human',$2,'held')
         RETURNING id`,
        [heldHostTask, alice]
      );
      [agedComment, heldComment] = comments.map((c) => c.id);
      await backdate("comment", agedComment);
      await backdate("comment", heldComment);
      await placeLegalHold(alice, workspaceId, "comment", String(heldComment), "Litigation");

      const attachments = await query<{ id: number }>(
        `INSERT INTO attachment (task_id, key, name, content_type, size, uploaded_by)
         VALUES ($1,$3,'aged.txt','text/plain',1,$2), ($1,$4,'held.txt','text/plain',1,$2)
         RETURNING id`,
        [heldHostTask, alice, `ret-aged-${randomUUID()}`, `ret-held-${randomUUID()}`]
      );
      [agedAttachment, heldAttachment] = attachments.map((a) => a.id);
      await backdate("attachment", agedAttachment);
      await backdate("attachment", heldAttachment);
      await placeLegalHold(alice, workspaceId, "attachment", String(heldAttachment), "Litigation");

      const docs = await query<{ id: number }>(
        `INSERT INTO doc (workspace_id, title, body, created_by)
         VALUES ($1,'Aged doc','',$2), ($1,'Parent doc','',$2)
         RETURNING id`,
        [workspaceId, alice]
      );
      [agedDoc, parentDoc] = docs.map((d) => d.id);
      heldChildDoc = (
        await query<{ id: number }>(
          `INSERT INTO doc (workspace_id, parent_id, title, body, created_by)
           VALUES ($1,$2,'Held child doc','',$3) RETURNING id`,
          [workspaceId, parentDoc, alice]
        )
      )[0].id;
      for (const id of [agedDoc, parentDoc, heldChildDoc]) await backdate("doc", id);
      await placeLegalHold(alice, workspaceId, "doc", String(heldChildDoc), "Litigation");

      // 003's trigger makes activity_log append-only, so this one is born aged
      // rather than backdated — the log is the one table a test cannot rewrite.
      agedActivity = (
        await query<{ id: string }>(
          `INSERT INTO activity_log (workspace_id, board_id, actor_type, actor_id, action, created_at)
           VALUES ($1,$2,'human',$3,'test.aged', now() - interval '${AGED}') RETURNING id::text`,
          [workspaceId, boardId, alice]
        )
      )[0].id;

      // A neighbouring workspace with aged content and no policy at all.
      const otherWorkspaceId = (await ensurePersonalWorkspace(stranger, "RetStranger")).id;
      const otherColumn = (
        await getBoard(stranger, (await getDefaultBoard(stranger))!.id)
      )!.columns[0].id;
      otherWorkspaceTask = (
        await createTask(stranger, { columnId: otherColumn, title: "Untouched" })
      ).id;
      await backdate("task", otherWorkspaceTask);
      expect(otherWorkspaceId).toBeTruthy();

      await sweepRetention();
    });

    it("purges aged activity events and keeps recent ones", async () => {
      expect(
        await queryOne(`SELECT 1 FROM activity_log WHERE id=$1::bigint`, [agedActivity])
      ).toBeUndefined();
      // createTask logs as it goes; those entries are today's and must survive.
      expect(
        await queryOne(
          `SELECT 1 FROM activity_log WHERE workspace_id=$1 AND task_id=$2`,
          [workspaceId, freshTask]
        )
      ).toBeDefined();
    });

    it("purges aged tasks and keeps fresh ones", async () => {
      expect(await exists("task", agedTask)).toBe(false);
      expect(await exists("task", freshTask)).toBe(true);
    });

    it("purges aged comments and attachments on a task it keeps", async () => {
      expect(await exists("task", heldHostTask)).toBe(true);
      expect(await exists("comment", agedComment)).toBe(false);
      expect(await exists("attachment", agedAttachment)).toBe(false);
    });

    it("purges aged docs", async () => {
      expect(await exists("doc", agedDoc)).toBe(false);
    });

    describe("legal holds", () => {
      it("keeps a held comment and a held attachment", async () => {
        expect(await exists("comment", heldComment)).toBe(true);
        expect(await exists("attachment", heldAttachment)).toBe(true);
      });

      it("keeps a parent task whose subtask is held, so the cascade cannot bypass it", async () => {
        expect(await exists("task", heldSubtask)).toBe(true);
        expect(await exists("task", cascadeParentTask)).toBe(true);
      });

      it("keeps a parent doc whose child is held, so the cascade cannot bypass it", async () => {
        expect(await exists("doc", heldChildDoc)).toBe(true);
        expect(await exists("doc", parentDoc)).toBe(true);
      });

      it("resumes sweeping once the hold is released", async () => {
        await query(
          `UPDATE legal_hold SET released_at=now(), released_by=$2
            WHERE workspace_id=$1 AND released_at IS NULL`,
          [workspaceId, alice]
        );
        await sweepRetention();
        expect(await exists("comment", heldComment)).toBe(false);
        expect(await exists("attachment", heldAttachment)).toBe(false);
        expect(await exists("task", cascadeParentTask)).toBe(false);
        expect(await exists("task", heldSubtask)).toBe(false);
        expect(await exists("doc", parentDoc)).toBe(false);
        expect(await exists("doc", heldChildDoc)).toBe(false);
      });
    });

    it("leaves a workspace with no policy entirely alone", async () => {
      expect(await exists("task", otherWorkspaceTask)).toBe(true);
    });
  });
});
