import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { createConnection } from "@/features/git/server/repository";
import {
  normalizeGithubReleaseEvent,
} from "@/features/git/server/github";
import { normalizeGitlabReleaseEvent } from "@/features/git/server/gitlab";
import {
  createRelease,
  deleteRelease,
  ingestReleaseEvent,
  listReleaseTasks,
  listReleases,
  setTaskRelease,
  updateRelease,
} from "./repository";

/**
 * Release management (2.8): CRUD + rollup, task assignment, manual ship (freezes
 * auto-notes), and the git-tag ingress that ships a matching planned release
 * within the connection's workspace only.
 */

const HUMAN = (id: string) => ({ type: "human" as const, id });

describe("normalize release events (pure)", () => {
  it("maps a published GitHub release, ignores a draft/created", () => {
    const published = normalizeGithubReleaseEvent("release", {
      action: "published",
      release: { tag_name: "v1.2.0", name: "1.2", html_url: "u", body: "notes", draft: false },
    });
    expect(published).toMatchObject({ provider: "github", tag: "v1.2.0", published: true });

    const draft = normalizeGithubReleaseEvent("release", {
      action: "published",
      release: { tag_name: "v1.3.0", draft: true },
    });
    expect(draft).toMatchObject({ published: false });
    expect(normalizeGithubReleaseEvent("push", {})).toBeNull();
  });

  it("maps a GitLab release create as published, update as not", () => {
    const created = normalizeGitlabReleaseEvent({
      object_kind: "release",
      action: "create",
      tag: "v2.0.0",
      name: "2.0",
      url: "u",
      description: "d",
    });
    expect(created).toMatchObject({ provider: "gitlab", tag: "v2.0.0", published: true });

    const updated = normalizeGitlabReleaseEvent({
      object_kind: "release",
      action: "update",
      tag: "v2.0.0",
    });
    expect(updated).toMatchObject({ published: false });
    expect(normalizeGitlabReleaseEvent({ object_kind: "pipeline" })).toBeNull();
  });
});

