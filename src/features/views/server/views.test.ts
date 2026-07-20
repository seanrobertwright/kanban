import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensurePersonalWorkspace,
} from "@/features/workspaces/server/repository";
import type { BoardFilter } from "@/features/board/components/board-filter-bar";
import { pool, query } from "@/shared/db/client";
import { createSavedView, listSavedViews } from "./repository";

/**
 * Against a real Postgres because the one fact worth proving here is a database
 * fact: 029 widened the view_mode CHECK to admit 'backlog', and a saved view
 * carrying it must round-trip rather than being refused by the constraint.
 */

const createdUsers: string[] = [];
const EMPTY: BoardFilter = { text: "", priorities: [], labelIds: [], assignees: [] };

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

describe("saved views", () => {
  let alice: string;
  let ws: string;

  beforeAll(async () => {
    alice = await createUser("view-alice");
    ws = (await ensurePersonalWorkspace(alice, "ViewAlice")).id;
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [ws]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("persists a backlog-lens view (029's widened CHECK)", async () => {
    const saved = await createSavedView(alice, ws, {
      name: "My backlog",
      viewMode: "backlog",
      filter: { ...EMPTY, priorities: ["urgent"] },
    });
    expect(saved.viewMode).toBe("backlog");

    const listed = await listSavedViews(alice, ws);
    const mine = listed.find((v) => v.id === saved.id)!;
    expect(mine.viewMode).toBe("backlog");
    expect(mine.filter.priorities).toEqual(["urgent"]);
  });
});
