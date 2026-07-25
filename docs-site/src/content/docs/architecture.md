---
title: Architecture
description: The conventions every feature in the codebase follows.
---

One Next.js app over one Postgres database, organized so that seventy-plus
features stay navigable. Seven rules do most of the work.

## Feature slices

Every capability is one directory under `src/features/<name>/` with fixed
bones:

```
src/features/<name>/
├── types.ts              # shapes + consts
├── lib/                  # pure functions, unit-tested
├── server/repository.ts  # DB access + authorization
├── server/handlers.ts    # HTTP handlers
├── client/api.ts         # typed fetch wrappers
└── components/           # React components
```

Route files under `src/app/api/**/route.ts` stay thin — they delegate to the
slice's handlers. Migrations are plain numbered SQL in
`src/shared/db/migrations/`, applied in filename order, once each.

## The rules

1. **Derive, don't store.** Scores, rollups, spend, flow metrics, and risk are
   computed in pure `lib/` functions from stored facts at read time. Stored
   aggregates go stale; derived ones cannot.

2. **Two doors for agents.** Anything an agent can do exists in both the
   runtime tool set and the MCP server, gated by the same approval tiers. An
   agent is a principal, never a back door.

3. **RBAC ladder.** `owner > admin > member > viewer` (with `guest` below, for
   per-object shares). Reads are viewer+, authoring is member, structural or
   blast-radius changes are admin. Granular per-board/field/action grants
   layer on top through one central `can(actor, capability, object)` check.

4. **One event stream.** Every state change writes the activity log
   post-commit; webhooks, the automation engine, and integrations are all
   subscribers on that same stream. No second event bus.

5. **Safe rendering.** User Markdown renders through one shared
   Markdown→React renderer — never `dangerouslySetInnerHTML`. Every doc,
   comment, and chat surface reuses it.

6. **Three-valued nullable + SET NULL.** Optional fields distinguish
   absent / null / value; cross-object foreign keys `SET NULL` so deleting an
   object un-links rather than cascade-destroys.

7. **Proposals, not silent mutations.** AI output (schedules, risk
   narrations, drafted automations, extracted action items) arrives as a
   reviewable changeset a human accepts item-by-item, applied through the same
   gates a human write would pass.

## Services beside the app

| Service | Why it exists |
|---|---|
| **Postgres** | The one store — features, auth, migrations, audit. |
| **MinIO / S3** | Attachment blobs (the DB holds metadata only). |
| **Realtime (`realtime/`)** | A small Yjs WebSocket server — the one stateful piece — behind co-editing, chat, and whiteboards. |
| **MCP (`mcp/`)** | The agent door for MCP clients. |

## Security posture

Secrets at rest (git-host tokens, webhook signing keys, OAuth refresh tokens,
IdP secrets) are AES-256-GCM encrypted with a dedicated `ENCRYPTION_KEY`.
Inbound webhooks verify provider signatures; outbound ones are HMAC-signed.
TLS terminates at the reverse proxy. See
[Enterprise deployment](/kanban/enterprise/).
