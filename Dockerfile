# syntax=docker/dockerfile:1

# The kanban app in one image. Debian-based node (not alpine) on purpose: the
# dependency tree pulls native modules with glibc prebuilds (sharp via next,
# better-sqlite3 via better-auth) that are a fight to build against alpine's musl.
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first so the layer caches across source changes. FULL
# deps, including dev: this image both BUILDS the app (next build) and, at
# startup, applies migrations (scripts/migrate.mjs + the better-auth CLI) — both
# of which are dev-time tooling, so a production-only prune would break the boot.
COPY package.json package-lock.json ./
RUN npm ci

# Source, then build. next build needs network the first time — next/font/google
# fetches Inter and Geist Mono at build time (a standard Next constraint; the
# build has no offline fallback for them).
COPY . .
RUN npm run build

EXPOSE 3000

# On boot: apply the better-auth schema and our SQL migrations, then serve. Both
# steps are idempotent (better-auth is a no-op if applied; migrate.mjs skips what
# is already in _migration), so running them every start is safe — and it is what
# makes `docker compose up` against a fresh Postgres volume work with no manual
# setup step.
#
# Called directly rather than via `npm run db:setup`, because db:migrate passes
# `--env-file=.env.local` — a file that does not exist in the image (env arrives
# as real variables from compose, not a file). Both readers take DATABASE_URL
# straight from process.env, so no --env-file is needed here. -H 0.0.0.0 binds the
# port so it is reachable from outside the container.
CMD ["sh", "-c", "npm run db:auth && node scripts/migrate.mjs && npx next start -H 0.0.0.0"]
