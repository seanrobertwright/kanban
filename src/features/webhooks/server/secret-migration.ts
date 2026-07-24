import { query } from "@/shared/db/client";
import { encryptSecret, isEncrypted } from "@/shared/crypto/secret-box";

/** One-way online migration for 025 rows created before Phase 6 encryption.
 * It is idempotent and runs at each Node process startup, allowing a rolling
 * deployment to converge without a plaintext key in a SQL migration. */
export async function encryptLegacyWebhookSecrets(): Promise<void> {
  const rows = await query<{ id: number; secret: string }>(
    `SELECT id, secret FROM workspace_webhook WHERE secret NOT LIKE 'v1.%'`
  );
  for (const row of rows) {
    if (isEncrypted(row.secret)) continue;
    await query(
      `UPDATE workspace_webhook SET secret = $2 WHERE id = $1 AND secret = $3`,
      [row.id, encryptSecret(row.secret), row.secret]
    );
  }
}
