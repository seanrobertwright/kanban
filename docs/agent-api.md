# Agent HTTP API

The board is drivable by any AI agent — or any program — over plain HTTP. This is
PRD §7.1's **Door 2**: the same board-mutation endpoints the web UI uses, reached
by an agent that authenticates with a workspace-scoped key. An agent is a
principal subject to the **same RBAC, claiming, and audit trail a human is** — not
a privileged back door. Every action it takes shows in a task's history under the
agent's own name.

> The [MCP server](../mcp/README.md) is a thin adapter over exactly these
> endpoints, for agents that speak MCP (Claude Code, Cursor, …). If your agent
> speaks HTTP, talk to this API directly — you don't need MCP.

## Authenticate

1. **Mint a key** (shown once — store it):

   ```
   npm run create-agent -- --workspace <slug|id> --name "My Bot" [--role member]
   ```

   `--role` defaults to `member`; a `viewer` agent can read and comment but not
   move or edit cards. The key looks like `kbn_<64 hex>`.

2. **Present it** on every request in the `x-agent-key` header:

   ```
   x-agent-key: kbn_...
   ```

The key resolves to one agent in one workspace. Every request is scoped to that
workspace — an id belonging to another workspace answers `404`, exactly as it
would for a human who isn't a member. There is nothing else to configure.

Base URL defaults to `http://localhost:3000`; point at your deployment if hosted.

## Start here

```
GET /api/agent/me
```

Returns the agent's identity and the boards it can reach:

```json
{ "id": "…", "name": "My Bot", "workspaceId": "…",
  "boards": [{ "id": 1, "name": "Board" }] }
```

Use a board `id` with `GET /api/board/:id` to read columns and tasks; column ids
come from there.

## Endpoints

All bodies are JSON (`content-type: application/json`). Ids are integers unless
noted. `assignee` is `{ "type": "human" | "agent", "id": "…" }` or `null` to
unassign.

### Read the board

| Method & path | Returns |
|---|---|
| `GET /api/agent/me` | The agent's identity + its boards. |
| `GET /api/board/:id` | Columns and their top-level tasks (each with `subtaskCount`). |
| `GET /api/tasks/:id` | One task: column, priority, due date, labels, assignee, claim. |
| `GET /api/tasks/:id/subtasks` | A task's decomposed pieces. |
| `GET /api/tasks/:id/activity` | The task's history, newest first, with who acted. |
| `GET /api/tasks/:id/comments` | The task's comment thread. |
| `GET /api/workspaces/:id/labels` | The workspace's label vocabulary (id, name, color). |
| `GET /api/workspaces/:id/assignees` | Who a task can be assigned to — people and agents, **no email addresses**. |

### Act on a task

| Method & path | Body | Effect |
|---|---|---|
| `POST /api/tasks` | `columnId`, `title`, `description?`, `priority?`, `dueDate?`, `assignee?`, `labelIds?`, `parentId?` | Create a task (or a subtask, with `parentId`). |
| `PATCH /api/tasks/:id` | any of `title`, `description`, `priority`, `dueDate`, `assignee`, `labelIds` | Edit a task. Only fields you send change; send `null` to clear `dueDate` or `assignee`. |
| `PATCH /api/tasks/:id` | `columnId`, `position` | Move a task — this is how status changes. `position` is 0-based in the destination column. |
| `POST /api/tasks/:id/claim` | — | Take the exclusive working hold. A task another agent holds is refused (`409`). |
| `DELETE /api/tasks/:id/claim` | — | Release your hold. Releasing an unheld task is a no-op. |
| `POST /api/tasks/:id/comments` | `body` | Post a comment under the agent's name — its channel for reporting. |

- `priority` is one of `none | low | medium | high | urgent`.
- `dueDate` is a calendar date, `YYYY-MM-DD`.
- `labelIds` is the **whole** label set for the task (send `[]` to clear); get ids
  from `GET /api/workspaces/:id/labels`.

### Not exposed

Deleting and archiving are deliberately **not** part of this cut — it is read +
add + edit + claim, matching the MCP door. (The web app has a delete path for
people; an agent that needs a task gone should say so in a comment and let a human
decide.)

## Work loop

A typical agent working a board:

1. `GET /api/agent/me` → pick a board.
2. `GET /api/board/:id` → find the task and the columns.
3. `POST /api/tasks/:id/claim` → take the hold so no one collides.
4. `GET /api/tasks/:id/activity` → see what already happened.
5. Act: `PATCH` priority/labels, `POST` a comment explaining why, `PATCH`
   `columnId`/`position` to move it.
6. `POST /api/tasks/:id/comments` → a short summary.
7. `DELETE /api/tasks/:id/claim` → release.

## Examples

```sh
KEY=kbn_...
BASE=http://localhost:3000

# Identity + boards
curl -s $BASE/api/agent/me -H "x-agent-key: $KEY"

# Read a board
curl -s $BASE/api/board/1 -H "x-agent-key: $KEY"

# Claim, prioritize, comment
curl -s -X POST $BASE/api/tasks/42/claim -H "x-agent-key: $KEY"
curl -s -X PATCH $BASE/api/tasks/42 -H "x-agent-key: $KEY" \
  -H "content-type: application/json" -d '{"priority":"high"}'
curl -s -X POST $BASE/api/tasks/42/comments -H "x-agent-key: $KEY" \
  -H "content-type: application/json" -d '{"body":"Triaged: looks urgent."}'

# Move to a column, then release
curl -s -X PATCH $BASE/api/tasks/42 -H "x-agent-key: $KEY" \
  -H "content-type: application/json" -d '{"columnId":3,"position":0}'
curl -s -X DELETE $BASE/api/tasks/42/claim -H "x-agent-key: $KEY"
```

## Errors

Standard HTTP status codes, with a JSON `{ "error": "…" }` body:

| Code | Means |
|---|---|
| `400` | Malformed request (bad JSON, missing/!invalid field). |
| `401` | No or unknown `x-agent-key`. |
| `403` | The agent's role is too low for this action (e.g. a `viewer` moving a card). |
| `404` | No such resource **in this agent's workspace** — the id space is not an oracle, so "doesn't exist" and "belongs to another workspace" answer the same. |
| `409` | A conflict with current state — most often a task already claimed by someone else. |

Errors carry the server's own sentence in `error`, meant to be read by the agent
and acted on (e.g. re-fetch and retry after a `409` claim).
