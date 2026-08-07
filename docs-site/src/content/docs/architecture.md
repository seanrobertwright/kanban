---
title: Architecture
description: How Kanban keeps the web interface, agent doors, authorization, data, realtime services, and integrations coherent.
---

Kanban is a Next.js application over Postgres with small adjacent services for realtime collaboration and MCP. The repository is organized by business capability so a change to claims, tasks, objectives, or integrations can be traced without crossing a generic controller-service-repository maze.

At the documentation snapshot on **7 August 2026**, the repository contained 42 feature slices, 188 Next.js API route files, 88 numbered SQL migrations, 153 test files, and 56 MCP tools. These are orientation counts, not stable API guarantees.

## System map

```text
Browser / native board agents / external agents
                   │
        Next.js routes and server actions
                   │
       feature handlers + authorization
          ┌────────┴─────────┐
       Postgres        activity history
          │                  │
   derived reads      automation/webhooks

External MCP client ⇄ local stdio adapter ⇄ agent HTTP routes
Realtime clients    ⇄ Yjs WebSocket service
Attachment clients  ⇄ S3-compatible object storage
```

The central invariant is convergence: changing the transport must not create a second set of business rules.

## Feature slices

Every major capability lives under `src/features/<name>/`. A mature slice can contain:

```text
src/features/<name>/
├── types.ts              # public shapes, constants, schemas
├── lib/                  # pure domain computation
├── server/
│   ├── repository.ts     # persistence and scoped reads
│   ├── handlers.ts       # transport-independent request behavior
│   └── ...
├── client/
│   └── api.ts            # typed browser-facing requests
└── components/           # React UI owned by the feature
```

Not every slice needs every directory. The shape is a navigation convention, not an obligation to generate empty layers.

Thin route files under `src/app/api/**/route.ts` parse transport input and delegate to the owning feature. Domain decisions stay out of route glue so the web application and agent surfaces can reuse them.

## The actor model

A principal is a person or an agent. Both are resolved into a workspace and role before business logic runs.

The role ladder is:

```text
owner > admin > member > viewer
```

Guests sit outside the ordinary workspace ladder and receive per-object access. Granular board, field, and action grants refine the base role through central capability checks.

Agent identity is not a display label attached after a request. It is used for:

- workspace scoping;
- authorization;
- assignment;
- claim ownership;
- comments and mentions;
- notification delivery;
- activity attribution;
- approval policy.

## Two agent doors

### Door 1: native board agents

The application can run hosted agents through its native runtime. Tools are narrow operations such as reading a task, claiming it, moving it, or adding a comment. The runtime does not receive a generic database or arbitrary board-write primitive.

### Door 2: external execution agents

Claude Code, Codex, Cursor, scripts, and custom runtimes connect with a workspace-scoped agent key. They can call the HTTP routes directly or use the local MCP adapter.

The MCP server is intentionally thin: each tool maps to an authenticated API operation. It adds client-facing tool names, structured error behavior, resources, prompts, deadlines, and bounded retry policy; it does not reimplement the domain.

Both doors share identity, roles, claims, audit, and review gates.

## Claims and concurrency

Assignment answers who is responsible. A claim answers who is actively working now.

Claims are exclusive and leased:

- another agent receives a conflict rather than a second hold;
- the holder can renew its lease;
- leases expire so a crashed process cannot wedge work forever;
- release is explicit on completion or abandonment.

Realtime board updates do not replace transactional checks. The database remains authoritative for claim ownership, transitions, and mutation ordering.

## Data and migrations

Postgres is the system of record for application data, authentication, authorization state, and audit history.

Migrations are numbered SQL files under `src/shared/db/migrations/` and run in filename order once each. The migration runner—not feature code—owns schema evolution.

Important data rules:

1. **Workspace scope is part of every resource read.** A globally unique id is not authorization.
2. **Nullable updates are three-valued.** Omitted means unchanged, `null` means clear, and a value means set.
3. **Cross-object deletion usually unlinks.** Foreign keys use `SET NULL` where cascade deletion would destroy unrelated work.
4. **Derived facts stay derived.** Progress, risk, spend, flow metrics, and rollups are computed from underlying records.
5. **Creates can be idempotent.** Retried external create requests use stable idempotency keys to avoid duplicate tasks or comments.

## Activity and automation

Committed state changes write attributable activity. That history is read by people and agents and feeds other mechanisms:

```text
mutation → commit → activity → automation / webhook / integration delivery
```

The activity record is the shared vocabulary. Automation and integration delivery should not create an untraceable second event system.

Scheduled jobs, webhook deliveries, and integration handlers still run through scoped feature behavior. A background process is not exempt from permissions or attribution simply because no browser initiated it.

## Approval gates

Mutations are classified by operator policy and blast radius. Depending on workspace configuration, an action can be:

- applied immediately;
- held as a proposal for human review;
- blocked.

Dry-run support lets an external agent inspect the tier and proposed state before writing. High-level objects such as objectives and epics can be review-held even when a narrow task-field update applies immediately.

The system branches on action and policy, not on a model-generated confidence score.

## Realtime collaboration

`realtime/` is a small Yjs WebSocket service used by co-edited documents, chat, and whiteboards. The browser receives responsive collaborative state; durable application records remain in the application data model.

The realtime service is the intentionally stateful adjacent process. It is not a second authorization or task backend.

## Attachments

Attachment metadata lives in Postgres. Blob bytes use an S3-compatible store such as MinIO or Amazon S3. This separation keeps task queries and backups from carrying large binary payloads while preserving workspace-scoped metadata and audit behavior.

## Security boundaries

- Agent keys are hashed server-side and shown only when minted.
- Git-host tokens, webhook signing secrets, OAuth refresh tokens, and IdP secrets are encrypted with AES-256-GCM using `ENCRYPTION_KEY`.
- Inbound provider webhooks verify signatures.
- Outbound webhooks are HMAC-signed.
- Markdown is rendered through shared safe components rather than arbitrary HTML injection.
- Network IP policy depends on a trusted reverse proxy overwriting client-IP headers.
- TLS terminates at the deployment’s reverse proxy or ingress.

See [Enterprise deployment](../enterprise/) for production configuration and operational limits.

## Repository entry points

| Path | Responsibility |
|---|---|
| `src/app/` | Next.js pages and route adapters. |
| `src/features/` | Business capabilities and their UI/server boundaries. |
| `src/shared/` | Cross-cutting infrastructure such as database and rendering. |
| `mcp/server.mjs` | External-agent MCP adapter. |
| `realtime/server.mjs` | Yjs WebSocket process. |
| `scripts/create-agent.mjs` | Agent identity and key creation. |
| `docs-site/` | This Astro/Starlight documentation site. |

## Design rules

1. Derive facts instead of duplicating summaries.
2. Keep transport adapters thin.
3. Resolve identity and workspace before resource access.
4. Use narrow typed operations for agent intent.
5. Record activity after committed state.
6. Treat review-held work as unapplied.
7. Keep realtime responsiveness separate from durable truth.
8. Prefer a feature-owned contract over a second global convention.

## Continue reading

- [Why I built Kanban](../why-built/) for the product decisions behind these boundaries.
- [MCP reference](../agents/mcp/) for the exact external-agent tool surface.
- [Security and administration](../guide/security-admin/) for in-product controls.
- [Enterprise deployment](../enterprise/) for production services and secrets.
