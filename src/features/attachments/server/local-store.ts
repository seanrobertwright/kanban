import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * The local-disk attachment store — what runs when no S3 endpoint is configured.
 *
 * A self-hosted kanban that cannot accept a file until someone stands up MinIO
 * is a self-hosted kanban with no attachments, which is what this fixes. The
 * object store stays the better answer for anything with more than one app
 * process (two containers do not share a filesystem, and neither does a
 * container and its next deploy), so S3 still wins whenever it is configured —
 * this is the floor, not the recommendation.
 *
 * Keys are the same opaque `tasks/<id>/<uuid>` strings S3 sees, mapped straight
 * onto directories under the root.
 */

/** Where objects live. Relative paths resolve against the process's cwd, which
 *  for `next start` and for docker is the app root — the same place `.env` and
 *  `package.json` are, so `./data/attachments` means what it looks like. */
export function root(): string {
  return path.resolve(process.env.ATTACHMENTS_DIR ?? "./data/attachments");
}

/**
 * A key's path on disk, or a throw.
 *
 * Every key this store sees is minted by the repository (`tasks/<id>/<uuid>`),
 * so traversal is not reachable today. The check is here because that is a
 * property of a caller, not of this module: the day a key comes from anywhere
 * else, `../../../etc/passwd` must not resolve, and a store that trusts its
 * input would make that a one-line vulnerability in someone else's commit.
 */
function pathFor(key: string): string {
  const base = root();
  const full = path.resolve(base, key);
  const inside = full === base || full.startsWith(base + path.sep);
  if (!inside || key.includes("\0")) {
    throw new Error("Invalid attachment key");
  }
  return full;
}

export async function putObject(key: string, body: Uint8Array): Promise<void> {
  const full = pathFor(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
}

/**
 * Opens the object as a web stream, matching the S3 backend's contract so the
 * repository never learns which store it is talking to. `Readable.toWeb` hands
 * a Response body the bytes without buffering the file in memory.
 */
export async function getObjectStream(key: string): Promise<ReadableStream> {
  const full = pathFor(key);
  const node = createReadStream(full);
  // A missing file surfaces when the stream is read, which would be a broken
  // response body rather than an error. Wait for the open so the caller gets a
  // throw it can turn into a 404, the way a missing S3 object does.
  await new Promise<void>((resolve, reject) => {
    node.once("open", () => resolve());
    node.once("error", reject);
  });
  return Readable.toWeb(node) as ReadableStream;
}

/** Best-effort removal, matching the S3 backend: a leftover file is a leak, not
 *  a failure the caller should have to handle. */
export async function deleteObject(key: string): Promise<void> {
  await rm(pathFor(key), { force: true });
}
