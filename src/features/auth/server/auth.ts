import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";

// Relative import (not @/ alias) so the better-auth CLI can load this
// config outside the Next.js bundler when running migrations. Reusing the
// shared pool keeps auth queries and app queries on one set of connections.
import { pool } from "../../../shared/db/client";

const trustedOrigins = Array.from(
  new Set(
    [
      "http://localhost:3000",
      "http://localhost:3789",
      process.env.BETTER_AUTH_URL,
      ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? []),
    ]
      .map((origin) => origin?.trim())
      .filter((origin): origin is string => Boolean(origin))
  )
);

export const auth = betterAuth({
  database: pool,
  trustedOrigins,
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  plugins: [
    // SCIM's active=false semantics use this plugin's enforced banned-user
    // state. Without it a provider cannot safely deprovision a user.
    admin(),
    sso({
      // Enterprise defaults: reject obsolete cryptography and require request/
      // response correlation. Providers themselves are configured by admins.
      saml: {
        enableInResponseToValidation: true,
        requireTimestamps: true,
        algorithms: { onDeprecated: "reject" },
      },
      // SSO sign-in is a provisioning boundary: map the provider back to its
      // owning workspace and grant the least-privileged workspace role. The
      // upsert is deliberately idempotent because this runs on every SSO login.
      provisionUserOnEveryLogin: true,
      provisionUser: async ({ user, provider }) => {
        await pool.query(
          `INSERT INTO workspace_member (workspace_id, user_id, role)
           SELECT workspace_id, $2, 'member'::workspace_role
             FROM workspace_identity_provider
            WHERE provider_id = $1
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [provider.providerId, user.id]
        );
      },
      // The plugin endpoint is reachable under /api/auth. Restrict its own
      // registration gate as well as the application route; only workspace
      // owners can ever create a provider record.
      providersLimit: async (user) => {
        const { rows } = await pool.query(
          `SELECT 1 FROM workspace_member
            WHERE user_id = $1 AND role = 'owner' LIMIT 1`,
          [user.id]
        );
        return rows.length ? 20 : 0;
      },
    }),
    scim({
      providerOwnership: { enabled: true },
      storeSCIMToken: "hashed",
      // The public Better Auth endpoint remains available, but only a workspace
      // owner may mint a token for an identity provider mapped to that workspace.
      // This also protects callers that bypass the app's convenience route.
      canGenerateToken: async ({ user, providerId }) => {
        const { rows } = await pool.query(
          `SELECT 1
             FROM workspace_identity_provider p
             JOIN workspace_member m ON m.workspace_id = p.workspace_id
            WHERE p.provider_id = $1 AND m.user_id = $2 AND m.role = 'owner'
            LIMIT 1`,
          [providerId, user.id]
        );
        return rows.length === 1;
      },
    }),
  ],
});
