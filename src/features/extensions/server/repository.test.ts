import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  extensionTaskBridge,
  installWorkspaceExtension,
  listTaskSlotExtensions,
  listWorkspaceExtensions,
  removeWorkspaceExtension,
} from "./repository";

/**
 * An extension is third-party code granted a keyhole into a workspace, so the
 * repository's authz IS the feature: who may install, who may see, and what the
 * bridge hands an iframe that was never granted task.read. All of it is rows and
 * role checks — real Postgres.
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

describe("workspace extensions", () => {
  let alice: string; // owner
  let bob: string; // member
  let viewer: string;
  let stranger: string;
  let workspaceId: string;
  let strangerWorkspaceId: string;
  let taskId: number;

  const manifest = (over: Record<string, unknown> = {}) => ({
    name: "example.panel",
    url: "https://extensions.example.test/panel",
    capabilities: ["task.read"],
    slots: ["task_panel"],
    ...over,
  });

  beforeAll(async () => {
    alice = await createUser("ext-alice");
    bob = await createUser("ext-bob");
    viewer = await createUser("ext-viewer");
    stranger = await createUser("ext-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "ExtAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    await addMember(alice, workspaceId, viewer, "viewer");
    strangerWorkspaceId = (await ensurePersonalWorkspace(stranger, "ExtStranger")).id;

    const boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Bridged task" })).id;
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

  describe("installation is owner-gated", () => {
    it("lets the owner install, and upserts by name", async () => {
      const installed = await installWorkspaceExtension(alice, workspaceId, manifest());
      expect(installed).toMatchObject({
        workspaceId,
        name: "example.panel",
        capabilities: ["task.read"],
        slots: ["task_panel"],
      });
      const again = await installWorkspaceExtension(
        alice,
        workspaceId,
        manifest({ url: "https://extensions.example.test/panel-v2" })
      );
      expect(again.id).toBe(installed.id);
      expect(again.url).toBe("https://extensions.example.test/panel-v2");
    });

    it("refuses a member, a viewer, and a stranger", async () => {
      await expect(
        installWorkspaceExtension(bob, workspaceId, manifest())
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(
        installWorkspaceExtension(viewer, workspaceId, manifest())
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(
        installWorkspaceExtension(stranger, workspaceId, manifest())
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("refuses a manifest that fails validation: non-HTTPS, unknown slot, unknown capability", async () => {
      await expect(
        installWorkspaceExtension(alice, workspaceId, manifest({ url: "http://extensions.example.test/panel" }))
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        installWorkspaceExtension(alice, workspaceId, manifest({ slots: ["service_worker"] }))
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        installWorkspaceExtension(alice, workspaceId, manifest({ capabilities: ["task.write"] }))
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        installWorkspaceExtension(alice, workspaceId, "not-a-manifest")
      ).rejects.toMatchObject({ kind: "conflict" });
    });

    it("removal is owner-gated too", async () => {
      const doomed = await installWorkspaceExtension(
        alice,
        workspaceId,
        manifest({ name: "example.doomed" })
      );
      await expect(
        removeWorkspaceExtension(bob, workspaceId, doomed.id)
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(
        removeWorkspaceExtension(alice, workspaceId, doomed.id)
      ).resolves.toBeUndefined();
      await expect(
        removeWorkspaceExtension(alice, workspaceId, doomed.id)
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  describe("listing is viewer-gated", () => {
    it("lets a viewer list installed extensions", async () => {
      const listed = await listWorkspaceExtensions(viewer, workspaceId);
      expect(listed.map((x) => x.name)).toContain("example.panel");
    });

    it("hides the workspace's extensions from a stranger", async () => {
      await expect(
        listWorkspaceExtensions(stranger, workspaceId)
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("filters task-slot extensions by slot", async () => {
      await installWorkspaceExtension(
        alice,
        workspaceId,
        manifest({ name: "example.badge", slots: ["card_badge"] })
      );
      const panels = await listTaskSlotExtensions(viewer, taskId, "task_panel");
      expect(panels.map((x) => x.name)).toContain("example.panel");
      expect(panels.map((x) => x.name)).not.toContain("example.badge");
    });
  });

  describe("the task bridge", () => {
    it("hands a task.read extension exactly the read-only shape", async () => {
      const [panel] = await listTaskSlotExtensions(alice, taskId, "task_panel");
      const { task } = await extensionTaskBridge(alice, taskId, panel.id);
      expect(task).toEqual({
        id: taskId,
        title: "Bridged task",
        description: expect.anything(),
        dueDate: null,
        startDate: null,
      });
    });

    it("refuses an extension that was never granted task.read", async () => {
      const blind = await installWorkspaceExtension(
        alice,
        workspaceId,
        manifest({ name: "example.blind", capabilities: [] })
      );
      await expect(
        extensionTaskBridge(alice, taskId, blind.id)
      ).rejects.toMatchObject({ kind: "forbidden" });
    });

    it("refuses a cross-workspace pairing: another workspace's extension id on my task", async () => {
      const theirs = await installWorkspaceExtension(
        stranger,
        strangerWorkspaceId,
        manifest({ name: "example.theirs" })
      );
      await expect(
        extensionTaskBridge(alice, taskId, theirs.id)
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("refuses a caller who cannot see the task at all", async () => {
      const [panel] = await listTaskSlotExtensions(alice, taskId, "task_panel");
      await expect(
        extensionTaskBridge(stranger, taskId, panel.id)
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });
});
