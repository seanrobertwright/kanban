import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Application-level encryption of secrets at rest (6.5, pulled forward ahead of
 * Phase 2 because 2.0 is the first feature to store a third-party credential).
 *
 * The rule this enforces: a third-party bearer credential — a git-host inbound
 * signing secret (2.0), an OAuth installation/access token (2.1), an IdP or SCIM
 * secret (6.1/6.2), an integration refresh token (Phase 7) — is never written to
 * Postgres in the clear. It rides through `encryptSecret` on the way in and
 * `decryptSecret` on the way out, so a leaked database dump yields ciphertext,
 * not live credentials.
 *
 * Why app-side AEAD rather than pgcrypto: it is self-contained (no server
 * extension to install in every deployment), the key never reaches the database
 * (a dump cannot carry the means to decrypt itself), and AES-256-GCM's auth tag
 * makes tampering a hard decryption failure rather than silent corruption — the
 * property plaintext storage (the 025 webhook-secret precedent) cannot offer.
 *
 * This deliberately does NOT retrofit the existing plaintext secrets (the 025
 * webhook signing key). That key signs *outbound* payloads and authorizes
 * nothing inbound, and 025 documented that trade; migrating it is its own commit.
 * What ships here is the primitive plus its first consumer's readiness — new
 * inbound credentials use it from day one.
 */

// AES-256-GCM: a 32-byte key, a 12-byte IV (GCM's standard nonce length), and a
// 16-byte auth tag. The IV is random per encryption, so encrypting the same
// plaintext twice yields different ciphertext (no equality oracle across rows).
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

/**
 * Derives the 32-byte AES key from the deployment's secret material, once.
 *
 * Preference order: a dedicated `ENCRYPTION_KEY`, else `BETTER_AUTH_SECRET` — a
 * high-entropy secret every deployment already sets (auth cannot run without it),
 * so encryption works out of the box while a dedicated key stays the documented
 * upgrade. scrypt stretches whatever string is provided into a uniform 32 bytes;
 * a fixed salt is acceptable here because the input is already a secret, not a
 * low-entropy password, and a deterministic key is required for a symmetric box
 * (a random salt would need to be stored, and storing it beside the ciphertext
 * buys nothing when the key input is the actual secret).
 *
 * Rotating the key orphans every existing ciphertext (they no longer decrypt) —
 * a documented operational cost, not a silent one; key rotation with re-encrypt
 * is later work behind the `VERSION` tag.
 */
let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const material = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!material) {
    throw new Error(
      "No key material for secret encryption: set ENCRYPTION_KEY (or BETTER_AUTH_SECRET)"
    );
  }
  cachedKey = scryptSync(material, "kanban-secret-box-v1", KEY_BYTES);
  return cachedKey;
}

/** Whether a decryptable key is configured — lets a caller choose to store a
 *  secret only when it can protect it, rather than silently falling to plaintext. */
export function encryptionConfigured(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET);
}

/**
 * Encrypts a UTF-8 string, returning a self-describing token:
 *   `v1.<iv>.<tag>.<ciphertext>`  (each segment base64url, no padding).
 *
 * The version prefix is not decoration: it is the seam a future key rotation or
 * algorithm change reads to know how a stored blob was produced, so old and new
 * ciphertexts can coexist during a migration.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypts a token minted by `encryptSecret`. Throws if the token is malformed,
 * the version is unknown, or the GCM auth tag fails — i.e. if the ciphertext,
 * IV, or tag was altered. A caller that stored ciphertext and reads back a throw
 * is seeing tampering or a key change, never silently-wrong plaintext.
 */
export function decryptSecret(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed or unversioned secret token");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("Malformed secret token: bad IV or tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws on auth-tag mismatch (tampering / wrong key)
  ]);
  return plaintext.toString("utf8");
}

/** Whether a stored value is one of our ciphertext tokens (vs. a legacy
 *  plaintext value), by its version prefix — for a mixed-state read path. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`);
}
