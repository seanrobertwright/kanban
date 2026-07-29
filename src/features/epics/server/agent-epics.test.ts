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
import { handleCreateEpic, handleListEpics, handleUpdateEpic } from "./handlers";
import { createEpic, listEpics } from "./repository";

/**
 * Epic management through Door 2 (089). Create and edit were session-only, so an
 * external agent could file a task under an epic (`assign_to_epic` has existed
 * since 031) but could not propose that the epic exist — and PRD §7.1's promise
 * is that both doors obey the same approval policy, not that one door is simply
 * shut.
 *
 * `set_epic` is held for the reason `set_objective` is: naming a body of work,
 * or declaring it parked or finished, is a decision about what the team is
 * doing. What matters most here is the second half of each test — that the held
 * proposal is one review.ts can actually apply. A tool held with no apply case
 * is a proposal that can never become a change, which is worse than either tier.
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

describe("epic tools through door 2", () => {
  let alice: string;
  let boardId: number;
  let token: string;

  const request = (url: string, method: string, body?: unknown) =>
    new Request(`http://test${url}`, {
      method,
      headers: { "content-type": "application/json", "x-agent-key": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Accept every action in a held changeset, as a human reviewer would. */
  async function acceptAll(changesetId: string) {
    const actions = await query<{ id: string }>(
      `SELECT id FROM agent_action WHERE changeset_id = $1`,
      [changesetId]
    );
    await reviewChangeset(
      alice,
      changesetId,
      actions.map((a) => a.id)
    );
  }

  beforeAll(async () => {
    alice = await createUser("agent-epic-alice");
    const ws = await ensurePersonalWorkspace(alice, "AgentEpicAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    await getBoard(alice, boardId);

    const minted = await createAgent(alice, ws.id, {
      name: "Planning Bot",
      role: "member",
      kind: "external",
    });
    token = minted.token!;
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

  it("reads a board's epics with their status, owner and derived window", async () => {
    await createEpic(
      alice,
      boardId,
      { name: "Readable", status: "paused", ownerId: alice },
      { type: "human", id: alice }
    );
    const res = await handleListEpics(
      request(`/api/board/${boardId}/epics`, "GET"),
      String(boardId)
    );
    expect(res.status).toBe(200);
    const epics = (await res.json()) as {
      name: string;
      status: string;
      ownerName: string | null;
      targetDate: string | null;
    }[];
    const found = epics.find((e) => e.name === "Readable")!;
    expect(found.status).toBe("paused");
    expect(found.ownerName).toBe("Test agent-epic-alice");
    // Nothing dated inside it yet, and an undated bucket says so rather than
    // inventing a date.
    expect(found.targetDate).toBeNull();
  });

  it("holds an agent's new epic for review, and a human can accept it", async () => {
    const res = await handleCreateEpic(
      request(`/api/board/${boardId}/epics`, "POST", {
        name: "Agent's epic",
        status: "proposed",
      }),
      String(boardId)
    );
    expect(res.status).toBe(202);
    const held = (await res.json()) as { code: string; changesetId: string };
    expect(held.code).toBe("HELD_FOR_REVIEW");

    // Nothing was written — what "proposed, not applied" has to mean.
    expect(
      (await listEpics(alice, boardId)).some((e) => e.name === "Agent's epic")
    ).toBe(false);

    await acceptAll(held.changesetId);

    const accepted = (await listEpics(alice, boardId)).find(
      (e) => e.name === "Agent's epic"
    );
    expect(accepted).toBeDefined();
    // The status the agent proposed survives the round trip: a proposal that
    // applies as something other than what was reviewed is not a proposal.
    expect(accepted!.status).toBe("proposed");
  });

  it("holds an edit too, and applying it changes only what was proposed", async () => {
    const epic = await createEpic(
      alice,
      boardId,
      { name: "Live work", ownerId: alice },
      { type: "human", id: alice }
    );

    const res = await handleUpdateEpic(
      request(`/api/epics/${epic.id}`, "PATCH", { status: "done" }),
      String(epic.id)
    );
    expect(res.status).toBe(202);
    const held = (await res.json()) as { changesetId: string };

    const beforeAccept = (await listEpics(alice, boardId)).find(
      (e) => e.id === epic.id
    )!;
    expect(beforeAccept.status).toBe("active");

    await acceptAll(held.changesetId);

    const after = (await listEpics(alice, boardId)).find((e) => e.id === epic.id)!;
    expect(after.status).toBe("done");
    // The three-valued rule surviving the whole journey — tool → recorded input
    // → applyProposed. A status-only edit that arrives at the repository with an
    // `ownerId: undefined` key would un-own the epic, silently, on accept.
    expect(after.ownerId).toBe(alice);
    expect(after.name).toBe("Live work");
  });

  it("refuses an unknown status rather than storing it", async () => {
    const res = await handleCreateEpic(
      request(`/api/board/${boardId}/epics`, "POST", {
        name: "Bad status",
        status: "shipped",
      }),
      String(boardId)
    );
    expect(res.status).toBe(400);
    expect(
      (await listEpics(alice, boardId)).some((e) => e.name === "Bad status")
    ).toBe(false);
  });

  it("refuses an owner the agent's workspace does not have", async () => {
    const stranger = await createUser("agent-epic-stranger");
    await ensurePersonalWorkspace(stranger, "Stranger");

    const res = await handleCreateEpic(
      request(`/api/board/${boardId}/epics`, "POST", {
        name: "Cross-tenant owner",
        ownerId: stranger,
      }),
      String(boardId)
    );
    // Refused at the door, NOT held: the gate's authorize hook runs before a
    // proposal is minted. Holding it would put a proposal in a reviewer's queue
    // that throws the moment they accept it — and a throw mid-review abandons
    // every other action in that changeset, so one bad proposal takes good ones
    // down with it.
    expect(res.status).not.toBe(202);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const held = await query(
      `SELECT 1 FROM agent_action WHERE tool = 'set_epic'
        AND input->>'name' = 'Cross-tenant owner'`
    );
    expect(held).toHaveLength(0);
    expect(
      (await listEpics(alice, boardId)).some(
        (e) => e.name === "Cross-tenant owner"
      )
    ).toBe(false);
  });
});
