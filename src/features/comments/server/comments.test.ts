import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import type { Activity, CommentActivity } from "@/features/activity/types";
import { getBoard } from "@/features/board/server/repository";
import { createTask, deleteTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import { removeMember } from "@/features/workspaces/server/members";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import {
  createComment,
  deleteComment,
  listCommentsForTask,
  updateComment,
} from "./repository";

/**
 * Against a real Postgres, like the two M1 suites before it, and for the same
 * reason: most of what is asserted here is what the *database* does — the
 * CASCADE that takes a thread down with its task, the foreign key that is
 * deliberately absent so a departed author's remarks survive, the CHECK that
 * refuses an empty body. A mocked client would agree with every one of these and
 * prove none of them.
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

/** Narrows a log row to its comment arm, failing loudly if it is not one. */
function asComment(entry: Activity): CommentActivity {
  if (!entry.action.startsWith("comment.")) {
    throw new Error(`Expected a comment entry, got ${entry.action}`);
  }
  return entry as CommentActivity;
}

describe("comments", () => {
  let alice: string; // owner
  let bob: string; // member
  let carol: string; // viewer
  let dave: string; // admin
  let stranger: string; // member of a different workspace entirely
  let workspaceId: string;
  let todoId: number;

  beforeAll(async () => {
    alice = await createUser("cmt-alice");
    bob = await createUser("cmt-bob");
    carol = await createUser("cmt-carol");
    dave = await createUser("cmt-dave");
    stranger = await createUser("cmt-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "CmtAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    await addMember(alice, workspaceId, carol, "viewer");
    await addMember(alice, workspaceId, dave, "admin");
    await ensurePersonalWorkspace(stranger, "CmtStranger");

    const boardId = (await getDefaultBoard(alice))!.id;
    todoId = (await getBoard(alice, boardId))!.columns[0].id;
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

  const newTask = (title = "A task") => createTask(alice, { columnId: todoId, title });

  describe("who may comment", () => {
    it("lets a member comment", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Hi" });
      expect(comment.body).toBe("Hi");
      expect(comment.authorId).toBe(bob);
    });

    it("lets a VIEWER comment", async () => {
      // The deliberate divergence from every other mutation here. A viewer can
      // be handed a task (004); a viewer who cannot comment has been handed work
      // with no way to report back on it. Commenting is participation, not board
      // mutation.
      const task = await newTask();
      const comment = await createComment(carol, {
        taskId: task.id,
        body: "A question",
      });
      expect(comment.authorId).toBe(carol);
    });

    it("still refuses a viewer the board mutations", async () => {
      // Guards the reasoning above rather than the code: "viewers may comment"
      // is only coherent while viewers still cannot edit the board. If this ever
      // passes, the divergence has leaked.
      const task = await newTask();
      await expect(
        createTask(carol, { columnId: todoId, title: "Nope" })
      ).rejects.toThrow(AuthzError);
      expect(task.id).toBeDefined();
    });

    it("reports a task in another workspace as not found, never forbidden", async () => {
      const task = await newTask();
      const error = await createComment(stranger, {
        taskId: task.id,
        body: "Trespass",
      }).catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      // 404, not 403: "no such task" and "someone else's task" must be one
      // answer, or the id space becomes an oracle.
      expect(error.kind).toBe("not_found");
    });

    it("marks a human author as human, so M2's agents are distinguishable", async () => {
      const task = await newTask();
      const comment = await createComment(alice, { taskId: task.id, body: "Mine" });
      expect(comment.authorType).toBe("human");
    });

    it("refuses an empty body at the database, not just the handler", async () => {
      // The handler trims and 400s first, but the CHECK is what makes this true
      // of the table rather than of one code path — at M2 an agent arrives
      // through a different door.
      const task = await newTask();
      await expect(
        createComment(alice, { taskId: task.id, body: "   " })
      ).rejects.toThrow();
    });
  });

  describe("reading a thread", () => {
    it("returns comments oldest first, like a conversation", async () => {
      const task = await newTask();
      await createComment(alice, { taskId: task.id, body: "First" });
      await createComment(bob, { taskId: task.id, body: "Second" });
      await createComment(alice, { taskId: task.id, body: "Third" });

      const thread = await listCommentsForTask(alice, task.id);
      expect(thread.map((c) => c.body)).toEqual(["First", "Second", "Third"]);
    });

    it("resolves the author's name for rendering", async () => {
      const task = await newTask();
      await createComment(bob, { taskId: task.id, body: "Named" });
      const [comment] = await listCommentsForTask(alice, task.id);
      expect(comment.authorName).toBe("Test cmt-bob");
    });

    it("lets a viewer read the thread", async () => {
      const task = await newTask();
      await createComment(alice, { taskId: task.id, body: "Visible" });
      const thread = await listCommentsForTask(carol, task.id);
      expect(thread).toHaveLength(1);
    });

    it("keeps a comment whose author has been deleted, and says who is gone", async () => {
      // author_id carries no FK precisely so this row survives. The name goes
      // null, which the UI renders — the remark stands, the reader is told the
      // author is gone.
      const ghost = await createUser("cmt-ghost");
      await addMember(alice, workspaceId, ghost, "member");
      const task = await newTask();
      await createComment(ghost, { taskId: task.id, body: "I was here" });

      await query(`DELETE FROM "user" WHERE id = $1`, [ghost]);

      const [comment] = await listCommentsForTask(alice, task.id);
      expect(comment.body).toBe("I was here");
      expect(comment.authorId).toBe(ghost);
      expect(comment.authorName).toBeNull();
    });

    it("keeps a departed member's comments, unlike their assignments", async () => {
      // The documented contrast with 004: removing a member CLEARS their
      // assignments, because an assignee is a live claim on work in a workspace
      // they can no longer see. A comment is not a claim — it is a record of
      // something said while they were there, and deleting it would tear a hole
      // in a thread that replied to it.
      const leaver = await createUser("cmt-leaver");
      await addMember(alice, workspaceId, leaver, "member");
      const task = await newTask();
      await createComment(leaver, { taskId: task.id, body: "Still standing" });

      await removeMember(alice, workspaceId, leaver);

      const thread = await listCommentsForTask(alice, task.id);
      expect(thread.map((c) => c.body)).toEqual(["Still standing"]);
    });
  });

  describe("editing", () => {
    it("lets the author edit their own comment", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Draft" });
      const edited = await updateComment(bob, comment.id, { body: "Final" });
      expect(edited.body).toBe("Final");
    });

    it("stamps updated_at on a real edit, so the UI can say (edited)", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Draft" });
      expect(comment.updatedAt).toBeNull();

      const edited = await updateComment(bob, comment.id, { body: "Final" });
      expect(edited.updatedAt).not.toBeNull();
    });

    it("does not stamp updated_at when nothing changed", async () => {
      // A no-op is not a mutation. Bumping updated_at here would render
      // "(edited)" on a comment nobody edited — a false claim about a person's
      // words, which is worse than a missing one.
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Same" });
      const again = await updateComment(bob, comment.id, { body: "Same" });
      expect(again.updatedAt).toBeNull();
    });

    it("refuses a non-author member", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Bob's" });
      const error = await updateComment(alice, comment.id, {
        body: "Alice's edit",
      }).catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      // 403, not 404: alice can see this comment, so refusing by rank leaks
      // nothing she does not already know.
      expect(error.kind).toBe("forbidden");
    });

    it("refuses an ADMIN editing someone else's comment", async () => {
      // The line this codebase draws: an admin may delete a remark but never
      // rewrite one. An admin who can edit your words can put words in your
      // mouth, under your name, with the log recording only "a comment was
      // edited".
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Bob's" });
      const error = await updateComment(dave, comment.id, {
        body: "Dave's words in Bob's mouth",
      }).catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      expect(error.kind).toBe("forbidden");
    });

    it("reports another workspace's comment as not found", async () => {
      const task = await newTask();
      const comment = await createComment(alice, { taskId: task.id, body: "Mine" });
      const error = await updateComment(stranger, comment.id, {
        body: "Theirs",
      }).catch((e) => e);
      expect(error.kind).toBe("not_found");
    });
  });

  describe("deleting", () => {
    it("lets the author delete their own", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Oops" });
      expect(await deleteComment(bob, comment.id)).toBe(true);
      expect(await listCommentsForTask(alice, task.id)).toHaveLength(0);
    });

    it("lets an admin delete someone else's", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Abusive" });
      expect(await deleteComment(dave, comment.id)).toBe(true);
    });

    it("refuses a plain member deleting someone else's", async () => {
      const task = await newTask();
      const comment = await createComment(alice, { taskId: task.id, body: "Alice's" });
      const error = await deleteComment(bob, comment.id).catch((e) => e);
      expect(error).toBeInstanceOf(AuthzError);
      expect(error.kind).toBe("forbidden");
    });

    it("takes the thread down with the task", async () => {
      // CASCADE, the opposite call from activity_log.task_id, which has no FK.
      // A comment is content and means nothing without its task; the log is
      // history and must outlive it.
      const task = await newTask();
      await createComment(alice, { taskId: task.id, body: "Doomed" });
      await deleteTask(alice, task.id);

      const orphans = await queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM comment WHERE task_id = $1`,
        [task.id]
      );
      expect(orphans!.count).toBe("0");
    });
  });

  describe("what the UI may draw", () => {
    it("tells the author they may edit and delete", async () => {
      const task = await newTask();
      await createComment(bob, { taskId: task.id, body: "Bob's" });
      const [comment] = await listCommentsForTask(bob, task.id);
      expect(comment.canEdit).toBe(true);
      expect(comment.canDelete).toBe(true);
    });

    it("tells an admin they may delete but not edit", async () => {
      const task = await newTask();
      await createComment(bob, { taskId: task.id, body: "Bob's" });
      const [comment] = await listCommentsForTask(dave, task.id);
      expect(comment.canEdit).toBe(false);
      expect(comment.canDelete).toBe(true);
    });

    it("tells a non-author member they may do neither", async () => {
      const task = await newTask();
      await createComment(alice, { taskId: task.id, body: "Alice's" });
      const [comment] = await listCommentsForTask(bob, task.id);
      expect(comment.canEdit).toBe(false);
      expect(comment.canDelete).toBe(false);
    });
  });

  describe("every comment mutation is logged", () => {
    it("logs comment.created with the comment in `after` and no `before`", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Logged" });

      const [entry] = await listRawActivityForTask(task.id);
      const logged = asComment(entry);
      expect(logged.action).toBe("comment.created");
      expect(logged.actorType).toBe("human");
      expect(logged.actorId).toBe(bob);
      expect(logged.before).toBeNull();
      expect(logged.after).toEqual({
        commentId: comment.id,
        body: "Logged",
        author: { type: "human", id: bob },
        // Carried since 033 — a top-level remark's parent is null.
        parentId: null,
      });
    });

    it("logs comment.updated with both bodies", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Before" });
      await updateComment(bob, comment.id, { body: "After" });

      const [entry] = await listRawActivityForTask(task.id);
      const logged = asComment(entry);
      expect(logged.action).toBe("comment.updated");
      expect(logged.before!.body).toBe("Before");
      expect(logged.after!.body).toBe("After");
    });

    it("writes no row for an edit that changed nothing", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Same" });
      await updateComment(bob, comment.id, { body: "Same" });

      // Newest first — the log is an audit trail, not the thread.
      const entries = await listRawActivityForTask(task.id);
      expect(entries.map((e) => e.action)).toEqual([
        "comment.created",
        "task.created",
      ]);
    });

    it("records the AUTHOR when an admin deletes someone else's comment", async () => {
      // The row that justifies CommentSnapshot carrying an author at all: here
      // the actor and the author are different people, and without the snapshot
      // the log would say only that dave deleted *a* comment.
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Bob's" });
      await deleteComment(dave, comment.id);

      const [entry] = await listRawActivityForTask(task.id);
      const logged = asComment(entry);
      expect(logged.action).toBe("comment.deleted");
      expect(logged.actorId).toBe(dave);
      expect(logged.before!.author).toEqual({ type: "human", id: bob });
      expect(logged.before!.body).toBe("Bob's");
    });

    it("keeps the log of a comment after the comment is gone", async () => {
      const task = await newTask();
      const comment = await createComment(bob, { taskId: task.id, body: "Ephemeral" });
      await deleteComment(bob, comment.id);

      const entries = await listRawActivityForTask(task.id);
      expect(entries.map((e) => e.action)).toEqual([
        "comment.deleted",
        "comment.created",
        "task.created",
      ]);
    });

    it("records the workspace and board on every comment entry", async () => {
      // board_id cannot be backfilled later — the task it would join through may
      // be gone by then. 003's lesson, applied to a new action.
      const task = await newTask();
      await createComment(bob, { taskId: task.id, body: "Placed" });

      const [entry] = await listRawActivityForTask(task.id);
      expect(entry.workspaceId).toBe(workspaceId);
      expect(entry.boardId).not.toBeNull();
    });
  });
});
