import {
  createCipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthzError } from "@/features/workspaces/server/authz";
import {
  addMember,
  ensurePersonalWorkspace,
} from "@/features/workspaces/server/repository";
import { isEncrypted } from "@/shared/crypto/secret-box";
import { pool, query, queryOne } from "@/shared/db/client";
import {
  consumeOAuthState,
  createOAuthState,
  listIntegrationConnections,
  removeIntegrationConnection,
  saveSlackConnection,
  saveTeamsWebhook,
  slackToken,
} from "./repository";

/**
 * The credential store's two claims are both database claims: the token column
 * never holds plaintext, and an OAuth state row is consumed exactly once. Real
 * Postgres for both — the single-use guarantee IS the DELETE...RETURNING.
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

/** Ciphertext in our own v1 format but under a different key — what a stored
 *  token looks like after a key rotation, or planted by someone without the key. */
function encryptUnderWrongKey(plaintext: string): string {
  const key = scryptSync("not-the-deployment-key", "kanban-secret-box-v1", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

describe("integration connections", () => {
  let alice: string; // owner
  let bob: string; // member — below the admin gate
  let stranger: string;
  let workspaceId: string;
  let strangerWorkspaceId: string;
  const PLAINTEXT = "xoxb-super-secret-bot-token-987654";

  beforeAll(async () => {
    alice = await createUser("int-alice");
    bob = await createUser("int-bob");
    stranger = await createUser("int-stranger");
    workspaceId = (await ensurePersonalWorkspace(alice, "IntAlice")).id;
    await addMember(alice, workspaceId, bob, "member");
    strangerWorkspaceId = (await ensurePersonalWorkspace(stranger, "IntStranger")).id;
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

  describe("tokens at rest", () => {
    it("stores the Slack token as ciphertext, never plaintext", async () => {
      await saveSlackConnection(alice, workspaceId, {
        teamId: "T0ENCRYPT01",
        accessToken: PLAINTEXT,
      });
      const row = await queryOne<{ accessToken: string }>(
        `SELECT access_token AS "accessToken" FROM integration_connection
          WHERE workspace_id=$1 AND provider='slack' AND external_id='T0ENCRYPT01'`,
        [workspaceId]
      );
      expect(row!.accessToken).not.toBe(PLAINTEXT);
      expect(row!.accessToken).not.toContain("xoxb");
      expect(isEncrypted(row!.accessToken)).toBe(true);
    });

    it("round-trips: slackToken decrypts back to the token that went in", async () => {
      await expect(slackToken(workspaceId)).resolves.toBe(PLAINTEXT);
    });

    it("fails closed when the stored ciphertext was made with another key", async () => {
      // A rotated ENCRYPTION_KEY (or an attacker writing rows without the key)
      // must produce a hard decryption error, never silently-wrong plaintext.
      await query(
        `UPDATE integration_connection SET access_token=$2
          WHERE workspace_id=$1 AND provider='slack' AND external_id='T0ENCRYPT01'`,
        [workspaceId, encryptUnderWrongKey(PLAINTEXT)]
      );
      await expect(slackToken(workspaceId)).rejects.toThrow();
      // Restore a decryptable row for later tests.
      await saveSlackConnection(alice, workspaceId, {
        teamId: "T0ENCRYPT01",
        accessToken: PLAINTEXT,
      });
    });

    it("never returns a token field from the listing shape", async () => {
      const listed = await listIntegrationConnections(alice, workspaceId);
      expect(listed.length).toBeGreaterThan(0);
      for (const connection of listed) {
        expect(connection).not.toHaveProperty("accessToken");
        expect(connection).not.toHaveProperty("access_token");
        expect(JSON.stringify(connection)).not.toContain(PLAINTEXT);
      }
    });

    it("stores the Teams webhook URL encrypted too", async () => {
      await saveTeamsWebhook(alice, workspaceId, {
        channelId: "19:channel@thread.tacv2",
        webhookUrl: "https://acme.webhook.office.com/webhookb2/secret-path",
      });
      const row = await queryOne<{ accessToken: string }>(
        `SELECT access_token AS "accessToken" FROM integration_connection
          WHERE workspace_id=$1 AND provider='teams'`,
        [workspaceId]
      );
      expect(isEncrypted(row!.accessToken)).toBe(true);
      expect(row!.accessToken).not.toContain("office.com");
    });
  });

  describe("who may manage connections", () => {
    it("gates saving on admin — a member is refused", async () => {
      await expect(
        saveSlackConnection(bob, workspaceId, {
          teamId: "T0BYBOB",
          accessToken: "xoxb-bob-token-123456",
        })
      ).rejects.toBeInstanceOf(AuthzError);
    });

    it("gates listing on admin — a member is refused", async () => {
      await expect(listIntegrationConnections(bob, workspaceId)).rejects.toBeInstanceOf(
        AuthzError
      );
    });

    it("hides another workspace's connections entirely", async () => {
      await expect(
        listIntegrationConnections(stranger, workspaceId)
      ).rejects.toMatchObject({ kind: "not_found" });
    });

    it("rejects a malformed Slack installation response", async () => {
      await expect(
        saveSlackConnection(alice, workspaceId, {
          teamId: "not-a-team-id",
          accessToken: "xoxb-ok-123456",
        })
      ).rejects.toMatchObject({ kind: "conflict" });
      await expect(
        saveSlackConnection(alice, workspaceId, {
          teamId: "T0GOODTEAM",
          accessToken: "not-a-bot-token",
        })
      ).rejects.toMatchObject({ kind: "conflict" });
    });

    it("rejects a Teams webhook pointing anywhere but Microsoft over HTTPS", async () => {
      for (const webhookUrl of [
        "http://acme.webhook.office.com/hook",
        "https://evil.example.test/hook",
        "https://webhook.office.com.evil.test/hook",
      ]) {
        await expect(
          saveTeamsWebhook(alice, workspaceId, { channelId: "19:x", webhookUrl })
        ).rejects.toMatchObject({ kind: "conflict" });
      }
    });

    it("answers not_found for removing a connection that is not this workspace's", async () => {
      const theirs = await queryOne<{ id: number }>(
        `SELECT id FROM integration_connection WHERE workspace_id=$1 LIMIT 1`,
        [workspaceId]
      );
      await expect(
        removeIntegrationConnection(stranger, strangerWorkspaceId, theirs!.id)
      ).rejects.toMatchObject({ kind: "not_found" });
    });
  });

  describe("OAuth state (069)", () => {
    it("is consumed exactly once — a replayed callback is refused", async () => {
      const state = await createOAuthState(alice, workspaceId, "slack");
      await expect(consumeOAuthState("slack", state)).resolves.toEqual({
        workspaceId,
        userId: alice,
      });
      // Second presentation of the same state: the row is gone.
      await expect(consumeOAuthState("slack", state)).rejects.toMatchObject({
        kind: "not_found",
      });
    });

    it("binds the state to its provider — a cross-provider replay fails and does not consume", async () => {
      const state = await createOAuthState(alice, workspaceId, "google");
      await expect(consumeOAuthState("slack", state)).rejects.toMatchObject({
        kind: "not_found",
      });
      // The mismatch must not have burned the row for the real callback.
      await expect(consumeOAuthState("google", state)).resolves.toMatchObject({
        workspaceId,
      });
    });

    it("refuses an expired state", async () => {
      const state = await createOAuthState(alice, workspaceId, "teams");
      await query(
        `UPDATE integration_oauth_state SET expires_at = now() - interval '1 minute' WHERE id=$1`,
        [state]
      );
      await expect(consumeOAuthState("teams", state)).rejects.toMatchObject({
        kind: "not_found",
      });
    });

    it("refuses a state nobody ever minted", async () => {
      await expect(consumeOAuthState("slack", randomUUID())).rejects.toMatchObject({
        kind: "not_found",
      });
    });

    it("only an admin may start an OAuth installation", async () => {
      await expect(createOAuthState(bob, workspaceId, "slack")).rejects.toBeInstanceOf(
        AuthzError
      );
    });
  });
});