describe("releases (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let boardId: number;
  let startCol: number;
  let doneCol: number;

  beforeAll(async () => {
    alice = `test-rel-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Rae Lease", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "RelAlice");
    const board = (await getDefaultBoard(alice))!;
    boardId = board.id;
    workspaceId = board.workspaceId;
    const cols = (await getBoard(alice, boardId))!.columns;
    startCol = cols[0].id;
    doneCol = cols[cols.length - 1].id;
    // Make rollup deterministic: name the last column the board's done column.
    await query(`UPDATE board SET done_column_id = $2 WHERE id = $1`, [boardId, doneCol]);
  });

  afterAll(async () => {
    await query(
      `DELETE FROM workspace w WHERE EXISTS (
         SELECT 1 FROM workspace_member m WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("creates a release, refuses a duplicate name, and rolls up assigned tasks", async () => {
    const release = await createRelease(alice, boardId, { name: "v1.0.0" }, HUMAN(alice));
    expect(release).toMatchObject({ name: "v1.0.0", state: "planned", total: 0, done: 0 });

    await expect(
      createRelease(alice, boardId, { name: "v1.0.0" }, HUMAN(alice))
    ).rejects.toThrow(/already exists/);

    const t1 = await createTask(alice, { columnId: startCol, title: "Add OAuth" });
    const t2 = await createTask(alice, { columnId: doneCol, title: "Fix login" });
    await setTaskRelease(alice, t1.id, release.id);
    await setTaskRelease(alice, t2.id, release.id);

    const [rolled] = (await listReleases(alice, boardId)).filter((r) => r.id === release.id);
    expect(rolled).toMatchObject({ total: 2, done: 1 });

    const tasks = await listReleaseTasks(alice, release.id);
    expect(tasks.map((t) => t.title).sort()).toEqual(["Add OAuth", "Fix login"]);

    // Unassigning drops it from the rollup.
    await setTaskRelease(alice, t1.id, null);
    const [after] = (await listReleases(alice, boardId)).filter((r) => r.id === release.id);
    expect(after.total).toBe(1);
  });

  it("ships a release by hand, freezing auto-notes from its tasks", async () => {
    const release = await createRelease(alice, boardId, { name: "v1.1.0" }, HUMAN(alice));
    const t = await createTask(alice, { columnId: startCol, title: "Ship notes item" });
    await setTaskRelease(alice, t.id, release.id);

    const shipped = await updateRelease(alice, release.id, { state: "released" }, HUMAN(alice));
    expect(shipped).toMatchObject({ state: "released" });
    expect(shipped!.releasedAt).toBeTruthy();
    expect(shipped!.notes).toBe("- Ship notes item");

    const logged = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log WHERE board_id = $1 AND action = 'release.released'
        ORDER BY id DESC LIMIT 1`,
      [boardId]
    );
    expect(logged).toBeTruthy();
  });

  it("refuses assigning a task from another board (tenancy)", async () => {
    const bob = `test-rel-bob-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [bob, "Bob Other", `${bob}@example.test`]
    );
    createdUsers.push(bob);
    await ensurePersonalWorkspace(bob, "RelBob");
    const bobBoard = (await getDefaultBoard(bob))!;
    const bobCols = (await getBoard(bob, bobBoard.id))!.columns;
    const bobTask = await createTask(bob, { columnId: bobCols[0].id, title: "Bob's" });

    const release = await createRelease(alice, boardId, { name: "v1.2.0" }, HUMAN(alice));
    // Alice can't reach Bob's task, so requireTaskRole refuses before the board check.
    await expect(setTaskRelease(alice, bobTask.id, release.id)).rejects.toThrow();
  });

  it("ships a planned release when a matching git tag publishes, idempotently", async () => {
    const release = await createRelease(alice, boardId, { name: "v9.9.9" }, HUMAN(alice));
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/rel",
    });

    // An unpublished event ships nothing.
    const draft = await ingestReleaseEvent(connection, {
      provider: "github",
      tag: "v9.9.9",
      name: null,
      url: "u",
      notes: null,
      published: false,
    });
    expect(draft.releasedIds).toEqual([]);

    const shipped = await ingestReleaseEvent(connection, {
      provider: "github",
      tag: "v9.9.9",
      name: "9.9.9",
      url: "https://github.com/acme/rel/releases/v9.9.9",
      notes: "tagged notes",
      published: true,
    });
    expect(shipped.releasedIds).toEqual([release.id]);

    const [after] = (await listReleases(alice, boardId)).filter((r) => r.id === release.id);
    expect(after).toMatchObject({ state: "released", notes: "tagged notes" });
    expect(after.url).toBe("https://github.com/acme/rel/releases/v9.9.9");

    // Redelivery finds it already released — no-op.
    const again = await ingestReleaseEvent(connection, {
      provider: "github",
      tag: "v9.9.9",
      name: null,
      url: "u",
      notes: null,
      published: true,
    });
    expect(again.releasedIds).toEqual([]);
  });

  it("a repo cannot ship another workspace's release (tenancy)", async () => {
    const carol = `test-rel-carol-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [carol, "Carol Other", `${carol}@example.test`]
    );
    createdUsers.push(carol);
    await ensurePersonalWorkspace(carol, "RelCarol");
    const carolBoard = (await getDefaultBoard(carol))!;
    const carolRelease = await createRelease(
      carol,
      carolBoard.id,
      { name: "v5.5.5" },
      HUMAN(carol)
    );

    // Alice's connection names Carol's tag — must not ship it.
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/rel-tenancy",
    });
    const result = await ingestReleaseEvent(connection, {
      provider: "github",
      tag: "v5.5.5",
      name: null,
      url: "u",
      notes: null,
      published: true,
    });
    expect(result.releasedIds).toEqual([]);
    const [untouched] = (await listReleases(carol, carolBoard.id)).filter(
      (r) => r.id === carolRelease.id
    );
    expect(untouched.state).toBe("planned");

    // Deleting the release un-ships is n/a; just exercise delete's authz + SET NULL.
    expect(await deleteRelease(carol, carolRelease.id, HUMAN(carol))).toBe(true);
  });
});
