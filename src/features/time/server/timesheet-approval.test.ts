import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { weekStart } from "../lib/timesheet";
import {
  listTimesheetApprovals,
  reviewTimesheet,
  submitTimesheet,
} from "./timesheet";

/**
 * Timesheet sign-off (083). Against a real Postgres: the unique key that makes
 * a re-review a correction rather than a second contradictory row, and the
 * week bucketing, are both database facts.
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

describe("timesheet approval", () => {
  let owner: string;
  let worker: string;
  let ws: string;
  let boardId: number;
  // A Wednesday, so "the week of" is doing real work rather than echoing input.
  const wednesday = "2026-07-22";
  const monday = "2026-07-20";

  beforeAll(async () => {
    owner = await createUser("ts-owner");
    worker = await createUser("ts-worker");
    ws = (await ensurePersonalWorkspace(owner, "TsOwner")).id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [ws, worker]
    );
    boardId = (await getDefaultBoard(owner))!.id;
    // Touch the board so the fixture fails loudly if it is not readable.
    expect((await getBoard(owner, boardId))!.columns.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("files any day of the week under that week's Monday", () => {
    expect(weekStart("2026-07-20")).toBe("2026-07-20"); // Monday itself
    expect(weekStart("2026-07-22")).toBe("2026-07-20"); // Wednesday
    // Sunday belongs to the week that just ended, not the one starting tomorrow.
    expect(weekStart("2026-07-26")).toBe("2026-07-20");
  });

  it("lets a member submit their own week, unreviewed", async () => {
    const row = await submitTimesheet(worker, boardId, wednesday);
    expect(row.status).toBe("submitted");
    expect(row.weekStart).toBe(monday);
    // A submission is not a review: nobody has signed off yet.
    expect(row.reviewedBy).toBeNull();
    expect(row.reviewedAt).toBeNull();
  });

  it("records who approved it", async () => {
    const row = await reviewTimesheet(owner, boardId, worker, wednesday, "approved");
    expect(row.status).toBe("approved");
    expect(row.reviewedBy).toBe(owner);
    expect(row.reviewedAt).not.toBeNull();

    // One verdict per person per week — the approval replaced the submission
    // rather than sitting beside it.
    const all = await listTimesheetApprovals(owner, boardId, monday, monday);
    expect(all.filter((r) => r.userId === worker)).toHaveLength(1);
  });

  it("refuses a rejection with no reason, and keeps one with a reason", async () => {
    await expect(
      reviewTimesheet(owner, boardId, worker, wednesday, "rejected", "   ")
    ).rejects.toMatchObject({ kind: "conflict" });

    const row = await reviewTimesheet(
      owner,
      boardId,
      worker,
      wednesday,
      "rejected",
      "Friday's eight hours have no task."
    );
    expect(row.status).toBe("rejected");
    expect(row.note).toBe("Friday's eight hours have no task.");
  });

  it("clears the verdict when the week is submitted again", async () => {
    // The fix-and-resubmit path: the previous rejection must not linger beside
    // a fresh submission, or the contributor is stuck looking at a stale no.
    const row = await submitTimesheet(worker, boardId, wednesday);
    expect(row.status).toBe("submitted");
    expect(row.reviewedBy).toBeNull();
    expect(row.note).toBe("");
  });

  it("refuses a member reviewing anyone's week", async () => {
    await expect(
      reviewTimesheet(worker, boardId, owner, wednesday, "approved")
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("refuses a week that is not a date", async () => {
    await expect(
      submitTimesheet(worker, boardId, "last tuesday")
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("returns a verdict whose week merely overlaps the window", async () => {
    // The default grid is seven days ending today and rarely aligns to a
    // Monday; an approval must still surface for a mid-week view of its week.
    const overlapping = await listTimesheetApprovals(
      owner,
      boardId,
      "2026-07-22",
      "2026-07-24"
    );
    expect(overlapping.some((r) => r.weekStart === monday)).toBe(true);
  });
});
