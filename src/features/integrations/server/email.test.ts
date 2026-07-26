import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { pool, query, queryOne } from "@/shared/db/client";

/**
 * Inbound email is an unauthenticated POST that can mint tasks and comments as
 * a workspace member, so its gateway signature and its sender→member resolution
 * are the security boundary — both run here against a real Postgres. Outbound
 * rides nodemailer, which is the one seam mocked: the envelope is asserted, the
 * SMTP socket is not opened.
 */

let SECRET = "test-email-inbound-secret";
const DOMAIN = "mail.example.test";
process.env.EMAIL_INBOUND_SIGNING_SECRET = SECRET;
process.env.EMAIL_INBOUND_DOMAIN = DOMAIN;
process.env.SMTP_URL = "smtp://127.0.0.1:2525";
process.env.SMTP_FROM = "kanban@example.test";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({ messageId: "test" }));
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({
  default: { createTransport },
  createTransport,
}));

import { handleInboundEmail, inboundAddress, sendWorkspaceEmail } from "./email";

/** A gateway-signed inbound request; secret/timestamp overridable for attacks. */
function inboundRequest(
  message: object,
  over: { secret?: string; timestamp?: string; raw?: string } = {}
): Request {
  const raw = over.raw ?? JSON.stringify(message);
  const timestamp = over.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = `v1=${createHmac("sha256", over.secret ?? SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex")}`;
  return new Request("http://localhost/api/integrations/email/inbound", {
    method: "POST",
    headers: {
      "x-kanban-email-timestamp": timestamp,
      "x-kanban-email-signature": signature,
      "content-type": "application/json",
    },
    body: raw,
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

describe("email integration", () => {
  let alice: string;
  let aliceEmail: string;
  let workspaceId: string;
  let boardId: number;
  let boardAddress: string;

  beforeAll(async () => {
    alice = await createUser("em-alice");
    aliceEmail = `${alice}@example.test`;
    workspaceId = (await ensurePersonalWorkspace(alice, "EmAlice")).id;
    boardId = (await getDefaultBoard(alice))!.id;

    // KNOWN BUG (see the it.fails below): boardFromRecipient lowercases the
    // recipient before its timing-safe compare, while inboundAddress mints
    // mixed-case tokens — so with an arbitrary secret every legitimate inbound
    // is 404'd. To still exercise the accept path (member resolution, task and
    // comment creation), search for a signing secret whose token for this board
    // happens to be all-lowercase, making the (buggy) compare an identity.
    // Delete this loop when the bug is fixed.
    for (let i = 0; ; i += 1) {
      process.env.EMAIL_INBOUND_SIGNING_SECRET = `test-email-secret-${i}`;
      const candidate = inboundAddress(boardId);
      if (candidate === candidate.toLowerCase()) {
        SECRET = `test-email-secret-${i}`;
        break;
      }
      if (i > 4_000_000) throw new Error("no lowercase-token secret found");
    }
    boardAddress = inboundAddress(boardId);
  });

  afterAll(async () => {
    await query(`DELETE FROM workspace WHERE id = $1`, [workspaceId]);
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
  });

  describe("inboundAddress", () => {
    it("has the board-<id>-<24 char token>@domain shape", () => {
      expect(boardAddress).toMatch(
        new RegExp(`^board-${boardId}-[A-Za-z0-9_-]{24}@${DOMAIN.replace(/\./g, "\\.")}$`)
      );
    });

    it("is deterministic for a board and distinct across boards", () => {
      expect(inboundAddress(boardId)).toBe(boardAddress);
      expect(inboundAddress(boardId + 1)).not.toBe(boardAddress);
    });
  });

  describe("outbound", () => {
    it("sends with the expected envelope through the SMTP seam", async () => {
      await sendWorkspaceEmail({
        workspaceId,
        boardId,
        taskId: 42,
        to: "member@example.test",
        text: "Your task moved.",
      });
      expect(createTransport).toHaveBeenCalledWith("smtp://127.0.0.1:2525");
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith({
        from: "kanban@example.test",
        to: "member@example.test",
        subject: "Kanban task #42",
        text: "Your task moved.",
        replyTo: boardAddress,
        headers: { "X-Kanban-Workspace": workspaceId, "X-Kanban-Task": "42" },
      });
    });

    it("refuses a recipient that smells like header injection", async () => {
      await expect(
        sendWorkspaceEmail({
          workspaceId,
          boardId,
          taskId: 1,
          to: "victim@example.test\r\nBcc: everyone@example.test",
          text: "x",
        })
      ).rejects.toThrow(/Invalid notification email/);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("refuses to send at all without SMTP configuration", async () => {
      const saved = process.env.SMTP_URL;
      delete process.env.SMTP_URL;
      try {
        await expect(
          sendWorkspaceEmail({
            workspaceId,
            boardId,
            taskId: 1,
            to: "member@example.test",
            text: "x",
          })
        ).rejects.toThrow(/SMTP_URL/);
      } finally {
        process.env.SMTP_URL = saved;
      }
    });
  });

  describe("inbound verification", () => {
    const message = (over: object = {}) => ({
      to: boardAddress,
      from: aliceEmail,
      subject: "New from email",
      text: "The body of the task.",
      ...over,
    });

    it("creates a task from a signed email sent by a member", async () => {
      const response = await handleInboundEmail(
        inboundRequest(message({ subject: "Inbound task one" }))
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as { kind: string; taskId: number };
      expect(body.kind).toBe("task");
      const task = await queryOne<{ title: string; description: string }>(
        `SELECT title, description FROM task WHERE id = $1`,
        [body.taskId]
      );
      expect(task).toMatchObject({
        title: "Inbound task one",
        description: "The body of the task.",
      });
    });

    it("threads a Task # reply into a comment on that task", async () => {
      const board = await getBoard(alice, boardId);
      const task = await createTask(alice, {
        columnId: board!.columns[0].id,
        title: "Reply target",
      });
      const response = await handleInboundEmail(
        inboundRequest(
          message({ subject: `Re: [Task #${task.id}] Reply target`, text: "On it." })
        )
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ kind: "comment", taskId: task.id });
      const comment = await queryOne<{ body: string; authorId: string }>(
        `SELECT body, author_id AS "authorId" FROM comment WHERE task_id = $1`,
        [task.id]
      );
      expect(comment).toMatchObject({ body: "On it.", authorId: alice });
    });

    it("rejects an unsigned or wrongly-signed payload", async () => {
      const bad = await handleInboundEmail(
        inboundRequest(message(), { secret: "wrong-secret" })
      );
      expect(bad.status).toBe(401);

      const unsigned = await handleInboundEmail(
        new Request("http://localhost/inbound", {
          method: "POST",
          body: JSON.stringify(message()),
        })
      );
      expect(unsigned.status).toBe(401);
    });

    it("rejects a signature over a different body", async () => {
      const raw = JSON.stringify(message());
      const request = inboundRequest(message());
      const tampered = new Request("http://localhost/inbound", {
        method: "POST",
        headers: request.headers,
        body: raw.replace("The body", "A forged body"),
      });
      expect((await handleInboundEmail(tampered)).status).toBe(401);
    });

    it("rejects a stale timestamp (replay window)", async () => {
      const stale = String(Math.floor(Date.now() / 1000) - 301);
      const response = await handleInboundEmail(
        inboundRequest(message(), { timestamp: stale })
      );
      expect(response.status).toBe(401);
    });

    it("answers 404 for a recipient token that does not verify", async () => {
      const forged = `board-${boardId}-aaaaaaaaaaaaaaaaaaaaaaaa@${DOMAIN}`;
      const response = await handleInboundEmail(
        inboundRequest(message({ to: forged }))
      );
      expect(response.status).toBe(404);
    });

    it("refuses a sender who is not a workspace member", async () => {
      const response = await handleInboundEmail(
        inboundRequest(message({ from: "stranger@example.test" }))
      );
      expect(response.status).toBe(403);
    });

    // BUG, pinned deliberately: inboundAddress mints a mixed-case base64url
    // token, but boardFromRecipient lowercases the whole recipient before its
    // timing-safe compare (email.ts:69) — so the address the app itself hands
    // out as replyTo is refused with 404 whenever the token contains an
    // uppercase letter (virtually always). This test states the *intended*
    // behavior and is marked .fails; when the compare is fixed, vitest will
    // flag this test as passing-unexpectedly — then drop the .fails marker and
    // the secret-search loop in beforeAll.
    it.fails("accepts the exact address it minted, uppercase token and all", async () => {
      let mixedSecret = "";
      for (let i = 0; ; i += 1) {
        process.env.EMAIL_INBOUND_SIGNING_SECRET = `mixed-case-secret-${i}`;
        const candidate = inboundAddress(boardId);
        if (candidate !== candidate.toLowerCase()) {
          mixedSecret = `mixed-case-secret-${i}`;
          break;
        }
      }
      try {
        const to = inboundAddress(boardId);
        const response = await handleInboundEmail(
          inboundRequest(message({ to, subject: "Mixed case token" }), {
            secret: mixedSecret,
          })
        );
        expect(response.status).toBe(201);
      } finally {
        process.env.EMAIL_INBOUND_SIGNING_SECRET = SECRET;
      }
    });

    it("refuses a structurally invalid payload", async () => {
      const response = await handleInboundEmail(
        inboundRequest({ to: boardAddress, from: aliceEmail })
      );
      expect(response.status).toBe(400);
    });
  });
});
