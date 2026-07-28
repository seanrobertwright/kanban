import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { reviewChangeset } from "@/features/agents/server/review";
import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  handleCreateObjective,
  handleUpdateKeyResult,
} from "./handlers";
import { createKeyResult, createObjective, listObjectives } from "./repository";

/**
 * OKR management through Door 2 (rock 4.x). Objectives were session-only, which
 * is why the agent tools SPEC names could not exist; these are the two doors
 * that opened, and each opened to a different tier on purpose:
 *
 *  - `set_objective` is held. An objective is a statement of what the team is
 *    for, and an agent drafting one is a proposal, not a decision.
 *  - `score_key_result` runs. It is a measurement against a target a human set —
 *    and it is narrowed to `currentValue` here, not just in the tool's
 *    description, so the auto tier cannot be borrowed to rename the measure.
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

describe("OKR tools through door 2", () => {
  let alice: string;
  let boardId: number;
  let token: string;
  let keyResultId: number;

  const request = (url: string, method: string, body: unknown) =>
    new Request(`http://test${url}`, {
      method,
      headers: { "content-type": "application/json", "x-agent-key": token },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    alice = await createUser("okr-alice");
    const ws = await ensurePersonalWorkspace(alice, "OkrAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    await getBoard(alice, boardId);

    const minted = await createAgent(alice, ws.id, {
      name: "Progress Bot",
      role: "member",
      kind: "external",
    });
    token = minted.token!;

    const objective = await createObjective(
      alice,
      boardId,
      { name: "Cut support load" },
      { type: "human", id: alice }
    );
    const withKr = await createKeyResult(alice, objective.id, {
      title: "Tickets per week",
      targetValue: 20,
      startValue: 100,
      currentValue: 100,
    });
    keyResultId = withKr.keyResults[0].id;
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

  it("holds an agent's new objective for review, and a human can accept it", async () => {
    const res = await handleCreateObjective(
      request(`/api/board/${boardId}/objectives`, "POST", { name: "Agent's idea" }),
      String(boardId)
    );
    expect(res.status).toBe(202);
    const held = (await res.json()) as { code: string; changesetId: string };
    expect(held.code).toBe("HELD_FOR_REVIEW");

    // Nothing was written — that is what "proposed, not applied" has to mean.
    const before = await listObjectives(alice, boardId);
    expect(before.some((o) => o.name === "Agent's idea")).toBe(false);

    // And the proposal is one review.ts can actually apply. A tool held with no
    // apply case is a proposal that can never become a change, which is the
    // failure mode the switch's default arm warns about.
    const actions = await query<{ id: string }>(
      `SELECT id FROM agent_action WHERE changeset_id = $1`,
      [held.changesetId]
    );
    await reviewChangeset(alice, held.changesetId, actions.map((a) => a.id));

    const after = await listObjectives(alice, boardId);
    expect(after.some((o) => o.name === "Agent's idea")).toBe(true);
  });

  it("applies a key-result score immediately", async () => {
    const res = await handleUpdateKeyResult(
      request(`/api/key-results/${keyResultId}`, "PATCH", { currentValue: 60 }),
      String(keyResultId)
    );
    expect(res.status).toBe(200);

    const objectives = await listObjectives(alice, boardId);
    const kr = objectives
      .flatMap((o) => o.keyResults)
      .find((k) => k.id === keyResultId)!;
    expect(kr.currentValue).toBe(60);
    // 100 → 20 is the span, 60 is halfway down it.
    expect(kr.progress).toBeCloseTo(0.5, 2);
  });

  it("refuses an agent that tries to edit the measure instead of scoring it", async () => {
    const res = await handleUpdateKeyResult(
      request(`/api/key-results/${keyResultId}`, "PATCH", {
        title: "Something easier",
        currentValue: 20,
      }),
      String(keyResultId)
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("AGENT_SCOPE");

    const kr = (await listObjectives(alice, boardId))
      .flatMap((o) => o.keyResults)
      .find((k) => k.id === keyResultId)!;
    expect(kr.title).toBe("Tickets per week");
    // The whole request was refused, not partially applied.
    expect(kr.currentValue).toBe(60);
  });

  it("refuses a target change dressed up as a score", async () => {
    const res = await handleUpdateKeyResult(
      request(`/api/key-results/${keyResultId}`, "PATCH", { targetValue: 90 }),
      String(keyResultId)
    );
    expect(res.status).toBe(403);
  });
});
