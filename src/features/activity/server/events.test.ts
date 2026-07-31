import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { getBoard } from "@/features/board/server/repository";
import { createTask, updateTask } from "@/features/tasks/server/repository";
import {
  createBoard,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { resetRateLimits } from "@/shared/lib/rate-limit";
import type { BoardEventPage } from "../types";
import { handleBoardEvents } from "./handlers";

/**
 * The change feed (§4.4 item 8), through the handler against the real database
 * and a real agent key.
 *
 * Real-DB because every claim the feed makes is a claim about ordering and
 * scoping in Postgres: that ids advance, that a board sees only its own rows,
 * that a stranger's board is not found rather than empty. A mocked query would
 * assert the shape of the code and none of the behaviour.
 *
 * The long-poll cases are the ones with teeth — a poll that never wakes and a
 * poll that never sleeps look identical from a single call, so both are timed.
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

describe("handleBoardEvents", () => {
  let alice: string;
  let token: string;
  let boardId: number;
  let columnId: number;
  let workspaceId: string;
  let strangersBoard: number;

  // `null` is the anonymous case, not `undefined`: passing undefined would fall
  // back to the default parameter and quietly send the token anyway.
  function feed(id: number, qs = "", key: string | null = token): Request {
    return new Request(`http://test/api/board/${id}/events${qs ? `?${qs}` : ""}`, {
      headers: key ? { "x-agent-key": key } : {},
    });
  }

  async function read(id: number, qs = "", key: string | null = token) {
    const res = await handleBoardEvents(feed(id, qs, key), String(id));
    return { res, body: (await res.json()) as BoardEventPage & { error?: string } };
  }

  /** The cursor as of now — every test starts from here rather than from 0, so
   *  one test's rows are never another's backlog. */
  async function head(): Promise<string> {
    return (await read(boardId)).body.cursor;
  }

  beforeAll(async () => {
    alice = await createUser("evt-alice");
    const ws = await ensurePersonalWorkspace(alice, "EvtAlice");
    workspaceId = ws.id;
    boardId = (await getDefaultBoard(alice))!.id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;

    const minted = await createAgent(alice, ws.id, {
      name: "Feed Bot",
      role: "member",
      kind: "external",
    });
    token = minted.token!;

    const bob = await createUser("evt-bob");
    await ensurePersonalWorkspace(bob, "EvtBob");
    strangersBoard = (await getDefaultBoard(bob))!.id;
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

  beforeEach(() => resetRateLimits());

  it("requires a principal", async () => {
    const res = await handleBoardEvents(feed(boardId, "", null), String(boardId));
    expect(res.status).toBe(401);
  });

  it("hands out a cursor and no history on the first call", async () => {
    await createTask(alice, { columnId, title: "Already happened" });
    const { res, body } = await read(boardId);
    expect(res.status).toBe(200);
    expect(body.events).toEqual([]);
    expect(body.hasMore).toBe(false);
    // A cursor, not zero: the board already has rows, and the point is that
    // none of them are replayed.
    // BigInt(0), not 0n: the project targets ES2017, where the literal is a
    // syntax error but the constructor is not.
    expect(BigInt(body.cursor) > BigInt(0)).toBe(true);
  });

  it("returns what happened after the cursor, oldest first, and advances it", async () => {
    const from = await head();
    const first = await createTask(alice, { columnId, title: "One" });
    await updateTask(alice, first.id, { title: "One renamed" });

    const { body } = await read(boardId, `since=${from}`);
    expect(body.events.map((e) => e.action)).toEqual(["task.created", "task.updated"]);
    // The actor join is part of the feed's value: "who moved it" without a
    // second lookup per row.
    expect(body.events[0].actorName).toBe("Test evt-alice");
    expect(BigInt(body.cursor)).toBe(BigInt(body.events[1].id));
    expect(body.hasMore).toBe(false);
  });

  it("echoes the caller's cursor when nothing happened, rather than resetting it", async () => {
    const from = await head();
    const { body } = await read(boardId, `since=${from}`);
    expect(body.events).toEqual([]);
    expect(body.cursor).toBe(from);
  });

  it("pages a burst and says there is more", async () => {
    const from = await head();
    await createTask(alice, { columnId, title: "Burst A" });
    await createTask(alice, { columnId, title: "Burst B" });
    await createTask(alice, { columnId, title: "Burst C" });

    const page = await read(boardId, `since=${from}&limit=2`);
    expect(page.body.events).toHaveLength(2);
    expect(page.body.hasMore).toBe(true);

    // The cursor from a partial page resumes exactly where it stopped.
    const rest = await read(boardId, `since=${page.body.cursor}&limit=2`);
    expect(rest.body.events).toHaveLength(1);
    expect(rest.body.hasMore).toBe(false);
  });

  it("carries only this board's rows, not the workspace's", async () => {
    // Two boards, one workspace, one agent key that reaches both — the case a
    // workspace-scoped feed would get wrong while every single-board test passed.
    const second = await createBoard(alice, workspaceId, "Second Board");
    const secondColumn = (await getBoard(alice, second.id))!.columns[0].id;

    const from = await head();
    await createTask(alice, { columnId, title: "On the polled board" });
    await createTask(alice, { columnId: secondColumn, title: "On the other board" });

    const { body } = await read(boardId, `since=${from}`);
    expect(body.events.every((e) => e.boardId === boardId)).toBe(true);
    expect(
      body.events.some((e) => (e.after as { title?: string } | null)?.title === "On the polled board")
    ).toBe(true);
  });

  it("answers a stranger's board with not_found, not with an empty feed", async () => {
    // An empty feed would be an oracle: it would confirm the board exists.
    const { res } = await read(strangersBoard);
    expect(res.status).toBe(404);
  });

  it("refuses a malformed cursor instead of silently starting over", async () => {
    const { res, body } = await read(boardId, "since=yesterday");
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/cursor/);
  });

  it("wakes as soon as a change lands, well before the deadline", async () => {
    const from = await head();
    const started = Date.now();
    const polling = read(boardId, `since=${from}&wait=10`);
    setTimeout(() => {
      void createTask(alice, { columnId, title: "Landed mid-poll" });
    }, 300);

    const { body } = await polling;
    const elapsed = Date.now() - started;
    expect(body.events.map((e) => e.action)).toContain("task.created");
    expect(elapsed).toBeLessThan(9000);
  }, 20000);

  it("times out as a 200 with an unchanged cursor, not as an error", async () => {
    const from = await head();
    const started = Date.now();
    const { res, body } = await read(boardId, `since=${from}&wait=2`);
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(body.events).toEqual([]);
    expect(body.cursor).toBe(from);
    // It really waited: a handler that ignored `wait` would return instantly and
    // this test would pass on every other assertion.
    expect(elapsed).toBeGreaterThanOrEqual(1800);
  }, 20000);

  it("does not hold the first call open — there is no cursor to wait on", async () => {
    const started = Date.now();
    await read(boardId, "wait=10");
    expect(Date.now() - started).toBeLessThan(2000);
  }, 20000);

  it("rate-limits one principal's polling with a Retry-After", async () => {
    const from = await head();
    let last: Response | undefined;
    for (let i = 0; i < 70; i += 1) {
      last = (await read(boardId, `since=${from}`)).res;
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  }, 20000);
});
