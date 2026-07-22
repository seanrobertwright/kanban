import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { createTask } from "@/features/tasks/server/repository";
import { createConnection, ingestCiEvent, listTaskCiStatuses } from "./repository";
import { normalizeGithubCiEvent } from "./github";
import { normalizeGitlabCiEvent } from "./gitlab";
import type { NormalizedCiEvent } from "../types";

/**
 * CI/CD integration (2.7): check_suite/pipeline normalization is pure; the ingest
 * upserts a task_ci_status resolved by the run's branch, fires git.ci_passed /
 * git.ci_failed only on the transition to a terminal conclusion, and is idempotent
 * on redelivery.
 */

describe("normalizeGithubCiEvent", () => {
  it("maps a completed successful check_suite", () => {
    const e = normalizeGithubCiEvent("check_suite", {
      check_suite: {
        id: 900,
        head_branch: "feature/7-x",
        head_sha: "abc",
        status: "completed",
        conclusion: "success",
        app: { name: "GitHub Actions" },
      },
      repository: { full_name: "o/r" },
    });
    expect(e).toMatchObject({
      provider: "github",
      externalId: "900",
      status: "completed",
      conclusion: "success",
      branch: "feature/7-x",
      url: "https://github.com/o/r/commit/abc/checks",
      title: "GitHub Actions",
    });
  });

  it("holds conclusion null while in progress, folds failure conclusions, and ignores others", () => {
    const running = normalizeGithubCiEvent("check_suite", {
      check_suite: { id: 1, head_branch: "b", status: "in_progress", conclusion: null },
    });
    expect(running).toMatchObject({ status: "in_progress", conclusion: null });

    const timedOut = normalizeGithubCiEvent("check_suite", {
      check_suite: { id: 2, head_branch: "b", status: "completed", conclusion: "timed_out" },
    });
    expect(timedOut).toMatchObject({ conclusion: "failure" });

    expect(normalizeGithubCiEvent("push", {})).toBeNull();
    expect(
      normalizeGithubCiEvent("check_suite", { check_suite: { id: 3, status: "completed" } })
    ).toBeNull(); // no head_branch → unresolvable
  });
});

describe("normalizeGitlabCiEvent", () => {
  it("folds pipeline statuses onto (status, conclusion)", () => {
    const success = normalizeGitlabCiEvent({
      object_kind: "pipeline",
      object_attributes: { id: 31, ref: "feature/7-x", status: "success", url: "u" },
      project: { web_url: "https://gitlab.com/o/r", name: "r" },
    });
    expect(success).toMatchObject({
      provider: "gitlab",
      externalId: "31",
      status: "completed",
      conclusion: "success",
      branch: "feature/7-x",
      url: "u",
      title: "r",
    });

    const failed = normalizeGitlabCiEvent({
      object_kind: "pipeline",
      object_attributes: { id: 32, ref: "b", status: "failed" },
      project: { web_url: "https://gitlab.com/o/r" },
    });
    expect(failed).toMatchObject({
      status: "completed",
      conclusion: "failure",
      url: "https://gitlab.com/o/r/-/pipelines/32",
    });

    const running = normalizeGitlabCiEvent({
      object_kind: "pipeline",
      object_attributes: { id: 33, ref: "b", status: "running" },
    });
    expect(running).toMatchObject({ status: "in_progress", conclusion: null });

    expect(normalizeGitlabCiEvent({ object_kind: "merge_request" })).toBeNull();
  });
});

describe("git CI ingress (db)", () => {
  const createdUsers: string[] = [];
  let alice: string;
  let workspaceId: string;
  let startCol: number;

  beforeAll(async () => {
    alice = `test-ci-alice-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [alice, "Cia Eye", `${alice}@example.test`]
    );
    createdUsers.push(alice);
    await ensurePersonalWorkspace(alice, "CiAlice");
    const board = (await getDefaultBoard(alice))!;
    workspaceId = board.workspaceId;
    startCol = (await getBoard(alice, board.id))!.columns[0].id;
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

  function ciEvent(taskId: number, over: Partial<NormalizedCiEvent> = {}): NormalizedCiEvent {
    return {
      provider: "github",
      externalId: "5000",
      ref: `feature/${taskId}-x`,
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/o/r/commit/abc/checks",
      title: "CI",
      branch: `feature/${taskId}-x`,
      ...over,
    };
  }

  it("upserts a run, fires ci_failed once, and is idempotent on redelivery", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/ci",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Build me" });

    // in_progress upserts the row but fires nothing.
    const running = await ingestCiEvent(
      connection,
      ciEvent(task.id, { status: "in_progress", conclusion: null })
    );
    expect(running.linkedTaskIds).toEqual([]);
    let rows = await listTaskCiStatuses(alice, task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "in_progress", conclusion: null });

    // Completing with a failure fires git.ci_failed and updates the same row.
    const failed = await ingestCiEvent(connection, ciEvent(task.id));
    expect(failed.linkedTaskIds).toEqual([task.id]);
    rows = await listTaskCiStatuses(alice, task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", conclusion: "failure" });

    const activity = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log
        WHERE task_id = $1 AND action = 'git.ci_failed' ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    expect(activity).toBeTruthy();

    // Redelivering the identical completed state fires nothing.
    const again = await ingestCiEvent(connection, ciEvent(task.id));
    expect(again.linkedTaskIds).toEqual([]);
  });

  it("fires git.ci_passed for a successful run", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/ci-pass",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Green build" });

    const passed = await ingestCiEvent(
      connection,
      ciEvent(task.id, { externalId: "6000", conclusion: "success" })
    );
    expect(passed.linkedTaskIds).toEqual([task.id]);
    const activity = await queryOne<{ id: string }>(
      `SELECT id FROM activity_log
        WHERE task_id = $1 AND action = 'git.ci_passed' ORDER BY id DESC LIMIT 1`,
      [task.id]
    );
    expect(activity).toBeTruthy();
  });

  it("does not fire for a neutral (skipped) conclusion but still records it", async () => {
    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/ci-neutral",
    });
    const task = await createTask(alice, { columnId: startCol, title: "Skipped build" });

    const neutral = await ingestCiEvent(
      connection,
      ciEvent(task.id, { externalId: "7000", conclusion: "neutral" })
    );
    expect(neutral.linkedTaskIds).toEqual([]);
    const rows = await listTaskCiStatuses(alice, task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].conclusion).toBe("neutral");
  });

  it("ignores a run whose branch names a task in another workspace (tenancy)", async () => {
    const bob = `test-ci-bob-${randomUUID()}`;
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
      [bob, "Bob Other", `${bob}@example.test`]
    );
    createdUsers.push(bob);
    await ensurePersonalWorkspace(bob, "CiBob");
    const bobBoard = (await getDefaultBoard(bob))!;
    const bobCols = (await getBoard(bob, bobBoard.id))!.columns;
    const bobTask = await createTask(bob, { columnId: bobCols[0].id, title: "Bob's task" });

    const { connection } = await createConnection(alice, workspaceId, {
      provider: "github",
      externalRepo: "acme/ci-tenancy",
    });
    const result = await ingestCiEvent(connection, ciEvent(bobTask.id, { externalId: "8000" }));
    expect(result.linkedTaskIds).toEqual([]);
    expect(await listTaskCiStatuses(bob, bobTask.id)).toHaveLength(0);
  });
});
