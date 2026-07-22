import { defineConfig } from "vitest/config";

// Next loads .env.local for us; vitest does not. `--env-file` cannot be passed
// through NODE_OPTIONS, so load it here and forward what the tests need.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall through to whatever is already in the environment (e.g. CI).
}

export default defineConfig({
  // Resolves the @/* alias from tsconfig.json so tests import the same module
  // specifiers the app does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // Required for React Testing Library's automatic cleanup: it registers an
    // afterEach hook only if one exists as a global. Without this it silently
    // never unmounts, so every rendered dialog stacks up in the same document
    // and later tests match elements left behind by earlier ones.
    globals: true,
    // These tests hit a real Postgres and share tables; running files in
    // parallel would let one file's cleanup delete another's fixtures.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      // The secret box (6.5) derives its key from ENCRYPTION_KEY, else
      // BETTER_AUTH_SECRET — forward both so crypto/git tests can encrypt.
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
    },
  },
});
