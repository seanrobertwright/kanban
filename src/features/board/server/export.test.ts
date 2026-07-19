import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent } from "@/features/agents/server/admin";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import { getBoard } from "./repository";
import { handleExportBoard } from "./export";

/**
 * Through the handler, because the interesting behaviour is the file: CSV
 * quoting that survives commas and quotes, subtasks riding under their
 * parent's title, and names — not ids — in the assignee cell.
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

function exportRequest(boardId: number, format: string, token: string) {
  return new Request(
    `http://test/api/board/${boardId}/export?format=${format}`,
    { headers: { "x-agent-key": token } }
  );
}

describe("board export", () => {
  let alice: string;
  let token: string;
  let boardId: number;

  beforeAll(async () => {
    alice = await createUser("exp-alice");
    const ws = await ensurePersonalWorkspace(alice, "ExpAlice");
    boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;

    const minted = await createAgent(alice, ws.id, {
      name: "Export Bot",
      role: "member",
      kind: "external",
    });
    token = minted.token!;

    const parent = await createTask(alice, {
      columnId,
      // The quoting gauntlet: a comma and a double quote in one title.
      title: 'Fix "login", please',
      type: "bug",
      estimate: 3,
      assignee: { type: "human", id: alice },
      dueDate: "2026-08-01",
    });
    await createTask(alice, {
      columnId,
      title: "A piece",
      parentId: parent.id,
    });
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

  it("exports CSV with quoting, names, and subtask rows", async () => {
    const res = await handleExportBoard(
      exportRequest(boardId, "csv", token),
      String(boardId)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();

    // RFC-4180: the title's quote doubles, and the whole field is quoted.
    expect(body).toContain('"Fix ""login"", please"');
    // The assignee cell carries a name, not an id.
    expect(body).toContain("Test exp-alice");
    // The subtask is a row of its own, naming its parent.
    expect(body).toMatch(/A piece.*Fix ""login""/);
    expect(body).toContain("bug");
  });

  it("exports JSON rows with the same truth", async () => {
    const res = await handleExportBoard(
      exportRequest(boardId, "json", token),
      String(boardId)
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      title: string;
      type: string;
      estimate: number | null;
      parentTask: string | null;
    }[];
    expect(rows).toHaveLength(2);
    const parent = rows.find((r) => r.type === "bug")!;
    expect(parent.estimate).toBe(3);
    const piece = rows.find((r) => r.title === "A piece")!;
    expect(piece.parentTask).toBe('Fix "login", please');
  });

  it("refuses an unknown format", async () => {
    const res = await handleExportBoard(
      exportRequest(boardId, "xml", token),
      String(boardId)
    );
    expect(res.status).toBe(400);
  });
});
