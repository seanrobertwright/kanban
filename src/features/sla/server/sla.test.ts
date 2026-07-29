import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { createTask, getTask } from "@/features/tasks/server/repository";
import { slaBreached, slaRemainingMins } from "../types";
import {
  createSlaPolicy,
  deleteSlaPolicy,
  listSlaPolicies,
  taskSlaStatus,
  updateSlaPolicy,
} from "./repository";
import { sweepSlas } from "./sweep";

describe("sla derive (pure)", () => {
  it("remaining is positive before due, negative after", () => {
    expect(slaRemainingMins(60_000, 0)).toBe(1);
    expect(slaRemainingMins(0, 120_000)).toBe(-2);
  });
  it("breached when stamped or now past due", () => {
    expect(slaBreached(null, 100, 50)).toBe(false);
    expect(slaBreached(null, 100, 150)).toBe(true);
    expect(slaBreached("2020-01-01", 100, 50)).toBe(true);
  });
});

const createdUsers: string[] = [];
async function createUser(label: string): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, `${id}@example.test`]
  );
  createdUsers.push(id);
  return id;
}

describe("sla sweep (db)", () => {
  let alice: string;
  let member: string;
  let workspaceId: string;
  let boardId: number;
  let col1: number;

  beforeAll(async () => {
    alice = await createUser("sla-alice");
    member = await createUser("sla-member");
    workspaceId = (await ensurePersonalWorkspace(alice, "SlaAlice")).id;
    boardId = (await getDefaultBoard(alice))!.id;
    col1 = (await getBoard(alice, boardId))!.columns[0].id;
    await query(
      `INSERT INTO workspace_member (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, member]
    );
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

  it("starts a timer for a matching task, then breaches + escalates it", async () => {
    const task = await createTask(alice, {
      columnId: col1,
      title: "urgent bug",
      priority: "urgent",
    });
    await createSlaPolicy(alice, boardId, {
      name: "Urgent within 60m",
      appliesWhen: { field: "priority", op: "eq", value: "urgent" },
      targetMins: 60,
      actionOnBreach: [{ type: "comment", body: "SLA breached" }],
    });

    // First sweep starts a timer (due in the future — not breached).
    await sweepSlas();
    let status = await taskSlaStatus(alice, task.id);
    expect(status).toHaveLength(1);
    expect(status[0].breached).toBe(false);
    expect(status[0].remainingMins).toBeGreaterThan(0);

    // Force the timer overdue, then sweep breaches it and runs its action.
    await query(
      `UPDATE task_sla SET due_at = now() - interval '1 minute' WHERE task_id = $1`,
      [task.id]
    );
    await sweepSlas();
    status = await taskSlaStatus(alice, task.id);
    expect(status[0].breached).toBe(true);
    expect(status[0].breachedAt).not.toBeNull();

    // The breach comment landed (add_label with 0 is a no-op set; comment runs).
    const commentCount = await query<{ n: string }>(
      `SELECT count(*) AS n FROM comment WHERE task_id = $1`,
      [task.id]
    );
    expect(Number(commentCount[0].n)).toBeGreaterThanOrEqual(1);

    // A second sweep does not re-breach (breached_at already set).
    const before = Number(
      (await query<{ n: string }>(`SELECT count(*) AS n FROM comment WHERE task_id = $1`, [task.id]))[0].n
    );
    await sweepSlas();
    const after = Number(
      (await query<{ n: string }>(`SELECT count(*) AS n FROM comment WHERE task_id = $1`, [task.id]))[0].n
    );
    expect(after).toBe(before);
    void getTask;
  });

  it("times only what a policy matches, and never resets a running clock", async () => {
    const matching = await createTask(alice, {
      columnId: col1,
      title: "high bug",
      priority: "high",
    });
    const other = await createTask(alice, {
      columnId: col1,
      title: "low chore",
      priority: "low",
    });
    await createSlaPolicy(alice, boardId, {
      name: "High within 120m",
      appliesWhen: { field: "priority", op: "eq", value: "high" },
      targetMins: 120,
      actionOnBreach: [],
    });

    await sweepSlas();
    const started = await taskSlaStatus(alice, matching.id);
    const highTimer = started.find((s) => s.policyName === "High within 120m");
    expect(highTimer).toBeDefined();
    // A policy is a filter, not a blanket: an unmatched task carries no timer,
    // so "no SLA" stays visibly different from "an SLA with time left".
    expect(await taskSlaStatus(alice, other.id)).toEqual([]);

    // The second sweep must leave the clock alone — ON CONFLICT DO NOTHING. A
    // re-inserted timer would silently extend every deadline on every tick,
    // which is an SLA that can never breach.
    await sweepSlas();
    const resweep = (await taskSlaStatus(alice, matching.id)).find(
      (s) => s.policyName === "High within 120m"
    )!;
    expect(resweep.dueAt).toBe(highTimer!.dueAt);
    expect(resweep.startedAt).toBe(highTimer!.startedAt);
  });

  it("a disabled policy starts no timers until it is enabled", async () => {
    const task = await createTask(alice, {
      columnId: col1,
      title: "medium thing",
      priority: "medium",
    });
    const policy = await createSlaPolicy(alice, boardId, {
      name: "Medium within 30m",
      appliesWhen: { field: "priority", op: "eq", value: "medium" },
      targetMins: 30,
      actionOnBreach: [],
      isEnabled: false,
    });

    await sweepSlas();
    expect(await taskSlaStatus(alice, task.id)).toEqual([]);

    // Enabling is how a policy is staged and then switched on — the sweep reads
    // is_enabled, so the same policy must start timing without being recreated.
    await updateSlaPolicy(alice, policy.id, { isEnabled: true });
    await sweepSlas();
    expect(await taskSlaStatus(alice, task.id)).toHaveLength(1);
  });

  it("updates only the fields the caller names", async () => {
    const policy = await createSlaPolicy(alice, boardId, {
      name: "  Padded name  ",
      appliesWhen: { field: "priority", op: "eq", value: "urgent" },
      targetMins: 45,
      actionOnBreach: [{ type: "comment", body: "late" }],
      isEnabled: false,
    });
    expect(policy.name).toBe("Padded name");

    // JSONB fields are three-valued the way UpdateTaskInput's are: absent means
    // "said nothing", and a rename must not blank the condition that decides
    // which tasks the policy covers.
    const renamed = await updateSlaPolicy(alice, policy.id, { name: "Renamed" });
    expect(renamed!.name).toBe("Renamed");
    expect(renamed!.appliesWhen).toEqual({
      field: "priority",
      op: "eq",
      value: "urgent",
    });
    expect(renamed!.actionOnBreach).toEqual([{ type: "comment", body: "late" }]);
    expect(renamed!.targetMins).toBe(45);

    // Named explicitly, they are replaced wholesale — including with empty.
    const cleared = await updateSlaPolicy(alice, policy.id, {
      actionOnBreach: [],
      targetMins: 15,
    });
    expect(cleared!.actionOnBreach).toEqual([]);
    expect(cleared!.targetMins).toBe(15);
  });

  it("authoring is admin-only; reading is not", async () => {
    const policy = await createSlaPolicy(alice, boardId, {
      name: "Admin only",
      appliesWhen: { field: "priority", op: "eq", value: "urgent" },
      targetMins: 90,
      actionOnBreach: [],
      isEnabled: false,
    });

    // A policy acts on everyone's tasks, so authoring it is board config (§7.4)
    // even though an ordinary member may edit any single task it covers.
    await expect(
      createSlaPolicy(member, boardId, {
        name: "Sneaky",
        appliesWhen: { all: [] },
        targetMins: 5,
        actionOnBreach: [],
      })
    ).rejects.toThrow();
    await expect(
      updateSlaPolicy(member, policy.id, { targetMins: 1 })
    ).rejects.toThrow();
    await expect(deleteSlaPolicy(member, policy.id)).rejects.toThrow();

    // Reading is viewer+: a member has to see the clock they are racing.
    expect(
      (await listSlaPolicies(member, boardId)).some((p) => p.id === policy.id)
    ).toBe(true);

    expect(await deleteSlaPolicy(alice, policy.id)).toBe(true);
    expect(
      (await listSlaPolicies(alice, boardId)).some((p) => p.id === policy.id)
    ).toBe(false);
    // Gone means gone: a second delete is not_found, not a silent true.
    await expect(deleteSlaPolicy(alice, policy.id)).rejects.toThrow(/not found/i);
  });
});
