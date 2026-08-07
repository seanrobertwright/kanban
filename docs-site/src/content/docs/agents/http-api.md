---
title: Agent HTTP API
description: Authenticate an agent, read and mutate board state, handle policy and retries, and integrate without MCP.
---

Any program that can make HTTP requests can work with Kanban as a named agent. The API uses the same application handlers, workspace boundaries, roles, approval policy, and activity history as the web interface.

Use the [MCP server](../mcp/) when a coding client already speaks MCP. Use HTTP when you are building a script, service, custom agent runtime, or integration that needs direct control.

## Base URL and authentication

Examples use:

```sh
BASE=http://localhost:3000
KEY=kbn_...
```

Create an identity from the repository root:

```sh
npm run create-agent -- --workspace <slug-or-id> --name "My Bot" --role member
```

The key is shown once. Present it on every request:

```http
x-agent-key: kbn_...
```

A key resolves to one agent in one workspace. Resource ids from another workspace return `404`; the response does not reveal whether the resource exists elsewhere.

## Identity and board discovery

Never begin with a guessed board id.

| Method and path | Returns |
|---|---|
| `GET /api/agent/me` | Agent id, name, role, workspace, and accessible boards. |
| `GET /api/board/:boardId` | Columns and top-level tasks. |
| `GET /api/board/:boardId/tasks/search` | Filtered, paged tasks. |
| `GET /api/workspaces/:workspaceId/assignees` | Assignable people and agents. |
| `GET /api/workspaces/:workspaceId/labels` | Workspace label vocabulary. |

```sh
curl -s "$BASE/api/agent/me" -H "x-agent-key: $KEY"
```

### Task search

`GET /api/board/:boardId/tasks/search` accepts query parameters used by the MCP `search_tasks` tool:

- `q`
- `columnId`
- `assignee` as `human:<id>`, `agent:<id>`, or `none`
- `priority`
- `type`
- repeated `labelId`
- `milestoneId`, `sprintId`, `epicId`
- `dueBefore`, `dueAfter`
- `includeSubtasks`, `openOnly`
- `limit`, `cursor`

Filters combine with AND. Follow `nextCursor` until it is `null`.

## Read one task and its context

| Method and path | Returns |
|---|---|
| `GET /api/tasks/:id` | Task fields, assignment, dates, labels, claim, and related state. |
| `GET /api/tasks/:id/risk` | Derived delivery-risk signal for one task. |
| `GET /api/tasks/:id/activity` | Authoritative history, newest first. |
| `GET /api/tasks/:id/subtasks` | Direct child tasks. |
| `GET /api/tasks/:id/comments` | Comment thread. |
| `GET /api/tasks/:id/dependencies` | Blocked-by edges with relationship type and lag. |
| `GET /api/tasks/:id/checklist` | Checklist items and completion. |
| `GET /api/tasks/:id/custom-fields` | Current custom-field values. |
| `GET /api/tasks/:id/time` | Time entries. |
| `GET /api/tasks/:id/attachments` | Attachment metadata. |
| `GET /api/tasks/:id/git-links` | Linked branches, commits, and pull requests. |
| `GET /api/tasks/:id/ci-status` | CI state for linked development work. |

Read history and dependencies before mutating a task that may have changed since it was assigned.

## Create and update tasks

### Create

```http
POST /api/tasks
content-type: application/json
idempotency-key: <unique-request-id>
```

```json
{
  "columnId": 3,
  "title": "Investigate upload timeout",
  "description": "Reproduce, identify the boundary, and report evidence.",
  "priority": "high",
  "type": "bug",
  "assignee": { "type": "agent", "id": "agent-id" },
  "labelIds": [4, 9],
  "startDate": "2026-08-07",
  "dueDate": "2026-08-09"
}
```

Set `parentId` to create a subtask.

Use an `Idempotency-Key` for create requests. If the connection fails after the server receives a POST, retrying without a stable key can create a duplicate.

### Patch

```http
PATCH /api/tasks/:id
content-type: application/json
```

Only supplied fields change. Nullable fields can be cleared with `null`. Supported task fields include:

- `title`, `description`, `priority`, `type`
- `estimate`, `value`, `risk`
- `columnId`, `position`
- `assignee`, `labelIds`
- `startDate`, `dueDate`
- `milestoneId`, `sprintId`, `epicId`

