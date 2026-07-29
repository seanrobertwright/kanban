import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensurePersonalWorkspace,
} from "@/features/workspaces/server/repository";
import type { BoardFilter } from "@/features/board/components/board-filter-bar";
import { pool, query } from "@/shared/db/client";
import { BOARD_VIEW_MODES } from "../types";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
} from "./repository";

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
  let bob: string;
  let ws: string;
  let bobWs: string;

  beforeAll(async () => {
    alice = await createUser("view-alice");
    bob = await createUser("view-bob");
    ws = (await ensurePersonalWorkspace(alice, "ViewAlice")).id;
    bobWs = (await ensurePersonalWorkspace(bob, "ViewBob")).id;
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = ANY($1)`, [[ws, bobWs]]);
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

  /**
   * The bug this exists to catch is a two-file one: a new lens is added to
   * BOARD_VIEW_MODES and the migration widening the CHECK is forgotten (or
   * vice-versa). Nothing type-checks that pair — the constraint lives in
   * Postgres — so the failure surfaces as a 500 the first time someone saves
   * the new lens. Driving the test off the constant means every future lens is
   * covered the day it is named.
   */
  it("accepts every lens BOARD_VIEW_MODES names", async () => {
    for (const viewMode of BOARD_VIEW_MODES) {
      const saved = await createSavedView(alice, ws, {
        name: `lens ${viewMode}`,
        viewMode,
        filter: EMPTY,
      });
      expect(saved.viewMode).toBe(viewMode);
    }
  });

  it("saving the same name twice overwrites rather than duplicating", async () => {
    const first = await createSavedView(alice, ws, {
      name: "Urgent",
      viewMode: "board",
      filter: { ...EMPTY, priorities: ["urgent"] },
    });
    // Same name in a different case: the unique index is on lower(name), so
    // "urgent" is the same view as "Urgent" — which is what "save" means here.
    const second = await createSavedView(alice, ws, {
      name: "urgent",
      viewMode: "list",
      filter: { ...EMPTY, text: "now" },
    });

    expect(second.id).toBe(first.id);
    expect(second.viewMode).toBe("list");
    expect(second.filter.text).toBe("now");
    const named = (await listSavedViews(alice, ws)).filter(
      (v) => v.name.toLowerCase() === "urgent"
    );
    expect(named).toHaveLength(1);
  });

  it("is per-person: one member never lists or deletes another's views", async () => {
    const hers = await createSavedView(alice, ws, {
      name: "Alice only",
      viewMode: "board",
      filter: EMPTY,
    });

    // Bob is not in Alice's workspace at all — listing it is refused outright.
    await expect(listSavedViews(bob, ws)).rejects.toThrow();
    // And in his own workspace he sees his own rows, never hers.
    expect(await listSavedViews(bob, bobWs)).toEqual([]);

    // Deleting someone else's view is `false`, not a throw and not a delete:
    // "no such view" and "not yours" are one answer (requireOwnView's rule).
    expect(await deleteSavedView(bob, hers.id)).toBe(false);
    expect((await listSavedViews(alice, ws)).some((v) => v.id === hers.id)).toBe(
      true
    );

    expect(await deleteSavedView(alice, hers.id)).toBe(true);
    expect((await listSavedViews(alice, ws)).some((v) => v.id === hers.id)).toBe(
      false
    );
  });

  it("orders by name case-insensitively", async () => {
    const fresh = (await ensurePersonalWorkspace(bob, "ViewBob")).id;
    for (const name of ["zulu", "Alpha", "mike"]) {
      await createSavedView(bob, fresh, { name, viewMode: "board", filter: EMPTY });
    }
    expect((await listSavedViews(bob, fresh)).map((v) => v.name)).toEqual([
      "Alpha",
      "mike",
      "zulu",
    ]);
  });
});
