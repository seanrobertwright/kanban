---
title: Getting started
description: Run the kanban platform locally or with Docker Compose.
---

## Prerequisites

- **Node.js 20+** and npm
- **Docker** (for Postgres, or the full stack)

## Quick start (local dev)

```sh
git clone https://github.com/seanrobertwright/kanban.git
cd kanban
npm install

# 1. Start Postgres
npm run db:up

# 2. Create auth tables + apply application migrations
npm run db:setup

# 3. Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and a personal
workspace with a default board is created on first sign-in.

Configuration lives in `.env.local` — `DATABASE_URL` is the only hard
requirement for dev; see [Enterprise deployment](/kanban/enterprise/) for the
production variables.

## Full stack with Docker

```sh
npm run docker:up     # builds and starts app + postgres + minio + realtime
npm run docker:down
```

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