Moving to another column is a patch with `columnId` and zero-based `position`.

```sh
curl -s -X PATCH "$BASE/api/tasks/42" \
  -H "x-agent-key: $KEY" \
  -H "content-type: application/json" \
  -d '{"columnId":3,"position":0}'
```

### Bulk patch or delete

```http
POST /api/tasks/bulk
```

The body contains up to 100 `ids` plus one or more of `columnId`, `assignee`, `priority`, or `dueDate`. Authorization and history are evaluated per task, so a partial failure is reported per item instead of rolling back successful items.

Task deletion is also reachable through the direct HTTP surface:

```http
DELETE /api/tasks/:id

POST /api/tasks/bulk
content-type: application/json

{ "ids": [42, 43], "delete": true }
```

A member-role agent can delete tasks immediately; these calls do not pass through the MCP approval-policy tools. Single-delete dry runs are unsupported, and bulk operations never support dry run. Treat deletion as destructive, do not retry it automatically, and prefer a human-reviewed request unless the operator has explicitly authorized the agent to delete work.

## Claim, report, and release

### Claim

```http
POST /api/tasks/:id/claim
```

Optional body:

```json
{ "ttlMinutes": 60 }
```

A successful claim creates or renews the current agent’s expiring hold. `409 CONFLICT` means another agent holds the task; it is not a signal to retry.

### Comment

```http
POST /api/tasks/:id/comments
idempotency-key: <unique-request-id>
```

```json
{ "body": "Reproduced the timeout at the object-store boundary; investigating retry ownership." }
```

### Release

```http
DELETE /api/tasks/:id/claim
```

Releasing a task the current agent does not hold is harmless. Release on completion, pause, or abandonment.

## Dependencies

Create or revise a blocked-by edge:

```http
POST /api/tasks/:id/dependencies
```

```json
{
  "dependsOnId": 17,
  "type": "FS",
  "lagDays": 0
}
```

`type` is `FS` (finish-to-start), `SS` (start-to-start), or `FF` (finish-to-finish). `lagDays` is a signed offset. The server refuses self-references and cycles.

Remove an edge:

```http
DELETE /api/tasks/:id/dependencies/:dependsOnId
```

## Checklists and custom fields

| Method and path | Body | Effect |
|---|---|---|
| `POST /api/tasks/:id/checklist` | `{ "content": "..." }` | Append an item. |
| `PATCH /api/checklist/:itemId` | `done?`, `content?` | Complete, reopen, or reword an item. |
| `GET /api/board/:boardId/custom-fields` | — | Read field definitions. |
| `PUT /api/tasks/:id/custom-fields` | `{ "values": [...] }` | Replace all values. |

Custom-field updates replace the complete set. Read the current values and send back entries that must remain.

## Planning and portfolio endpoints

| Method and path | Purpose |
|---|---|
| `GET /api/board/:boardId/milestones` | Milestones and derived progress. |
| `GET /api/board/:boardId/sprints` | Sprint goals, windows, and state. |
| `GET /api/board/:boardId/epics` | Epics, owner, status, progress, and derived window. |
| `POST /api/board/:boardId/epics` | Create an epic. |
| `PATCH /api/epics/:id` | Edit epic name, status, or owner. |
| `GET /api/board/:boardId/objectives` | Objectives and key results. |
| `POST /api/board/:boardId/objectives` | Create an objective. |
| `PATCH /api/objectives/:id` | Edit objective name, description, or due date. |
| `PATCH /api/key-results/:id` | Update `{ "currentValue": number }` only. |

Task membership in a sprint or epic and milestone targeting use the ordinary task patch fields.

## Analytics, schedule, and risk

| Method and path | Purpose |
|---|---|
| `GET /api/board/:boardId/analytics` | Lead/cycle time, throughput, cumulative flow, workload. |
| `GET /api/board/:boardId/schedule` | Read-only dependency/capacity schedule proposal. |
| `GET /api/board/:boardId/risk` | Deterministic delivery-risk signals. |
| `GET /api/board/:boardId/export?format=json` | Full board export. |

A schedule response is a proposal and writes nothing. Risk is derived from facts such as overdue dates, blockers, and age; it does not authorize reprioritization.

## Notifications, change feed, and knowledge

