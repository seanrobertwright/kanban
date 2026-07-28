import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backend, deleteObject, getObjectStream, localRoot, putObject } from "./storage";

/**
 * The local-disk fallback (rock 5). No database and no MinIO on purpose: what
 * is being tested is that a deployment with *neither* still has attachments,
 * which was the defect — `storage.ts` threw "Attachment storage is not
 * configured" on the first upload, so a fresh self-host had the feature in the
 * UI and nowhere for the bytes to go.
 */

const S3_VARS = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
const saved: Record<string, string | undefined> = {};
let root: string;

async function bytesOf(stream: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("attachment storage without S3", () => {
  beforeAll(() => {
    for (const v of S3_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    root = path.join(tmpdir(), `kanban-attach-${randomUUID()}`);
    saved.ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR;
    process.env.ATTACHMENTS_DIR = root;
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("falls back to local disk when no S3 endpoint is configured", () => {
    expect(backend()).toBe("local");
    expect(localRoot()).toBe(path.resolve(root));
  });

  it("round-trips bytes through a nested key", async () => {
    const key = `tasks/42/${randomUUID()}`;
    const body = new TextEncoder().encode("the quick brown fox");
    await putObject(key, body, "text/plain");

    // On disk where the operator can back it up, under the key's own path.
    expect(await readFile(path.join(root, key))).toEqual(Buffer.from(body));
    expect(await bytesOf(await getObjectStream(key))).toEqual(body);
  });

  it("removes an object, and shrugs at one that is already gone", async () => {
    const key = `tasks/1/${randomUUID()}`;
    await putObject(key, new Uint8Array([1, 2, 3]), "application/octet-stream");
    await deleteObject(key);
    await expect(stat(path.join(root, key))).rejects.toThrow();
    // Best-effort, matching the S3 backend: the caller deleting a row should not
    // have to care whether the bytes were still there.
    await expect(deleteObject(key)).resolves.toBeUndefined();
  });

  it("throws on a missing object rather than handing back a broken stream", async () => {
    // The open is awaited so this surfaces as an error the repository can turn
    // into a 404, not as a response body that fails mid-flight.
    await expect(getObjectStream("tasks/1/nope")).rejects.toThrow();
  });

  it("refuses a key that would escape the root", async () => {
    // Unreachable through the repository, which mints every key — and checked
    // anyway, because "the caller is careful" is not a property this module can
    // hold on its own.
    for (const key of ["../escape", "tasks/../../escape", "/etc/passwd"]) {
      await expect(putObject(key, new Uint8Array([0]), "text/plain")).rejects.toThrow(
        /Invalid attachment key/
      );
    }
  });

  it("uses S3 again as soon as an endpoint is configured", () => {
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_ACCESS_KEY = "k";
    process.env.S3_SECRET_KEY = "s";
    try {
      expect(backend()).toBe("s3");
      expect(localRoot()).toBeNull();
    } finally {
      for (const v of S3_VARS) delete process.env[v];
    }
  });

  it("needs all three S3 vars before it will use the object store", () => {
    // An endpoint with no credentials is a misconfiguration. Reading it as
    // "S3 is on" would fail every upload; reading it as "S3 is off" would
    // silently write to a container disk that the next deploy discards. It
    // means neither is configured, and the local store is the honest answer.
    process.env.S3_ENDPOINT = "http://localhost:9000";
    try {
      expect(backend()).toBe("local");
    } finally {
      delete process.env.S3_ENDPOINT;
    }
  });
});
