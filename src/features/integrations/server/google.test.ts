import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getBoard } from "@/features/board/server/repository";
import { createTask } from "@/features/tasks/server/repository";
import {
  addMember,
  ensurePersonalWorkspace,
  getDefaultBoard,
} from "@/features/workspaces/server/repository";
import { isEncrypted } from "@/shared/crypto/secret-box";
import { pool, query, queryOne } from "@/shared/db/client";
import { linkGoogleDriveFile, listTaskIntegrationLinks } from "./google";
import { linkMicrosoftDriveItem } from "./microsoft";
import {
  googleAccessToken,
  microsoftAccessToken,
  saveGoogleConnection,
  saveMicrosoftConnection,
} from "./repository";

/**
 * The Google/Microsoft wrappers are fetch + credential plumbing: what must hold
 * is that the stored (encrypted) token leaves as a correct Authorization header
 * to the right host, that provider errors surface as errors rather than junk
 * rows, and that the refresh path re-encrypts. Rows are real; HTTP is mocked.
 */

const GOOGLE_TOKEN = "ya29.test-google-access-token-1234567890";
const MS_TOKEN = "EwB0test-microsoft-access-token-1234567890";

const fetchMock = vi.fn();

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

describe("google/microsoft REST wrappers", () => {
  let alice: string;
  let viewer: string;
  let workspaceId: string;
  let taskId: number;

  beforeAll(async () => {
    alice = await createUser("gm-alice");
    viewer = await createUser("gm-viewer");
    workspaceId = (await ensurePersonalWorkspace(alice, "GmAlice")).id;
    await addMember(alice, workspaceId, viewer, "viewer");
    const boardId = (await getDefaultBoard(alice))!.id;
    const columnId = (await getBoard(alice, boardId))!.columns[0].id;
    taskId = (await createTask(alice, { columnId, title: "Linked task" })).id;

    await saveGoogleConnection(alice, workspaceId, {
      accessToken: GOOGLE_TOKEN,
      refreshToken: "1//test-google-refresh-token",
      scopes: ["drive.readonly"],
      expiresIn: 3600,
    });
    await saveMicrosoftConnection(alice, workspaceId, {
      accessToken: MS_TOKEN,
      refreshToken: "M.test-microsoft-refresh-token",
      scopes: ["Files.Read"],
      expiresIn: 3600,
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await query(
      `DELETE FROM workspace w
        WHERE EXISTS (SELECT 1 FROM workspace_member m
                       WHERE m.workspace_id = w.id AND m.user_id = ANY($1))`,
      [createdUsers]
    );
    await query(`DELETE FROM "user" WHERE id = ANY($1)`, [createdUsers]);
    await pool.end();
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  const driveUrl = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view";

  describe("Google Drive links", () => {
    it("calls the Drive API with the decrypted bearer token and records the link", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          id: "1AbCdEfGhIjKlMnOp",
          name: "Spec.pdf",
          mimeType: "application/pdf",
          webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
        })
      );
      const link = await linkGoogleDriveFile(alice, taskId, driveUrl);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(
        "https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOp"
      );
      expect((init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${GOOGLE_TOKEN}`
      );

      expect(link).toMatchObject({
        taskId,
        provider: "google",
        externalId: "1AbCdEfGhIjKlMnOp",
        name: "Spec.pdf",
      });
      const listed = await listTaskIntegrationLinks(alice, taskId);
      expect(listed.map((l) => l.externalId)).toContain("1AbCdEfGhIjKlMnOp");
    });

    it("surfaces a Drive error as a conflict, writing nothing", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "notFound" }), { status: 404 })
      );
      await expect(
        linkGoogleDriveFile(alice, taskId, "https://drive.google.com/file/d/2NoSuchFileHere/view")
      ).rejects.toMatchObject({ kind: "conflict" });
      const row = await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM integration_link WHERE task_id=$1 AND external_id='2NoSuchFileHere'`,
        [taskId]
      );
      expect(Number(row!.n)).toBe(0);
    });

    it("refuses a non-Google URL before any network call", async () => {
      for (const bad of [
        "https://evil.example.test/d/1AbCdEfGhIjKlMnOp/view",
        "http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
        "https://notgoogle.com.evil.test/file/d/1AbCdEfGhIjKlMnOp",
        "not a url",
      ]) {
        await expect(linkGoogleDriveFile(alice, taskId, bad)).rejects.toMatchObject({
          kind: "conflict",
        });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("requires member rank — a viewer cannot attach files", async () => {
      await expect(
        linkGoogleDriveFile(viewer, taskId, driveUrl)
      ).rejects.toMatchObject({ kind: "forbidden" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("googleAccessToken refresh", () => {
    it("returns the cached token while it is still fresh, without HTTP", async () => {
      await expect(googleAccessToken(workspaceId)).resolves.toBe(GOOGLE_TOKEN);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refreshes an expired token against Google's token endpoint and re-encrypts it", async () => {
      process.env.GOOGLE_CLIENT_ID = "test-google-client";
      process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
      await query(
        `UPDATE integration_connection
            SET metadata = metadata || jsonb_build_object('expiresAt', $2::text)
          WHERE workspace_id=$1 AND provider='google'`,
        [workspaceId, new Date(Date.now() - 3_600_000).toISOString()]
      );
      fetchMock.mockResolvedValueOnce(
        Response.json({ access_token: "ya29.refreshed-token-0987654321", expires_in: 3600 })
      );

      await expect(googleAccessToken(workspaceId)).resolves.toBe(
        "ya29.refreshed-token-0987654321"
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const form = init.body as URLSearchParams;
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("1//test-google-refresh-token");

      // At rest the new token is ciphertext; on the next read it is served
      // from the refreshed expiry without another HTTP round trip.
      const row = await queryOne<{ accessToken: string }>(
        `SELECT access_token AS "accessToken" FROM integration_connection
          WHERE workspace_id=$1 AND provider='google'`,
        [workspaceId]
      );
      expect(isEncrypted(row!.accessToken)).toBe(true);
      expect(row!.accessToken).not.toContain("refreshed-token");
      fetchMock.mockClear();
      await expect(googleAccessToken(workspaceId)).resolves.toBe(
        "ya29.refreshed-token-0987654321"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("turns a rejected refresh into a reconnect error, not a crash", async () => {
      await query(
        `UPDATE integration_connection
            SET metadata = metadata || jsonb_build_object('expiresAt', $2::text)
          WHERE workspace_id=$1 AND provider='google'`,
        [workspaceId, new Date(Date.now() - 3_600_000).toISOString()]
      );
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
      );
      await expect(googleAccessToken(workspaceId)).rejects.toMatchObject({
        kind: "conflict",
      });
    });

    it("answers not_found for a workspace with no Google connection", async () => {
      const lonely = await createUser("gm-lonely");
      const lonelyWs = (await ensurePersonalWorkspace(lonely, "GmLonely")).id;
      await expect(googleAccessToken(lonelyWs)).rejects.toMatchObject({
        kind: "not_found",
      });
    });
  });

  describe("Microsoft Graph wrapper", () => {
    it("serves the cached Microsoft token while fresh", async () => {
      await expect(microsoftAccessToken(workspaceId)).resolves.toBe(MS_TOKEN);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("calls Graph shares with the bearer token and records the link", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          id: "ITEM01",
          name: "Deck.pptx",
          webUrl: "https://acme.sharepoint.com/doc/Deck.pptx",
          parentReference: { driveId: "DRIVE01" },
        })
      );
      const link = await linkMicrosoftDriveItem(
        alice,
        taskId,
        "https://acme.sharepoint.com/:p:/g/doc/abc123"
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("https://graph.microsoft.com/v1.0/shares/");
      expect((init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${MS_TOKEN}`
      );
      expect(link).toMatchObject({
        provider: "microsoft",
        externalId: "DRIVE01:ITEM01",
        name: "Deck.pptx",
      });
    });

    it("refuses a sharing URL outside OneDrive/SharePoint without any HTTP", async () => {
      await expect(
        linkMicrosoftDriveItem(alice, taskId, "https://evil.example.test/share/x")
      ).rejects.toMatchObject({ kind: "conflict" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("surfaces a Graph error as a conflict", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "accessDenied" }), { status: 403 })
      );
      await expect(
        linkMicrosoftDriveItem(alice, taskId, "https://acme.sharepoint.com/:x:/g/doc/def456")
      ).rejects.toMatchObject({ kind: "conflict" });
    });
  });
});
