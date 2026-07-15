import { betterAuth } from "better-auth";

// Relative import (not @/ alias) so the better-auth CLI can load this
// config outside the Next.js bundler when running migrations. Reusing the
// shared pool keeps auth queries and app queries on one set of connections.
import { pool } from "../../../shared/db/client";

export const auth = betterAuth({
  database: pool,
  trustedOrigins: ["http://localhost:3000", "http://localhost:3789"],
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
});
