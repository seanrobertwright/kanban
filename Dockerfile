# syntax=docker/dockerfile:1

# Multi-stage. One Dockerfile, two shipped targets:
#
#   builder — full deps + full source. Runs `next build`, and is reused as the
#             image for the one-shot `migrate` service (dev-time schema tooling:
#             @better-auth/cli + scripts/migrate.mjs) and for the dev server
#             (`next dev`, via docker-compose.override.yml).
#   runner  — slim: only the standalone bundle + static assets, non-root. The
#             production `app` service. This is the default target.
#
# Debian-based node (not alpine) on purpose: the dependency tree pulls native
# modules with glibc prebuilds (sharp via next, better-sqlite3 via better-auth)
# that are a fight to build against alpine's musl.
FROM node:22-bookworm-slim AS base
WORKDIR /app

# ---- deps: install once so the layer caches across source changes. FULL deps,
# including dev: the build needs them, and the migrate service runs dev-time
# tooling. A production-only prune here would break both. ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: source, then build. Two build-time notes:
#
# - next build fetches Inter and Geist Mono from Google Fonts (next/font/google),
#   so the build needs network — a standard Next constraint with no offline
#   fallback.
# - "Collecting page data" IMPORTS every route handler, which constructs the pg
#   Pool at module load (shared/db/client.ts) and the better-auth instance. Those
#   need a DATABASE_URL and secret to *exist*, but never connect or sign anything
#   during the build — every DB route is force-dynamic, so nothing runs. Hence the
#   throwaway values, scoped to THIS RUN only (inline env does not persist into
#   the image); compose injects the real values at runtime.
#
# `output: standalone` (next.config.ts) makes this emit .next/standalone. ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL="postgres://build:build@localhost:5432/build" \
    BETTER_AUTH_SECRET="build-only-placeholder" \
    npm run build

# ---- runner: the production image. Nothing but the standalone bundle and the
# assets it cannot serve on its own. ----
FROM base AS runner
ENV NODE_ENV=production

# standalone's server.js does NOT bundle public/ or .next/static (they are meant
# for a CDN) — copy them in so the single container serves everything. --chown so
# the unprivileged user owns them (Next may write to .next/cache at runtime).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Drop root: node:bookworm ships an unprivileged `node` user.
USER node

EXPOSE 3000
# server.js reads HOSTNAME/PORT from env. 0.0.0.0 so it is reachable outside the
# container. Migrations are NOT run here — the compose `migrate` service applies
# them once, and `app` waits for it (service_completed_successfully).
ENV HOSTNAME=0.0.0.0 PORT=3000
CMD ["node", "server.js"]
