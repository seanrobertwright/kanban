---
title: Agent HTTP API
description: Drive the board from any program over plain HTTP with a workspace-scoped agent key.
---

The board is drivable by any AI agent — or any program — over plain HTTP: the
same board-mutation endpoints the web UI uses, reached with a workspace-scoped
key. An agent is a principal subject to the **same RBAC, claiming, and audit
trail a human is** — not a privileged back door. Every action shows in a task's
history under the agent's own name.

:::tip[Speak MCP instead?]
The [MCP server](/kanban/agents/mcp/) is a thin adapter over exactly these
endpoints for agents that speak MCP (Claude Code, Cursor, …). If your agent
speaks HTTP, use this API directly.
:::

## Authenticate

1. **Mint a key** (shown once — store it):

   ```sh
   npm run create-agent -- --workspace <slug|id> --name "My Bot" [--role member]
   ```

   `--role` defaults to `member`; a `viewer` agent can read and comment but not
   move or edit cards. The key looks like `kbn_<64 hex>`.

2. **Present it** on every request:

   ```
   x-agent-key: kbn_...
   ```

The key resolves to one agent in one workspace. An id belonging to another
workspace answers `404`, exactly as it would for a human non-member.

## Read the board

| Method & path | Returns |
|---|---|
| `GET /api/agent/me` | The agent's identity + its boards. |
| `GET /api/board/:id` | Columns and their top-level tasks. |
| `GET /api/tasks/:id` | One task: column, priority, due date, labels, assignee, claim. |
| `GET /api/tasks/:id/subtasks` | A task's decomposed pieces. |
| `GET /api/tasks/:id/activity` | The task's history, newest first. |
| `GET /api/tasks/:id/comments` | The task's comment thread. |
| `GET /api/workspaces/:id/labels` | Label vocabulary (id, name, color). |
| `GET /api/workspaces/:id/assignees` | People and agents a task can be assigned to. |

## Act on a task

| Method & path | Body | Effect |
|---|---|---|
| `POST /api/tasks` | `columnId`, `title`, `description?`, `priority?`, `dueDate?`, `assignee?`, `labelIds?`, `parentId?` | Create a task (or subtask). |
| `PATCH /api/tasks/:id` | any of the above fields | Edit — only sent fields change; `null` clears. |
| `PATCH /api/tasks/:id` | `columnId`, `position` | Move — this is how status changes. |
| `POST /api/tasks/:id/claim` | — | Take the exclusive working hold (`409` if held). |
| `DELETE /api/tasks/:id/claim` | — | Release the hold. |
| `POST /api/tasks/:id/comments` | `body` | Comment under the agent's name. |

Deleting is deliberately **not** exposed — an agent that wants a task gone
says so in a comment and lets a human decide.

## The work loop

```sh
KEY=kbn_...
BASE=http://localhost:3000

# Identity + boards
curl -s $BASE/api/agent/me -H "x-agent-key: $KEY"

# Claim, act, report, release
curl -s -X POST  $BASE/api/tasks/42/claim -H "x-agent-key: $KEY"
curl -s -X PATCH $BASE/api/tasks/42 -H "x-agent-key: $KEY" \
  -H "content-type: application/json" -d '{"priority":"high"}'
curl -s -X POST  $BASE/api/tasks/42/comments -H "x-agent-key: $KEY" \
  -H "content-type: application/json" -d '{"body":"Triaged: looks urgent."}'
curl -s -X PATCH $BASE/api/tasks/42 -H "x-agent-key: $KEY" \
  -H "content-type: application/json" -d '{"columnId":3,"position":0}'
curl -s -X DELETE $BASE/api/tasks/42/claim -H "x-agent-key: $KEY"
```

## Errors

Standard HTTP codes with a JSON `{ "error": "…" }` body: `400` malformed,
`401` bad key, `403` role too low, `404` not in your workspace, `409` claim
conflict.

There is also a read-first **GraphQL** endpoint at `/api/graphql` sharing the
same principals and gates.
