import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { pool, query } from "@/shared/db/client";
import { AuthzError } from "./authz";
import {
  inviteMember,
  listInvitations,
  listMembers,
  redeemInvitations,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from "./members";
import { ensurePersonalWorkspace } from "./repository";

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

describe("members and invitations", () => {
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

  describe("inviting", () => {
    it("redeems a pending invite when the invitee first signs in", async () => {
      // The whole point of inviting by email: the invitee does not exist yet.
      await inviteMember(owner.id, workspaceId, "newcomer@example.test", "member");

      const invitee = await createUser("invitee");
      await query(`UPDATE "user" SET email = $2 WHERE id = $1`, [
        invitee.id,
        "newcomer@example.test",
      ]);

      expect(await redeemInvitations(invitee.id, "newcomer@example.test")).toBe(1);

      const members = await listMembers(owner.id, workspaceId);
      expect(members.find((m) => m.userId === invitee.id)?.role).toBe("member");
      // The invitation is consumed, not left lying around.
      expect(await listInvitations(owner.id, workspaceId)).toHaveLength(0);
    });

    it("matches the invite email case-insensitively", async () => {
      await inviteMember(owner.id, workspaceId, "MiXeD@Example.Test", "viewer");
      const invitee = await createUser("mixed");
      expect(await redeemInvitations(invitee.id, "mixed@example.test")).toBe(1);
      const members = await listMembers(owner.id, workspaceId);
      expect(members.find((m) => m.userId === invitee.id)?.role).toBe("viewer");
    });

    it("never downgrades an existing member via a stale invite", async () => {
      const admin = await createUser("admin");
      await redeemInvitations(admin.id, admin.email);
      await inviteMember(owner.id, workspaceId, admin.email, "viewer");
      await redeemInvitations(admin.id, admin.email);
      await updateMemberRole(owner.id, workspaceId, admin.id, "admin");

      // A second invite lands after they are already an admin.
      await query(
        `INSERT INTO workspace_invitation (id, workspace_id, email, role)
         VALUES ($1, $2, $3, 'viewer')`,
        [randomUUID(), workspaceId, admin.email]
      );
      await redeemInvitations(admin.id, admin.email);

      const members = await listMembers(owner.id, workspaceId);
      expect(members.find((m) => m.userId === admin.id)?.role).toBe("admin");
    });

    it("re-inviting the same email updates the role instead of erroring", async () => {
      await inviteMember(owner.id, workspaceId, "dup@example.test", "viewer");
      await inviteMember(owner.id, workspaceId, "dup@example.test", "admin");
      const invitations = await listInvitations(owner.id, workspaceId);
      expect(invitations).toHaveLength(1);
      expect(invitations[0].role).toBe("admin");
    });

    it("refuses to invite someone who is already a member", async () => {
      await expectAuthzError(
        () => inviteMember(owner.id, workspaceId, owner.email, "member"),
        "conflict"
      );
    });

    it("rejects a malformed email", async () => {
      await expectAuthzError(
        () => inviteMember(owner.id, workspaceId, "not-an-email", "member"),
        "conflict"
      );
    });

    it("lets an admin revoke a pending invite", async () => {
      const invitation = await inviteMember(
        owner.id,
        workspaceId,
        "revoke@example.test",
        "member"
      );
      expect(await revokeInvitation(owner.id, invitation.id)).toBe(true);
      expect(await listInvitations(owner.id, workspaceId)).toHaveLength(0);
    });
  });

  describe("privilege escalation", () => {
    let admin: { id: string; email: string };
    let member: { id: string; email: string };

    beforeEach(async () => {
      admin = await createUser("admin");
      member = await createUser("member");
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
    });

    it("stops an admin from promoting anyone to owner, including themselves", async () => {
      // Otherwise "admin" is just "owner" with an extra step.
      await expectAuthzError(
        () => updateMemberRole(admin.id, workspaceId, admin.id, "owner"),
        "forbidden"
      );
      await expectAuthzError(
        () => updateMemberRole(admin.id, workspaceId, member.id, "owner"),
        "forbidden"
      );
    });

    it("stops an admin from demoting or removing an owner", async () => {
      await expectAuthzError(
        () => updateMemberRole(admin.id, workspaceId, owner.id, "viewer"),
        "forbidden"
      );
      await expectAuthzError(
        () => removeMember(admin.id, workspaceId, owner.id),
        "forbidden"
      );
    });

    it("stops a plain member from inviting or changing roles", async () => {
      await expectAuthzError(
        () => inviteMember(member.id, workspaceId, "x@example.test", "member"),
        "forbidden"
      );
      await expectAuthzError(
        () => updateMemberRole(member.id, workspaceId, admin.id, "viewer"),
        "forbidden"
      );
    });

    it("hides the pending invite list from non-admins", async () => {
      // Pending invites are a list of people's email addresses.
      await expectAuthzError(
        () => listInvitations(member.id, workspaceId),
        "forbidden"
      );
    });

    it("lets an owner promote and demote freely", async () => {
      const promoted = await updateMemberRole(
        owner.id,
        workspaceId,
        member.id,
        "admin"
      );
      expect(promoted.role).toBe("admin");
      const demoted = await updateMemberRole(
        owner.id,
        workspaceId,
        member.id,
        "viewer"
      );
      expect(demoted.role).toBe("viewer");
    });
  });

  describe("the last owner", () => {
    it("cannot be demoted", async () => {
      await expectAuthzError(
        () => updateMemberRole(owner.id, workspaceId, owner.id, "admin"),
        "conflict"
      );
    });

    it("cannot leave", async () => {
      // A workspace with no owner cannot be administered or deleted by anyone.
      await expectAuthzError(
        () => removeMember(owner.id, workspaceId, owner.id),
        "conflict"
      );
    });

    it("can leave once another owner exists", async () => {
      const second = await createUser("second-owner");
      await query(
        `INSERT INTO workspace_member (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspaceId, second.id]
      );
      expect(await removeMember(owner.id, workspaceId, owner.id)).toBe(true);
      const members = await listMembers(second.id, workspaceId);
      expect(members.map((m) => m.userId)).not.toContain(owner.id);
    });
  });

  describe("leaving", () => {
    it("lets a plain member remove themselves without being an admin", async () => {
      const member = await createUser("leaver");
      await query(
        `INSERT INTO workspace_member (workspace_id, user_id, role)
         VALUES ($1, $2, 'member')`,
        [workspaceId, member.id]
      );
      expect(await removeMember(member.id, workspaceId, member.id)).toBe(true);
      expect(await listMembers(owner.id, workspaceId)).toHaveLength(1);
    });

    it("still stops a member from removing someone else", async () => {
      const a = await createUser("a");
      const b = await createUser("b");
      for (const user of [a, b]) {
        await query(
          `INSERT INTO workspace_member (workspace_id, user_id, role)
           VALUES ($1, $2, 'member')`,
          [workspaceId, user.id]
        );
      }
      await expectAuthzError(() => removeMember(a.id, workspaceId, b.id), "forbidden");
    });
  });
});
