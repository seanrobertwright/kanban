import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  createBoard,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { exportDiscovery, searchWorkspace } from "./ediscovery";
import {
  deleteCustomFieldPolicy,
  grantBoardPermission,
  grantScopedPermission,
  listAuditEvents,
  listBoardGrants,
  listCustomFieldPolicies,
  revokeBoardGrant,
  setCustomFieldPolicy,
} from "./repository";
import {
  listLegalHolds,
  placeLegalHold,
  releaseLegalHold,
} from "./retention";

/**
 * The enterprise governance surface: legal holds, field-level ACLs, scoped
 * permission grants, the audit-log viewer and eDiscovery. Every function here
 * is a door into other people's data, and each one carries the same two
 * obligations — a role gate, and a tenancy check that refuses an id belonging
 * to another workspace. Both are single lines that a refactor can drop without
 * breaking a single caller, which is why they are asserted one by one below.
 *
 * The tenancy cases deliberately use a REAL id from a neighbouring workspace
 * rather than a made-up one: a missing tenancy filter still answers not_found
 * for an id that does not exist anywhere, so only a real foreign id can tell
 * the two implementations apart.
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

async function expectAuthzError(
  fn: () => Promise<unknown>,
  kind: "not_found" | "forbidden" | "conflict"
) {
  await expect(fn()).rejects.toThrow(AuthzError);
  await expect(fn()).rejects.toMatchObject({ kind });
}

describe("admin governance", () => {
  let alice: string; // owner
  let ann: string; // admin
  let mo: string; // member
  let outsider: string; // owner of a neighbouring workspace
  let workspaceId: string;
  let otherWorkspaceId: string;
  let boardId: number;
  let secondBoardId: number;
  let columnId: number;
  let taskId: number;
  let fieldId: number;
  let foreignTaskId: number;
  let foreignBoardId: number;
  let foreignFieldId: number;

  beforeAll(async () => {
    alice = await createUser("gov-alice");
    workspaceId = (await ensurePersonalWorkspace(alice, "GovAlice")).id;
    boardId = (await getDefaultBoard(alice))!.id;
    secondBoardId = (await createBoard(alice, workspaceId, "Second")).id;
    columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Discoverable widget" }))
      .id;
    fieldId = (
      await query<{ id: number }>(
        `INSERT INTO custom_field (board_id, name, type) VALUES ($1,'Salary','text') RETURNING id`,
        [boardId]
      )
    )[0].id;

    ann = await createUser("gov-ann");
    await addMember(alice, workspaceId, ann, "admin");
    mo = await createUser("gov-mo");
    await addMember(alice, workspaceId, mo, "member");

    outsider = await createUser("gov-outsider");
    otherWorkspaceId = (await ensurePersonalWorkspace(outsider, "GovOut")).id;
    foreignBoardId = (await getDefaultBoard(outsider))!.id;
    const foreignColumn = (await getBoard(outsider, foreignBoardId))!.columns[0].id;
    foreignTaskId = (
      await createTask(outsider, { columnId: foreignColumn, title: "Not yours" })
    ).id;
    foreignFieldId = (
      await query<{ id: number }>(
        `INSERT INTO custom_field (board_id, name, type) VALUES ($1,'Foreign','text') RETURNING id`,
        [foreignBoardId]
      )
    )[0].id;
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

  describe("legal holds", () => {
    it("places, lists, and releases a hold", async () => {
      await placeLegalHold(ann, workspaceId, "task", String(taskId), "Subpoena");
      const held = await listLegalHolds(ann, workspaceId);
      const hold = held.find((h) => h.subjectId === String(taskId));
      expect(hold).toMatchObject({ subjectType: "task", reason: "Subpoena" });

      await releaseLegalHold(ann, workspaceId, hold!.id);
      const after = await listLegalHolds(ann, workspaceId);
      expect(after.some((h) => h.id === hold!.id)).toBe(false);

      // Releasing twice is not idempotent-silent: the second call must say so.
      await expectAuthzError(
        () => releaseLegalHold(ann, workspaceId, hold!.id),
        "not_found"
      );
    });

    it("re-placing a released hold revives it rather than duplicating it", async () => {
      await placeLegalHold(ann, workspaceId, "task", String(taskId), "Round two");
      const held = await listLegalHolds(ann, workspaceId);
      const matching = held.filter((h) => h.subjectId === String(taskId));
      expect(matching).toHaveLength(1);
      expect(matching[0].reason).toBe("Round two");
      await releaseLegalHold(ann, workspaceId, matching[0].id);
    });

    it("refuses a subject in another workspace", async () => {
      await expectAuthzError(
        () => placeLegalHold(ann, workspaceId, "task", String(foreignTaskId), "Fishing"),
        "not_found"
      );
    });

    it("refuses a malformed subject id, an unknown subject type, and an empty reason", async () => {
      await expectAuthzError(
        () => placeLegalHold(ann, workspaceId, "task", "not-a-number", "Reason"),
        "conflict"
      );
      await expectAuthzError(
        () => placeLegalHold(ann, workspaceId, "whiteboard" as never, "1", "Reason"),
        "conflict"
      );
      await expectAuthzError(
        () => placeLegalHold(ann, workspaceId, "task", String(taskId), "   "),
        "conflict"
      );
    });

    it("refuses a member", async () => {
      await expectAuthzError(
        () => placeLegalHold(mo, workspaceId, "task", String(taskId), "Reason"),
        "forbidden"
      );
      await expectAuthzError(() => listLegalHolds(mo, workspaceId), "forbidden");
    });
  });

  describe("custom-field access policies", () => {
    it("stores, lists, and deletes a policy", async () => {
      await setCustomFieldPolicy(ann, workspaceId, fieldId, "member", true, false);
      const policies = await listCustomFieldPolicies(ann, workspaceId);
      expect(policies).toContainEqual(
        expect.objectContaining({
          fieldId,
          fieldName: "Salary",
          role: "member",
          canView: true,
          canEdit: false,
        })
      );

      // Same field and role again is an update, not a second row.
      await setCustomFieldPolicy(ann, workspaceId, fieldId, "member", true, true);
      const updated = (await listCustomFieldPolicies(ann, workspaceId)).filter(
        (p) => p.fieldId === fieldId && p.role === "member"
      );
      expect(updated).toHaveLength(1);
      expect(updated[0].canEdit).toBe(true);

      await deleteCustomFieldPolicy(ann, workspaceId, fieldId, "member");
      await expectAuthzError(
        () => deleteCustomFieldPolicy(ann, workspaceId, fieldId, "member"),
        "not_found"
      );
    });

    it("refuses edit-without-view, which would be unenforceable", async () => {
      await expectAuthzError(
        () => setCustomFieldPolicy(ann, workspaceId, fieldId, "member", false, true),
        "conflict"
      );
    });

    it("refuses an unknown role and a field in another workspace", async () => {
      await expectAuthzError(
        () => setCustomFieldPolicy(ann, workspaceId, fieldId, "superuser", true, true),
        "conflict"
      );
      await expectAuthzError(
        () => setCustomFieldPolicy(ann, workspaceId, foreignFieldId, "member", true, true),
        "not_found"
      );
    });

    it("refuses a member", async () => {
      await expectAuthzError(
        () => setCustomFieldPolicy(mo, workspaceId, fieldId, "member", true, false),
        "forbidden"
      );
      await expectAuthzError(
        () => listCustomFieldPolicies(mo, workspaceId),
        "forbidden"
      );
    });
  });

  describe("permission grants", () => {
    it("grants, lists, upserts, and revokes a board grant", async () => {
      const grant = await grantBoardPermission(ann, workspaceId, {
        subjectId: String(secondBoardId),
        principalType: "user",
        principalId: mo,
        capability: "read",
      });
      expect(grant).toMatchObject({ subjectType: "board", capability: "read" });

      const upserted = await grantBoardPermission(ann, workspaceId, {
        subjectId: String(secondBoardId),
        principalType: "user",
        principalId: mo,
        capability: "read",
      });
      expect(upserted.id).toBe(grant.id);

      const listed = await listBoardGrants(ann, workspaceId);
      expect(listed.some((g) => g.id === grant.id)).toBe(true);

      await revokeBoardGrant(ann, workspaceId, grant.id);
      await expectAuthzError(
        () => revokeBoardGrant(ann, workspaceId, grant.id),
        "not_found"
      );
    });

    it("refuses a board in another workspace and a principal outside this one", async () => {
      await expectAuthzError(
        () =>
          grantBoardPermission(ann, workspaceId, {
            subjectId: String(foreignBoardId),
            principalType: "user",
            principalId: mo,
            capability: "read",
          }),
        "not_found"
      );
      await expectAuthzError(
        () =>
          grantBoardPermission(ann, workspaceId, {
            subjectId: String(secondBoardId),
            principalType: "user",
            principalId: outsider,
            capability: "read",
          }),
        "not_found"
      );
    });

    it("refuses an unknown capability and an unknown workspace role", async () => {
      await expectAuthzError(
        () =>
          grantBoardPermission(ann, workspaceId, {
            subjectId: String(secondBoardId),
            principalType: "user",
            principalId: mo,
            capability: "admin" as never,
          }),
        "conflict"
      );
      await expectAuthzError(
        () =>
          grantBoardPermission(ann, workspaceId, {
            subjectId: String(secondBoardId),
            principalType: "workspace_role",
            principalId: "superuser",
            capability: "read",
          }),
        "conflict"
      );
    });

    it("keeps the action grant pinned to the one capability it means", async () => {
      await expectAuthzError(
        () =>
          grantScopedPermission(ann, workspaceId, {
            subjectType: "action",
            subjectId: "workspace.delete",
            principalType: "workspace_role",
            principalId: "member",
            capability: "execute",
          }),
        "conflict"
      );
      await expect(
        grantScopedPermission(ann, workspaceId, {
          subjectType: "action",
          subjectId: "automation.manage",
          principalType: "workspace_role",
          principalId: "member",
          capability: "execute",
        })
      ).resolves.toBeDefined();
    });

    it("refuses a custom-field grant for a field in another workspace", async () => {
      await expectAuthzError(
        () =>
          grantScopedPermission(ann, workspaceId, {
            subjectType: "custom_field",
            subjectId: String(foreignFieldId),
            principalType: "workspace_role",
            principalId: "member",
            capability: "view",
          }),
        "not_found"
      );
    });
  });

  describe("audit log viewer", () => {
    it("reads newest first and names a human actor", async () => {
      const events = await listAuditEvents(ann, workspaceId, 10, 0);
      expect(events.length).toBeGreaterThan(0);
      const ids = events.map((e) => Number(e.id));
      expect([...ids].sort((a, b) => b - a)).toEqual(ids);
      const human = events.find((e) => e.actorType === "human");
      expect(human?.actorName).toBeTruthy();
    });

    it("clamps the page size rather than trusting the caller", async () => {
      // A caller asking for everything gets a page, not the whole table.
      const huge = await listAuditEvents(ann, workspaceId, 10_000, 0);
      expect(huge.length).toBeLessThanOrEqual(100);
      // And a nonsense page size still returns a usable page.
      expect(await listAuditEvents(ann, workspaceId, -5, -5)).toHaveLength(1);
    });

    it("shows only this workspace's events", async () => {
      const events = await listAuditEvents(ann, workspaceId, 100, 0);
      const foreign = await query<{ id: string }>(
        `SELECT id::text FROM activity_log WHERE workspace_id=$1 LIMIT 1`,
        [otherWorkspaceId]
      );
      expect(foreign.length).toBe(1);
      expect(events.some((e) => e.id === foreign[0].id)).toBe(false);
    });

    it("refuses a member", async () => {
      await expectAuthzError(() => listAuditEvents(mo, workspaceId, 10, 0), "forbidden");
    });
  });

  describe("eDiscovery", () => {
    it("finds matching tasks, comments, docs, and activity", async () => {
      await query(
        `INSERT INTO comment (task_id, author_type, author_id, body)
         VALUES ($1,'human',$2,'A discoverable remark')`,
        [taskId, alice]
      );
      await query(
        `INSERT INTO doc (workspace_id, title, body, created_by)
         VALUES ($1,'Discoverable doc','',$2)`,
        [workspaceId, alice]
      );

      const hits = await searchWorkspace(ann, workspaceId, "discoverable");
      const kinds = new Set(hits.map((h) => h.subjectType));
      expect(kinds.has("task")).toBe(true);
      expect(kinds.has("comment")).toBe(true);
      expect(kinds.has("doc")).toBe(true);
    });

    it("recalls a substring full text tokenizes away", async () => {
      // The point of the ILIKE arm: a discovery request is usually for an
      // identifier — a domain, an order number, a fragment of an id — and no
      // stemmer will ever match half a word.
      await createTask(alice, {
        columnId,
        title: "Vendor contact",
        description: "Escalations go to billing@acme-corp.example",
      });
      const hits = await searchWorkspace(ann, workspaceId, "cme-corp.exa");
      expect(hits.some((h) => h.subjectType === "task")).toBe(true);
    });

    it("ranks the stronger match above the passing mention", async () => {
      const term = `ledger-${randomUUID().slice(0, 8)}`;
      const dense = (
        await createTask(alice, {
          columnId,
          title: `The ${term} ${term} audit`,
          description: `All about the ${term}.`,
        })
      ).id;
      const passing = (
        await createTask(alice, {
          columnId,
          title: "Routine cleanup",
          description: `Mentions ${term} once.`,
        })
      ).id;
      const ids = (await searchWorkspace(ann, workspaceId, term)).map((h) => h.id);
      expect(ids.indexOf(String(dense))).toBeLessThan(ids.indexOf(String(passing)));
    });

    it("says which hits an active legal hold is preserving", async () => {
      const term = `frozen-${randomUUID().slice(0, 8)}`;
      const heldId = (await createTask(alice, { columnId, title: `A ${term} record` })).id;
      const looseId = (await createTask(alice, { columnId, title: `A ${term} draft` })).id;
      await placeLegalHold(ann, workspaceId, "task", String(heldId), "litigation");

      const byId = new Map(
        (await searchWorkspace(ann, workspaceId, term)).map((h) => [h.id, h.onHold])
      );
      expect(byId.get(String(heldId))).toBe(true);
      // The flag is per record, not per bundle — an unheld neighbour stays false.
      expect(byId.get(String(looseId))).toBe(false);

      // Released, and the same search reports it unfrozen.
      const holds = await listLegalHolds(ann, workspaceId);
      const hold = holds.find((h) => h.subjectId === String(heldId))!;
      await releaseLegalHold(ann, workspaceId, hold.id);
      const after = new Map(
        (await searchWorkspace(ann, workspaceId, term)).map((h) => [h.id, h.onHold])
      );
      expect(after.get(String(heldId))).toBe(false);
    });

    it("reports truncation instead of quietly returning a short bundle", async () => {
      const exported = await exportDiscovery(ann, workspaceId, "Discoverable widget");
      expect(exported.limit).toBe(500);
      expect(exported.truncated).toBe(false);
      // The audit row carries the same claim the bundle makes.
      const logged = await queryOne<{ after: { truncated: boolean } }>(
        `SELECT after FROM activity_log
          WHERE workspace_id=$1 AND action='ediscovery.export'
          ORDER BY id DESC LIMIT 1`,
        [workspaceId]
      );
      expect(logged?.after.truncated).toBe(false);
    });

    it("returns nothing for an empty term rather than the whole workspace", async () => {
      expect(await searchWorkspace(ann, workspaceId, "   ")).toEqual([]);
      const empty = await exportDiscovery(ann, workspaceId, "  ");
      expect(empty.hits).toEqual([]);
      expect(empty.attachments).toEqual([]);
    });

    it("never reaches into another workspace", async () => {
      const hits = await searchWorkspace(ann, workspaceId, "Not yours");
      expect(hits).toEqual([]);
    });

    it("scopes the attachment manifest to the query and logs the export", async () => {
      const matching = `disc-match-${randomUUID()}`;
      const unrelatedTask = (
        await createTask(alice, { columnId, title: "Unrelated" })
      ).id;
      await query(
        `INSERT INTO attachment (task_id, key, name, content_type, size, uploaded_by)
         VALUES ($1,$2,'evidence.txt','text/plain',1,$3), ($4,$5,'noise.txt','text/plain',1,$3)`,
        [taskId, matching, alice, unrelatedTask, `disc-noise-${randomUUID()}`]
      );

      const exported = await exportDiscovery(ann, workspaceId, "Discoverable widget");
      expect(exported.attachments.map((a) => a.name)).toEqual(["evidence.txt"]);
      expect(exported.query).toBe("Discoverable widget");

      // The export is itself an auditable act.
      const logged = await queryOne<{ action: string }>(
        `SELECT action FROM activity_log
          WHERE workspace_id=$1 AND action='ediscovery.export'
          ORDER BY id DESC LIMIT 1`,
        [workspaceId]
      );
      expect(logged?.action).toBe("ediscovery.export");
    });

    it("refuses a member and answers not_found to a non-member", async () => {
      await expectAuthzError(
        () => searchWorkspace(mo, workspaceId, "discoverable"),
        "forbidden"
      );
      await expectAuthzError(
        () => searchWorkspace(outsider, workspaceId, "discoverable"),
        "not_found"
      );
    });
  });
});
