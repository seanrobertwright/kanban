import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLabel } from "@/features/labels/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
} from "@/features/workspaces/server/repository";
import { pool, query } from "@/shared/db/client";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "./repository";

/**
 * Templates are workspace-shared config drawing on the label vocabulary, so the
 * things worth proving are database things: the label join, the tenancy seal
 * (404-not-403 — the id space must not become an oracle), and the role gates.
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

describe("templates", () => {
  let alice: string;
  let bob: string; // member
  let viewer: string;
  let stranger: string;
  let workspaceId: string;
  let strangerWorkspaceId: string;

  beforeAll(async () => {
    alice = await createUser("tpl-alice");
    bob = await createUser("tpl-bob");
    viewer = await createUser("tpl-viewer");
    stranger = await createUser("tpl-stranger");

    workspaceId = (await ensurePersonalWorkspace(alice, "TplAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    await addMember(alice, workspaceId, viewer, "viewer");
    strangerWorkspaceId = (await ensurePersonalWorkspace(stranger, "TplStranger")).id;
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

  let seq = 0;
  const newLabel = () =>
    createLabel(alice, workspaceId, { name: `tpl-label-${(seq += 1)}` });

  describe("round-trip with labels", () => {
    it("creates a template carrying its labels, and reads them back on a list", async () => {
      const [bug, urgent] = [await newLabel(), await newLabel()];
      const template = await createTemplate(alice, workspaceId, {
        title: "Bug report",
        description: "Steps, expected, actual",
        priority: "high",
        labelIds: [bug.id, urgent.id],
      });
      expect(template).toMatchObject({
        workspaceId,
        title: "Bug report",
        description: "Steps, expected, actual",
        priority: "high",
      });
      expect(template.labels.map((l) => l.id).sort()).toEqual(
        [bug.id, urgent.id].sort()
      );

      const listed = await listTemplates(alice, workspaceId);
      const read = listed.find((t) => t.id === template.id)!;
      expect(read.labels.map((l) => l.id).sort()).toEqual(
        [bug.id, urgent.id].sort()
      );
    });

    it("replaces the label set on update, [] clears, absent leaves alone", async () => {
      const [a, b, c] = [await newLabel(), await newLabel(), await newLabel()];
      const template = await createTemplate(alice, workspaceId, {
        title: "Rotating",
        labelIds: [a.id, b.id],
      });

      const swapped = await updateTemplate(alice, template.id, {
        labelIds: [b.id, c.id],
      });
      expect(swapped.labels.map((l) => l.id).sort()).toEqual([b.id, c.id].sort());

      const renamed = await updateTemplate(alice, template.id, {
        title: "Rotated",
      });
      expect(renamed.title).toBe("Rotated");
      expect(renamed.labels).toHaveLength(2); // labelIds absent: untouched

      const cleared = await updateTemplate(alice, template.id, { labelIds: [] });
      expect(cleared.labels).toEqual([]);
    });

    it("defaults description to empty and priority to none, labels to []", async () => {
      const template = await createTemplate(alice, workspaceId, { title: "Bare" });
      expect(template).toMatchObject({
        description: "",
        priority: "none",
        labels: [],
      });
    });

    it("deletes, answering true then false", async () => {
      const template = await createTemplate(alice, workspaceId, { title: "Doomed" });
      expect(await deleteTemplate(alice, template.id)).toBe(true);
      expect(await deleteTemplate(alice, template.id)).toBe(false);
      const listed = await listTemplates(alice, workspaceId);
      expect(listed.map((t) => t.id)).not.toContain(template.id);
    });
  });

  describe("tenancy — 404, never 403", () => {
    it("hides another workspace's template list entirely", async () => {
      await expect(listTemplates(stranger, workspaceId)).rejects.toMatchObject({
        kind: "not_found",
      });
    });

    it("reports another workspace's template as missing on update, not forbidden", async () => {
      // The anti-oracle rule: "no such template" and "someone else's template"
      // must be indistinguishable, or ids leak which numbers exist.
      const mine = await createTemplate(alice, workspaceId, { title: "Sealed" });
      await expect(
        updateTemplate(stranger, mine.id, { title: "Mine now" })
      ).rejects.toMatchObject({ kind: "not_found" });
      await expect(
        updateTemplate(stranger, 999_999_999, { title: "Ghost" })
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("folds a foreign delete into false, same as a missing id", async () => {
      const mine = await createTemplate(alice, workspaceId, { title: "Keep out" });
      expect(await deleteTemplate(stranger, mine.id)).toBe(false);
      // Still there for its owner.
      const listed = await listTemplates(alice, workspaceId);
      expect(listed.map((t) => t.id)).toContain(mine.id);
    });

    it("refuses a label from another workspace inside a template", async () => {
      const theirs = await createLabel(stranger, strangerWorkspaceId, {
        name: "foreign-label",
      });
      await expect(
        createTemplate(alice, workspaceId, {
          title: "Smuggler",
          labelIds: [theirs.id],
        })
      ).rejects.toMatchObject({ kind: "not_found" });

      const template = await createTemplate(alice, workspaceId, { title: "Clean" });
      await expect(
        updateTemplate(alice, template.id, { labelIds: [theirs.id] })
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(
        (await listTemplates(alice, workspaceId)).find((t) => t.id === template.id)!
          .labels
      ).toEqual([]);
    });
  });

  describe("who may shape the templates", () => {
    it("lets a member create, update, and delete", async () => {
      const template = await createTemplate(bob, workspaceId, { title: "By Bob" });
      const updated = await updateTemplate(bob, template.id, { title: "Bob's v2" });
      expect(updated.title).toBe("Bob's v2");
      expect(await deleteTemplate(bob, template.id)).toBe(true);
    });

    it("lets a viewer list but not write", async () => {
      const template = await createTemplate(alice, workspaceId, { title: "Look" });
      const listed = await listTemplates(viewer, workspaceId);
      expect(listed.map((t) => t.id)).toContain(template.id);

      await expect(
        createTemplate(viewer, workspaceId, { title: "No" })
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(
        updateTemplate(viewer, template.id, { title: "Still no" })
      ).rejects.toBeInstanceOf(AuthzError);
      await expect(deleteTemplate(viewer, template.id)).rejects.toBeInstanceOf(
        AuthzError
      );
    });
  });
});
