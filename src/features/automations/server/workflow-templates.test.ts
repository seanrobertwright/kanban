import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { listSlaPolicies } from "@/features/sla/server/repository";
import { listAutomationRules } from "./repository";
import {
  applyWorkflowTemplate,
  listWorkflowTemplates,
} from "./workflow-templates";

/**
 * Workflow templates (051, rock 1.9 / 1.10): applying the Incident built-in adds
 * its columns, rules, and SLA policy to a board — all through the ordinary
 * create-* repositories.
 */

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

describe("workflow templates (db)", () => {
  let alice: string;
  let workspaceId: string;
  let boardId: number;

  beforeAll(async () => {
    alice = await createUser("tmpl-alice");
    await ensurePersonalWorkspace(alice, "TmplAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    workspaceId = (
      await query<{ wid: string }>(`SELECT workspace_id AS wid FROM board WHERE id = $1`, [boardId])
    )[0].wid;
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

  it("lists the built-in presets", async () => {
    const list = await listWorkflowTemplates(alice, workspaceId);
    const names = list.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Kanban", "Scrum", "Incident"]));
  });

  it("applies the Incident template's columns, rules and SLA to a board", async () => {
    const before = (await getBoard(alice, boardId))!.columns.length;
    const rulesBefore = (await listAutomationRules(alice, boardId)).length;
    const slasBefore = (await listSlaPolicies(alice, boardId)).length;

    const result = await applyWorkflowTemplate(alice, boardId, "builtin:incident");
    expect(result.rules).toBeGreaterThanOrEqual(1);
    expect(result.slaPolicies).toBeGreaterThanOrEqual(1);

    const after = (await getBoard(alice, boardId))!.columns.length;
    expect(after).toBe(before + result.columns);
    expect((await listAutomationRules(alice, boardId)).length).toBe(rulesBefore + result.rules);
    expect((await listSlaPolicies(alice, boardId)).length).toBe(slasBefore + result.slaPolicies);

    // Idempotent on columns: re-applying adds no duplicate columns (titles match).
    const second = await applyWorkflowTemplate(alice, boardId, "builtin:incident");
    expect(second.columns).toBe(0);
  });
});