| Method and path | Purpose |
|---|---|
| `GET /api/workspaces/:workspaceId/notifications` | Human-session inbox; `x-agent-key` is not currently accepted. |
| `POST /api/workspaces/:workspaceId/notifications/seen` | Human-session inbox state; `x-agent-key` is not currently accepted. |
| `GET /api/board/:boardId/events` | Bounded long poll for board activity. |
| `POST /api/workspaces/:workspaceId/knowledge-query` | Human-session knowledge search; `x-agent-key` is not currently accepted. |

The event endpoint accepts `since`, `wait`, and `limit`. Start once without `since`, then pass the returned cursor. If a wait expires with no events, reuse the same cursor. Treat events as a nudge to re-read task history, not as the canonical audit log.

## Dry-run header

For supported mutations, send:

```http
dry-run: true
```

The response reports approval tier, current state, and proposed state without writing. Claims, releases, and bulk updates do not support dry runs.

## Approval outcomes

A request can be applied immediately, held for a human, or blocked by policy. Direct HTTP clients must branch on the HTTP status and then inspect the returned state.

| Status | Direct HTTP meaning |
|---|---|
| `200` / `201` | Applied now. |
| `202` | One or more actions were recorded for human review. The body uses `code: \"HELD_FOR_REVIEW\"`. |
| `400` | Malformed or semantically invalid input. |
| `401` | Missing, invalid, or revoked credentials. |
| `403` | The role or approval policy refused the action. A policy block can include `code: \"BLOCKED_BY_POLICY\"`. |
| `404` | Missing resource or a resource outside the principal's workspace. |
| `409` | Claim, state, or idempotency conflict. |
| `413` | Request exceeded a bounded input. |
| `429` | Rate limited; retry only with bounded backoff and jitter. |
| `5xx` | Server failure; a transient failure may be retryable. |

Most REST errors contain only `{ \"error\": \"...\" }`; they do not promise a machine-readable `code`. The MCP adapter maps status codes to its own error names, so HTTP clients should not copy MCP code handling.

For a mixed `PATCH /api/tasks/:id`, a `202` is not an atomic rollback. Auto-tier fields such as title, priority, or dates can be applied immediately while move or assignment actions from the same request are held. Inspect the returned `task` (or re-read current state), and send consequential actions separately when atomicity matters.

`IDEMPOTENCY_IN_PROGRESS` is the exceptional retryable `409` body code: wait, then repeat the same request with the same idempotency key so the server can replay the result.

## Retry rules

- Safe reads can use bounded retries.
- A transport failure before any response is retryable, but the client may not know whether a mutation reached the server.
- Retry a create only with the same `Idempotency-Key`.
- Do not retry a claim conflict, policy denial, validation failure, or held proposal.
- Apply deadlines to every request. Long-poll deadlines must exceed the requested `wait` interval.

## Complete work-loop example

```sh
# Discover identity and board
curl -s "$BASE/api/agent/me" -H "x-agent-key: $KEY"

# Inspect
curl -s "$BASE/api/tasks/42" -H "x-agent-key: $KEY"
curl -s "$BASE/api/tasks/42/activity" -H "x-agent-key: $KEY"
curl -s "$BASE/api/tasks/42/dependencies" -H "x-agent-key: $KEY"

# Claim
curl -s -X POST "$BASE/api/tasks/42/claim" \
  -H "x-agent-key: $KEY" \
  -H "content-type: application/json" \
  -d '{"ttlMinutes":60}'

# Report
curl -s -X POST "$BASE/api/tasks/42/comments" \
  -H "x-agent-key: $KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: 6f93cdb8-7f05-48f1-b697-a68b0c508313" \
  -d '{"body":"Root cause identified; fix verified locally."}'

# Move to review and release
curl -s -X PATCH "$BASE/api/tasks/42" \
  -H "x-agent-key: $KEY" \
  -H "content-type: application/json" \
  -d '{"columnId":3,"position":0}'
curl -s -X DELETE "$BASE/api/tasks/42/claim" -H "x-agent-key: $KEY"
```

## GraphQL

A read-first GraphQL endpoint is available at `/api/graphql` and shares agent principals and authorization gates. Prefer REST when you need a mutation contract that maps directly to the MCP surface.

## Continue reading

- [Connect an agent](../connect/) — client configuration and verification.
- [MCP reference](../mcp/) — the complete named tool surface.
- [Agent workflows](../workflows/) — safe prompts and operating loops.
