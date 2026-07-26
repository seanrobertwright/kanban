import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { pool, query } from "@/shared/db/client";
import { inviteMember } from "./members";
import { ensurePersonalWorkspace } from "./repository";

// Intercept at the SMTP seam: the invitation mailer builds its transport from
// nodemailer, so a mocked createTransport sees exactly what would be sent.
const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({});
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});

vi.mock("nodemailer", () => ({ default: { createTransport } }));

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

describe("invitation email", () => {
  let owner: { id: string; email: string };
  let workspaceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    owner = await createUser("owner");
    workspaceId = (await ensurePersonalWorkspace(owner.id, "Mailer")).id;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  it("mails the invitee when SMTP is configured", async () => {
    vi.stubEnv("SMTP_URL", "smtp://localhost:2525");
    vi.stubEnv("SMTP_FROM", "kanban@example.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://kanban.example.test");

    await inviteMember(owner.id, workspaceId, "invitee@example.test", "member");

    expect(createTransport).toHaveBeenCalledWith("smtp://localhost:2525");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe("invitee@example.test");
    expect(message.from).toBe("kanban@example.test");
    expect(message.subject).toContain("Mailer's Workspace");
    // The body carries the two things an invitee needs: where to sign in and
    // which workspace is waiting.
    expect(message.text).toContain("https://kanban.example.test/sign-in");
    expect(message.text).toContain("Mailer's Workspace");
    expect(message.text).toContain("member");
  });

  it("silently skips when SMTP is not configured", async () => {
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("SMTP_FROM", "");

    await inviteMember(owner.id, workspaceId, "quiet@example.test", "viewer");

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("keeps the invitation when the send blows up", async () => {
    vi.stubEnv("SMTP_URL", "smtp://localhost:2525");
    vi.stubEnv("SMTP_FROM", "kanban@example.test");
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const invitation = await inviteMember(
      owner.id,
      workspaceId,
      "unlucky@example.test",
      "member"
    );

    // The row is the truth; delivery is best-effort.
    expect(invitation.email).toBe("unlucky@example.test");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
