import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listRawActivityForTask } from "@/features/activity/server/repository";
import { getBoard } from "@/features/board/server/repository";
import { createTask, getTask, updateTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createLabel, deleteLabel, listLabels, updateLabel } from "./repository";

/**
 * Against a real Postgres, and here more than anywhere: the controlled
 * vocabulary is a unique index over an expression, and the tenancy invariant is
 * a join no constraint can see. Both are claims about the database. A mocked
 * client would agree with every test below and prove none of them.
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

describe("labels", () => {
  let alice: string;
  let bob: string;
  let viewer: string;
  let stranger: string;
  let workspaceId: string;
  let strangerWorkspaceId: string;
  let todoId: number;

  beforeAll(async () => {
    alice = await createUser("lab-alice");
    bob = await createUser("lab-bob");
    viewer = await createUser("lab-viewer");
    stranger = await createUser("lab-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "LabAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    await addMember(alice, workspaceId, viewer, "viewer");
    strangerWorkspaceId = (await ensurePersonalWorkspace(stranger, "LabStranger")).id;

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

  let seq = 0;
  /** Unique per call: the uniqueness tests need names nothing else has taken. */
  const newLabel = (over: Partial<{ name: string; color: string }> = {}) =>
    createLabel(alice, workspaceId, {
      name: `label-${(seq += 1)}`,
      ...over,
    } as { name: string });

  const newTask = (over: Record<string, unknown> = {}) =>
    createTask(alice, { columnId: todoId, title: "A task", ...over });

  const actionsFor = async (taskId: number) =>
    (await listRawActivityForTask(taskId)).map((e) => e.action);

  describe("the vocabulary is controlled", () => {
    it("refuses a second label whose name differs only in case", async () => {
      // The reason the whole feature is a table rather than a TEXT[] on task.
      // bug/Bug/BUG as three labels is the drift a free-text field guarantees,
      // and this is the constraint that forbids it.
      await createLabel(alice, workspaceId, { name: "Regression" });
      await expect(
        createLabel(alice, workspaceId, { name: "regression" })
      ).rejects.toMatchObject({ kind: "conflict" });
    });

    it("enforces it in the database, not only in the check", async () => {
      // The repository checks first so the answer is a sentence rather than a
      // 500. But two concurrent requests can both pass that check and both
      // insert, and only the index is there for that — so the index has to be
      // real. Inserting past the repository proves it is.
      await createLabel(alice, workspaceId, { name: "Racy" });
      await expect(
        query(`INSERT INTO label (workspace_id, name) VALUES ($1, $2)`, [
          workspaceId,
          "rAcY",
        ])
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("names the label that already exists, in the case it was created with", async () => {
      // "already has a label called Regression" is actionable; "already exists"
      // sends the reader to go and look for something they will not find,
      // because they typed it in a different case.
      await createLabel(alice, workspaceId, { name: "Flaky" });
      await expect(
        createLabel(alice, workspaceId, { name: "FLAKY" })
      ).rejects.toThrow(/"Flaky"/);
    });

    it("scopes the vocabulary to a workspace, so two may share a name", async () => {
      // The 007 decision. A label is workspace-scoped, so "bug" in one workspace
      // says nothing about "bug" in another — and the unique index is on
      // (workspace_id, lower(name)) rather than lower(name) alone.
      await createLabel(alice, workspaceId, { name: "Shared" });
      const theirs = await createLabel(stranger, strangerWorkspaceId, {
        name: "Shared",
      });
      expect(theirs.name).toBe("Shared");
    });

    it("lists a workspace's labels and nobody else's", async () => {
      const mine = await listLabels(alice, workspaceId);
      const theirs = await listLabels(stranger, strangerWorkspaceId);
      expect(mine.every((l) => l.workspaceId === workspaceId)).toBe(true);
      expect(theirs.map((l) => l.id)).not.toContain(mine[0]?.id);
    });

    it("hides another workspace's vocabulary entirely", async () => {
      await expect(listLabels(stranger, workspaceId)).rejects.toMatchObject({
        kind: "not_found",
      });
    });
  });

  describe("who may change the vocabulary", () => {
    it("lets a member add a label", async () => {
      const label = await createLabel(bob, workspaceId, { name: "ByBob" });
      expect(label.id).toBeGreaterThan(0);
    });

    it("does not let a viewer add one", async () => {
      await expect(
        createLabel(viewer, workspaceId, { name: "ByViewer" })
      ).rejects.toBeInstanceOf(AuthzError);
    });

    it("takes an admin to delete one, not a member", async () => {
      // §7.4's blast-radius rule applied to people, as the columns work applies
      // it: adding a label is ordinary, deleting one reaches every task wearing
      // it. Bob is a member and may create; he may not delete.
      const label = await newLabel();
      await expect(deleteLabel(bob, label.id)).rejects.toMatchObject({
        kind: "forbidden",
      });
      expect(await deleteLabel(alice, label.id)).toBe(true);
    });

    it("reports another workspace's label as missing, not forbidden", async () => {
      // M0's rule: "no such label" and "someone else's label" are the same
      // answer, or the id space is an oracle.
      const theirs = await createLabel(stranger, strangerWorkspaceId, {
        name: "Theirs",
      });
      await expect(
        updateLabel(alice, theirs.id, { name: "Mine now" })
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  describe("a task's labels", () => {
    it("are set at creation", async () => {
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      expect(task.labels).toEqual([{ id: label.id, name: label.name }]);
    });

    it("come back from a plain read, not only from the write", async () => {
      // taskColumns resolves labels with a correlated subquery, and the outer
      // reference has to be qualified: `WHERE tl.task_id = id` binds `id` to the
      // *label* joined inside the subquery, because Postgres resolves the
      // innermost scope first. It compiles, it runs, and it silently returns the
      // wrong set. This read is what catches it.
      const label = await newLabel();
      const created = await newTask({ labelIds: [label.id] });
      const read = await getTask(alice, created.id);
      expect(read!.labels).toEqual([{ id: label.id, name: label.name }]);
    });

    it("are [] rather than null when there are none", async () => {
      // json_agg over no rows is NULL, and the COALESCE is what makes the empty
      // set an empty set. It is also what keeps labelIds two-valued: a null here
      // would put back the three-valued problem 006 avoided.
      const task = await newTask();
      expect(task.labels).toEqual([]);
    });

    it("are replaced as a set, not merged", async () => {
      const [a, b, c] = [await newLabel(), await newLabel(), await newLabel()];
      const task = await newTask({ labelIds: [a.id, b.id] });
      const updated = await updateTask(alice, task.id, { labelIds: [b.id, c.id] });
      expect(updated!.labels.map((l) => l.id).sort()).toEqual(
        [b.id, c.id].sort()
      );
    });

    it("are cleared by [] — no null needed", async () => {
      // 006's rule, holding for a third field without being re-derived: a set has
      // a non-null value meaning empty, so nothing has to be three-valued.
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      const cleared = await updateTask(alice, task.id, { labelIds: [] });
      expect(cleared!.labels).toEqual([]);
    });

    it("are left alone when labelIds is absent", async () => {
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      const renamed = await updateTask(alice, task.id, { title: "Renamed" });
      expect(renamed!.labels).toHaveLength(1);
    });

    it("tolerate the same label twice in one request", async () => {
      // A picker cannot send this, but an agent's tool call at M2 can, and the
      // primary key would reject the second insert. Deduped rather than 500.
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id, label.id] });
      expect(task.labels).toHaveLength(1);
    });
  });

  describe("the tenancy invariant no constraint can express", () => {
    it("refuses a label from another workspace", async () => {
      // 007 states it and cannot enforce it: the FK proves the label exists
      // somewhere. Without assertLabelsInWorkspace, a stranger's vocabulary
      // renders on a board that never defined it — 004's assignee problem, one
      // table over.
      const theirs = await createLabel(stranger, strangerWorkspaceId, {
        name: "Foreign",
      });
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { labelIds: [theirs.id] })
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("refuses a label that does not exist at all, with the same answer", async () => {
      const task = await newTask();
      await expect(
        updateTask(alice, task.id, { labelIds: [999_999] })
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("refuses at creation too, not only on update", async () => {
      const theirs = await createLabel(stranger, strangerWorkspaceId, {
        name: "Foreign2",
      });
      await expect(newTask({ labelIds: [theirs.id] })).rejects.toMatchObject({
        kind: "not_found",
      });
    });
  });

  describe("deleting a label", () => {
    it("is allowed while tasks wear it, unlike deleting a populated column", async () => {
      // The difference is what the CASCADE destroys. task.column_id CASCADEs to
      // tasks, so that button would delete work and is refused with a 409. Here
      // it CASCADEs to links: the tasks are untouched and lose a label, which is
      // what "delete this label" means. Refusing would be ceremony.
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });

      expect(await deleteLabel(alice, label.id)).toBe(true);

      const survivor = await getTask(alice, task.id);
      expect(survivor).toBeDefined();
      expect(survivor!.labels).toEqual([]);
    });

    it("logs one task.labeled per affected task, not one for the batch", async () => {
      // unassignFromWorkspace's rule. A reader of a task's history is the only
      // audience for why a label vanished from their card, and "deleted a label"
      // in a workspace feed is neither attributable per task nor revertible.
      const label = await newLabel();
      const [one, two] = [
        await newTask({ labelIds: [label.id] }),
        await newTask({ labelIds: [label.id] }),
      ];
      await deleteLabel(alice, label.id);

      expect(await actionsFor(one.id)).toContain("task.labeled");
      expect(await actionsFor(two.id)).toContain("task.labeled");
    });

    it("records the label's name in the entry that outlives it", async () => {
      // ColumnSnapshot.title's reasoning, one migration later. The label row is
      // gone, so an id alone could never name what was removed — and this is the
      // entry a reader is most likely to be asking about.
      const label = await newLabel({ name: "doomed-label" });
      const task = await newTask({ labelIds: [label.id] });
      await deleteLabel(alice, label.id);

      const entry = (await listRawActivityForTask(task.id)).find(
        (e) => e.action === "task.labeled"
      )!;
      expect(entry.before).toMatchObject({
        labels: [{ id: label.id, name: "doomed-label" }],
      });
      expect(entry.after).toMatchObject({ labels: [] });
    });

    it("leaves the task's other labels alone", async () => {
      const [doomed, keeper] = [await newLabel(), await newLabel()];
      const task = await newTask({ labelIds: [doomed.id, keeper.id] });
      await deleteLabel(alice, doomed.id);

      const survivor = await getTask(alice, task.id);
      expect(survivor!.labels).toEqual([{ id: keeper.id, name: keeper.name }]);
    });
  });

  describe("the log", () => {
    it("writes task.labeled separately from the edit beside it", async () => {
      // M2's changeset review accepts an agent's actions in parts, and criterion
      // #1 has it label and comment on each of twenty bugs.
      const label = await newLabel();
      const task = await newTask();
      await updateTask(alice, task.id, {
        title: "Renamed and labelled",
        labelIds: [label.id],
      });
      const actions = await actionsFor(task.id);
      expect(actions).toContain("task.labeled");
      expect(actions).toContain("task.updated");
    });

    it("does not log when the label set does not change", async () => {
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      await updateTask(alice, task.id, { labelIds: [label.id] });
      expect(await actionsFor(task.id)).not.toContain("task.labeled");
    });

    it("does not log when the same set arrives in a different order", async () => {
      // sameLabels compares ids as a set. Both sides come back ordered by id, so
      // a positional compare would pass today and break the moment someone sorts
      // the picker's output — logging a change that never happened, forever, on
      // an append-only table.
      const [a, b] = [await newLabel(), await newLabel()];
      const task = await newTask({ labelIds: [a.id, b.id] });
      await updateTask(alice, task.id, { labelIds: [b.id, a.id] });
      expect(await actionsFor(task.id)).not.toContain("task.labeled");
    });

    it("does not log a task.labeled row when a label is renamed", async () => {
      // The tasks did not change — the vocabulary did. Five hundred task.labeled
      // rows for one rename would bury the actual event under bookkeeping, which
      // is the call task.moved already makes about the siblings it shifts.
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      await updateLabel(alice, label.id, { name: "renamed-label" });
      expect(await actionsFor(task.id)).not.toContain("task.labeled");
    });

    it("logs a task created with labels as created, not as labelled", async () => {
      // The labels are part of what was created, not a change to it: there is no
      // `before` for them to differ from, and a task.labeled row here would
      // invert to "remove the labels from a task that does not exist".
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      const actions = await actionsFor(task.id);
      expect(actions).toContain("task.created");
      expect(actions).not.toContain("task.labeled");
    });
  });

  describe("names", () => {
    it("keeps the case it was given while comparing without it", async () => {
      const label = await createLabel(alice, workspaceId, { name: "NeedsDesign" });
      expect(label.name).toBe("NeedsDesign");
    });

    it("defaults to slate", async () => {
      expect((await newLabel()).color).toBe("slate");
    });

    it("renames without touching the tasks that wear it", async () => {
      const label = await newLabel();
      const task = await newTask({ labelIds: [label.id] });
      await updateLabel(alice, label.id, { name: "after-rename" });

      const read = await getTask(alice, task.id);
      expect(read!.labels).toEqual([{ id: label.id, name: "after-rename" }]);
    });

    it("refuses a rename onto another label's name", async () => {
      await createLabel(alice, workspaceId, { name: "Taken" });
      const other = await newLabel();
      await expect(
        updateLabel(alice, other.id, { name: "taken" })
      ).rejects.toMatchObject({ kind: "conflict" });
    });

    it("lets a label keep its own name while changing colour", async () => {
      // The `id <> $3` in the clash check. Without it, renaming a label to what
      // it is already called collides with itself.
      const label = await newLabel();
      const updated = await updateLabel(alice, label.id, {
        name: label.name,
        color: "red",
      });
      expect(updated.color).toBe("red");
    });
  });
});
