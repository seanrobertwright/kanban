---
title: Getting started
description: Run the kanban platform locally or with Docker Compose.
---

## Prerequisites

- **Node.js 20.9+** and npm
- **Docker** (for Postgres, or the full stack)

## Quick start (local dev)

```sh
git clone https://github.com/seanrobertwright/kanban.git
cd kanban
npm install

# 1. Start Postgres
npm run db:up
```

Create `.env.local` before running any database or application command:

```dotenv
DATABASE_URL=postgresql://kanban:kanban_dev_password@127.0.0.1:5434/kanban
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000
BETTER_AUTH_SECRET=<high-entropy-secret>
GITHUB_CLIENT_ID=<github-oauth-app-client-id>
GITHUB_CLIENT_SECRET=<github-oauth-app-client-secret>
```

Generate `BETTER_AUTH_SECRET` with a password manager or:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Create a GitHub OAuth app and register `http://localhost:3000/api/auth/callback/github` as its authorization callback URL. Put its client id and secret in `.env.local`, then continue:

```sh
# 2. Create auth tables + apply application migrations
npm run db:setup

# 3. Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and a personal
workspace with a default board is created on first sign-in.

The values above are the complete local bootstrap contract. Keep `.env.local`
uncommitted. Optional integrations add their own variables; see
[Enterprise deployment](/kanban/enterprise/) for the production contract.

## Full stack with Docker

```sh
npm run docker:up     # builds and starts app + postgres + minio + realtime
npm run docker:down
```

Compose reads the same root `.env.local`; create it with the bootstrap values above before running `docker:up`.

The compose file ships four services:

| Service | Purpose |
|---|---|
| `app` | The Next.js application. |
| `postgres` | The one database — every feature stores here. |
| `minio` | S3-compatible blob storage for attachments. |
| `realtime` | The WebSocket (Yjs) server behind co-editing, chat, and whiteboards. |

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run db:migrate` | Apply numbered SQL migrations (idempotent). |
| `npm run create-agent` | Mint a workspace-scoped agent key ([Agents](/kanban/agents/http-api/)). |
| `npm run mcp` | Run the MCP server over the agent API. |
| `npm run realtime` | Run the realtime (Yjs) server standalone. |
| `npm test` | Vitest suite (pure libs + DB repositories). |
