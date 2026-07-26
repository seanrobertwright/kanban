import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { pool, query, queryOne } from "@/shared/db/client";
import { AuthzError } from "./authz";
import {
  deleteWorkspace,
  ensurePersonalWorkspace,
  renameWorkspace,
} from "./repository";

const createdUsers: string[] = [];

async function createUser(label: string): Promise<{ id: string; email: string }> {
  const id = `test-${label}-${randomUUID()}`;
  const email = `${id}@example.test`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)`,
    [id, `Test ${label}`, email]
  );
  createdUsers.push(id);
  return { id, email };
}

async function expectAuthzError(
  fn: () => Promise<unknown>,
  kind: "not_found" | "forbidden" | "conflict"
) {
  await expect(fn()).rejects.toThrow(AuthzError);
  await expect(fn()).rejects.toMatchObject({ kind });
}

describe("workspace rename and delete", () => {
  let owner: { id: string; email: string };
  let workspaceId: string;

  beforeEach(async () => {
    owner = await createUser("owner");
    workspaceId = (await ensurePersonalWorkspace(owner.id, "Owner")).id;
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

  describe("rename", () => {
    it("lets the owner rename, keeping the slug stable", async () => {
      const before = await queryOne<{ slug: string }>(
        `SELECT slug FROM workspace WHERE id = $1`,
        [workspaceId]
      );
      const renamed = await renameWorkspace(owner.id, workspaceId, "Rebranded");
      expect(renamed.name).toBe("Rebranded");
      // The slug is addressing, not identity — a rename must not break it.
      expect(renamed.slug).toBe(before!.slug);
    });

    it("refuses an admin", async () => {
      const admin = await createUser("admin");
      await query(
        `INSERT INTO workspace_member (workspace_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [workspaceId, admin.id]
      );
      await expectAuthzError(
        () => renameWorkspace(admin.id, workspaceId, "Hijacked"),
        "forbidden"
      );
    });

    it("answers not_found to a non-member, hiding that the id exists", async () => {
      const stranger = await createUser("stranger");
      await expectAuthzError(
        () => renameWorkspace(stranger.id, workspaceId, "Probed"),
        "not_found"
      );
    });
  });

  describe("delete", () => {
    it("cascades the whole workspace and leaves others untouched", async () => {
      // A second workspace owned by someone else must survive the delete.
      const other = await createUser("other");
      const otherWorkspaceId = (await ensurePersonalWorkspace(other.id, "Other")).id;

      // Give the doomed workspace real content below the board level.
      const column = await queryOne<{ id: number }>(
        `SELECT bc.id FROM board_column bc
           JOIN board b ON b.id = bc.board_id
          WHERE b.workspace_id = $1 ORDER BY bc.position LIMIT 1`,
        [workspaceId]
      );
      await query(
        `INSERT INTO task (column_id, title, position) VALUES ($1, 'Doomed', 0)`,
        [column!.id]
      );

      await deleteWorkspace(owner.id, workspaceId);

      expect(
        await queryOne(`SELECT 1 FROM workspace WHERE id = $1`, [workspaceId])
      ).toBeUndefined();
      expect(
        await queryOne(`SELECT 1 FROM board WHERE workspace_id = $1`, [workspaceId])
      ).toBeUndefined();
      expect(
        await queryOne(`SELECT 1 FROM task WHERE column_id = $1`, [column!.id])
      ).toBeUndefined();
      expect(
        await queryOne(`SELECT 1 FROM workspace_member WHERE workspace_id = $1`, [
          workspaceId,
        ])
      ).toBeUndefined();

      // Tenancy: the other workspace and its board are exactly as they were.
      expect(
        await queryOne(`SELECT 1 FROM workspace WHERE id = $1`, [otherWorkspaceId])
      ).toBeDefined();
      expect(
        await queryOne(`SELECT 1 FROM board WHERE workspace_id = $1`, [
          otherWorkspaceId,
        ])
      ).toBeDefined();
    });

    it("refuses an admin and a member", async () => {
      const admin = await createUser("admin2");
      const member = await createUser("member2");
      for (const [user, role] of [
        [admin, "admin"],
        [member, "member"],
      ] as const) {
        await query(
          `INSERT INTO workspace_member (workspace_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [workspaceId, user.id, role]
        );
      }
      await expectAuthzError(() => deleteWorkspace(admin.id, workspaceId), "forbidden");
      await expectAuthzError(() => deleteWorkspace(member.id, workspaceId), "forbidden");
      expect(
        await queryOne(`SELECT 1 FROM workspace WHERE id = $1`, [workspaceId])
      ).toBeDefined();
    });

    it("answers not_found to a non-member", async () => {
      const stranger = await createUser("stranger2");
      await expectAuthzError(
        () => deleteWorkspace(stranger.id, workspaceId),
        "not_found"
      );
    });
  });
});
