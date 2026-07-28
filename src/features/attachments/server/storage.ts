import * as local from "./local-store";
import * as s3 from "./s3-store";

/**
 * Attachment storage (021), and which store is behind it.
 *
 * Configure S3 and you get the object store — the right answer for anything
 * running more than one app process, since two containers share a bucket and
 * never a filesystem. Configure nothing and attachments still work, on local
 * disk under `ATTACHMENTS_DIR` (default `./data/attachments`).
 *
 * The fallback is the point. Before it, a fresh self-host threw
 * "Attachment storage is not configured" on the first upload and the feature
 * simply did not exist until someone stood up MinIO — a hard dependency the
 * rest of this app deliberately avoids. Falling back rather than failing means
 * the default deployment has every feature, and S3 is an upgrade for the
 * deployments that have outgrown one disk.
 *
 * The choice is read per call rather than latched at import: process.env is
 * settable in a test, and a module-load-time decision would make the two
 * backends untestable in one process.
 *
 * `contentType` reaches S3 (which stores it as object metadata) and is dropped
 * by the local store, which has nowhere to put it. Neither matters to a reader:
 * the type served back to a browser comes from the `attachment` row, not from
 * the store, so the two backends are indistinguishable downstream.
 */

/** Which backend a call would use. Exported for the settings surface and for
 *  tests that need to say which store they are exercising. */
export function backend(): "s3" | "local" {
  return s3.configured() ? "s3" : "local";
}

/** Where local objects live, for the operator who has to back it up. Null when
 *  S3 is configured, since then nothing is written here. */
export function localRoot(): string | null {
  return backend() === "local" ? local.root() : null;
}

export function putObject(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  return backend() === "s3"
    ? s3.putObject(key, body, contentType)
    : local.putObject(key, body);
}

export function getObjectStream(key: string): Promise<ReadableStream> {
  return backend() === "s3" ? s3.getObjectStream(key) : local.getObjectStream(key);
}

/** Best-effort removal: a leftover object is a storage leak, not a bug. */
export function deleteObject(key: string): Promise<void> {
  return backend() === "s3" ? s3.deleteObject(key) : local.deleteObject(key);
}
