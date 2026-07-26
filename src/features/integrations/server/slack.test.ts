import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";
import { saveSlackConnection } from "./repository";
import { handleSlackCommand, handleSlackEvent } from "./slack";

/**
 * The Slack entry points are unauthenticated HTTP: the HMAC v0 signature is the
 * *only* thing standing between the internet and createTask-as-the-connection-
 * owner. So the signature checks are exercised through the real handlers with
 * real Request objects, and the accept path lands in a real Postgres.
 */

const SECRET = "test-slack-signing-secret";
process.env.SLACK_SIGNING_SECRET = SECRET;

/** A correctly signed Slack request, with per-part overrides for the attacks. */
function slackRequest(
  body: string,
  over: { secret?: string; timestamp?: string; signature?: string } = {}
): Request {
  const timestamp =
    over.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature =
    over.signature ??
    `v0=${createHmac("sha256", over.secret ?? SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;
  return new Request("http://localhost/api/integrations/slack", {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

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

describe("slack signature verification", () => {
  const challengeBody = JSON.stringify({
    type: "url_verification",
    challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
  });

  it("echoes the url_verification challenge when the signature is valid", async () => {
    const response = await handleSlackEvent(slackRequest(challengeBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
    });
  });

  it("rejects a body that was tampered after signing", async () => {
    // Sign one body, deliver another — the classic in-flight modification.
    const request = new Request("http://localhost/api/integrations/slack", {
      method: "POST",
      headers: slackRequest(challengeBody).headers,
      body: JSON.stringify({ type: "url_verification", challenge: "evil" }),
    });
    const response = await handleSlackEvent(request);
    expect(response.status).toBe(401);
  });

  it("rejects a stale timestamp even with a valid signature over it", async () => {
    // Replay window: an attacker who captured a signed request an hour ago can
    // reproduce it byte-for-byte, so the timestamp must expire the signature.
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    const response = await handleSlackEvent(
      slackRequest(challengeBody, { timestamp: stale })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a timestamp from the future too", async () => {
    const future = String(Math.floor(Date.now() / 1000) + 301);
    const response = await handleSlackEvent(
      slackRequest(challengeBody, { timestamp: future })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a non-numeric timestamp", async () => {
    const response = await handleSlackEvent(
      slackRequest(challengeBody, { timestamp: "not-a-number" })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a signature minted with the wrong secret", async () => {
    const response = await handleSlackEvent(
      slackRequest(challengeBody, { secret: "some-other-secret" })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a missing or malformed signature header", async () => {
    for (const signature of ["", "v0=short", "sha256=deadbeef", "v0=Z".padEnd(67, "0")]) {
      const response = await handleSlackEvent(
        slackRequest(challengeBody, { signature })
      );
      expect(response.status).toBe(401);
    }
  });

  it("rejects when no signing secret is configured, rather than accepting all", async () => {
    const saved = process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;
    try {
      const response = await handleSlackEvent(slackRequest(challengeBody));
      expect(response.status).toBe(401);
    } finally {
      process.env.SLACK_SIGNING_SECRET = saved;
    }
  });
});

describe("slack slash command", () => {
  let alice: string;
  let workspaceId: string;
  const teamId = "T0TESTTEAM1";

  beforeAll(async () => {
    alice = await createUser("slack-alice");
    workspaceId = (await ensurePersonalWorkspace(alice, "SlackAlice")).id;
    await saveSlackConnection(alice, workspaceId, {
      teamId,
      accessToken: "xoxb-test-token-123456",
    });
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [workspaceId]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  const command = (text: string, team = teamId) =>
    new URLSearchParams({ team_id: team, text }).toString();

  it("creates a task in the connected workspace's first column", async () => {
    const response = await handleSlackCommand(
      slackRequest(command("create Ship the integration"))
    );
    const payload = (await response.json()) as { response_type: string; text: string };
    expect(payload.response_type).toBe("in_channel");
    expect(payload.text).toMatch(/^Created task #\d+: Ship the integration$/);

    const taskId = Number(payload.text.match(/#(\d+)/)![1]);
    const boardId = (await getDefaultBoard(alice))!.id;
    const firstColumn = (await getBoard(alice, boardId))!.columns[0].id;
    const row = await queryOne<{ columnId: number; title: string }>(
      `SELECT column_id AS "columnId", title FROM task WHERE id = $1`,
      [taskId]
    );
    expect(row).toMatchObject({ columnId: firstColumn, title: "Ship the integration" });
  });

  it("refuses the command entirely when the signature is bad", async () => {
    const response = await handleSlackCommand(
      slackRequest(command("create Forged"), { secret: "wrong" })
    );
    expect(response.status).toBe(401);
    const forged = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task WHERE title = 'Forged'`
    );
    expect(Number(forged!.n)).toBe(0);
  });

  it("answers ephemeral usage help for anything but create", async () => {
    const response = await handleSlackCommand(slackRequest(command("delete 4")));
    expect(await response.json()).toMatchObject({ response_type: "ephemeral" });
  });

  it("tells an unconnected Slack workspace it is not connected", async () => {
    const response = await handleSlackCommand(
      slackRequest(command("create Orphan", "T0NOTCONNECTED"))
    );
    expect(await response.json()).toMatchObject({
      response_type: "ephemeral",
      text: "This Slack workspace is not connected.",
    });
  });
});
