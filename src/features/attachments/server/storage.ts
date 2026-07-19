import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * The S3-compatible object store for attachments (021).
 *
 * The app speaks the S3 protocol and nothing vendor-specific, so the same code
 * runs against MinIO locally and real S3 / R2 / Supabase Storage in production —
 * only the four env vars change. forcePathStyle is on because MinIO (and most
 * self-hosted S3) addresses buckets as a path segment, not a host subdomain.
 *
 * The client and the bucket check are both lazy singletons: nothing connects at
 * import time (so a build with no storage configured still compiles), and the
 * bucket is ensured once per process rather than on every upload.
 */
let client: S3Client | null = null;
let bucketEnsured: Promise<void> | null = null;

function config() {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Attachment storage is not configured (S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY)"
    );
  }
  return {
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "attachments",
    accessKeyId,
    secretAccessKey,
  };
}

function s3(): S3Client {
  if (client) return client;
  const c = config();
  client = new S3Client({
    endpoint: c.endpoint,
    region: c.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
    },
  });
  return client;
}

function bucketName(): string {
  return config().bucket;
}

/** Creates the bucket if it is missing — once per process, so no init container. */
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return bucketEnsured;
  bucketEnsured = (async () => {
    const Bucket = bucketName();
    try {
      await s3().send(new HeadBucketCommand({ Bucket }));
    } catch {
      // 404 / NoSuchBucket / NotFound all mean "make it"; a real credential or
      // network error resurfaces on the create below, which is where it belongs.
      await s3().send(new CreateBucketCommand({ Bucket }));
    }
  })();
  return bucketEnsured;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  await ensureBucket();
  await s3().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    })
  );
}

/**
 * Opens an object for streaming back to the client. transformToWebStream gives a
 * web ReadableStream, which is exactly what a Response body wants — so the bytes
 * flow store → app → client without ever being buffered whole in the app.
 */
export async function getObjectStream(
  key: string
): Promise<ReadableStream> {
  await ensureBucket();
  const out = await s3().send(
    new GetObjectCommand({ Bucket: bucketName(), Key: key })
  );
  // Body is an sdk stream in Node; transformToWebStream is added by the sdk mixin.
  return (out.Body as {
    transformToWebStream: () => ReadableStream;
  }).transformToWebStream();
}

/** Best-effort object removal. A leftover object is a storage leak, not a bug. */
export async function deleteObject(key: string): Promise<void> {
  await s3().send(
    new DeleteObjectCommand({ Bucket: bucketName(), Key: key })
  );
}
