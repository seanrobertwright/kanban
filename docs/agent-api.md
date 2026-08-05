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
| `GET /api/board/:id/tasks/search` | **Search one board** — filters in the query string, paged. See below. |
| `GET /api/tasks/:id` | One task: column, priority, due date, labels, assignee, claim. |
| `GET /api/tasks/:id/subtasks` | A task's decomposed pieces. |
| `GET /api/tasks/:id/activity` | The task's history, newest first, with who acted. |
| `GET /api/board/:id/events` | **The change feed** — what happened on the board after a cursor, optionally held open until it does. See below. |
| `GET /api/tasks/:id/comments` | The task's comment thread. |
| `GET /api/workspaces/:id/labels` | The workspace's label vocabulary (id, name, color). |
| `GET /api/workspaces/:id/assignees` | Who a task can be assigned to — people and agents, **no email addresses**. |

Every task a read returns carries `claimedBy` **and `claimExpiresAt`**, so a live
hold and a lapsed one are told apart without a second question. When
`claimExpiresAt` is in the past, the hold is over and the task is yours to take —
do not skip it as claimed. A null expiry on a held task is a hold taken before
leases existed: held until released.

#### Retrying a create safely

Every create — `POST /api/tasks`, `/api/tasks/:id/comments`,
`/api/tasks/:id/checklist`, `/api/tasks/:id/dependencies` — accepts an optional
`Idempotency-Key` header (8–255 characters; a UUID is ideal). Send one and the
server does the work at most once per key: a repeat returns the first response
verbatim, with `Idempotent-Replay: true`. Without the header nothing changes.

That is what makes a create retryable at all. A POST whose answer you never saw
may well have been applied — the socket died, not the transaction — so without a
key the only safe move is to stop and look. Generate the key **once per logical
attempt**, not per retry; a fresh key per retry is a fresh request.

| Answer | Meaning |
|---|---|
| `409 CONFLICT_IDEMPOTENCY_KEY` | That key was already used for a *different* request. Reusing a key for new content is refused rather than silently dropped. |
| `409 IDEMPOTENCY_IN_PROGRESS` | Your own earlier attempt is still running. Back off and ask again — the next ask replays its answer. |
| `400 INVALID_IDEMPOTENCY_KEY` | The key is outside 8–255 characters. |

Keys are scoped to the caller, so two agents may pick the same one, and are
honoured for 24 hours. A 5xx or a crash is never remembered — the retry is the
whole point. A held-for-review 202 *is* remembered, so a retry cannot leave a
human two identical proposals to review.

#### Asking what a mutation would do

Send `Dry-Run: true` on a mutating request and the server answers what the call
would have done, having done none of it. This is the cheap way to find out which
side of the approval gate a call falls on, before spending a proposal a human has
to read:

```
curl -X PATCH http://localhost:3000/api/tasks/42 \
  -H "x-agent-key: $KANBAN_AGENT_KEY" -H "content-type: application/json" \
  -H "Dry-Run: true" -d '{"columnId":5,"position":0,"title":"Renamed"}'
```

```json
{
  "dryRun": true,
  "actions": [
    { "tool": "move_task", "tier": "changeset", "outcome": "would_hold",
      "taskId": 42, "before": {…}, "after": {…},
      "changed": ["columnId", "position"], "unprojected": [] },
    { "tool": "update_task", "tier": "auto", "outcome": "would_apply",
      "taskId": 42, "before": {…}, "after": {…},
      "changed": ["title"], "unprojected": [] }
  ]
}
```

| Field | Meaning |
|---|---|
| `outcome` | `would_apply` (auto tier), `would_hold` (recorded as a proposal), `would_block` (policy refuses it). A dry run answers for all three — including the blocked one, which the real call refuses without explaining. |
| `before` | The target's real current state, read with your own permissions. `null` for a create. |
| `after` | `before` with your fields applied. **Not a simulation** — what the server would compute (a settled position, a cascade) is not in it. `null` when the tool edits no field of the target. |
| `changed` | Keys of `after` that differ from `before`. |
| `unprojected` | Input fields that name no field of the target — a comment's `body`, for instance. How you tell "changes nothing" from "does something a field diff cannot show". |

One request may report several actions, in the order it would apply them.

`Dry-Run: false` is an ordinary request; any other value is `400
INVALID_DRY_RUN` rather than a guess. Validation and permissions are checked as
usual, so a malformed body is still a 400 and a column you cannot write to is
still a 403 — a dry run never answers `would_apply` for a call that would have
been refused.

**Not everything can be planned.** `POST`/`DELETE /api/tasks/:id/claim` and
`POST /api/tasks/bulk` answer `501 DRY_RUN_UNSUPPORTED`: a claim turns on a lease
read under a row lock at the moment of the write, and a bulk edit is a loop of
independent mutations with partial success. Neither has one before/after that
would still be true by the time you acted on it, and a confident wrong answer is
worse than a plain refusal. The same 501 is how an endpoint says it has no dry
run at all — and it says so *instead of* writing, never after.

Dry runs are for agent principals; a session cookie asking for one gets `403
DRY_RUN_AGENT_ONLY`. A dry run also spends no `Idempotency-Key`, so the real
create that follows still creates.

#### The change feed

`GET /api/board/:id/events` answers `{ events, cursor, hasMore }` — the activity
log for that board, oldest first, after the cursor you pass.

| Query | Meaning |
|---|---|
| *(none)* | **Start from now**: the current `cursor` and zero events. A first call never replays history. |
| `since=<cursor>` | Everything logged after that cursor. |
| `limit=<1..200>` | Page size, default 50. `hasMore` means come straight back rather than waiting. |
| `wait=<0..25>` | Hold the request open this many seconds, returning early the moment anything lands. Ignored without a `since` — there is nothing to wait on yet. |

The wait elapsing is a **200 with your own cursor echoed back**, not an error:
poll again with the same cursor. A malformed cursor is a 400, because guessing
at it would silently skip events. Cursors are strings (the ids are 64-bit) —
keep them as you got them.

**This is a nudge, not a ledger.** Ids are assigned when a row is inserted, not
when its transaction commits, so under concurrent writers an event can become
visible after one with a higher id and a poller past that point will not see it.
Use the feed to learn that a board moved, then read the thing that moved
(`GET /api/tasks/:id`, `/activity`). Anything that must not miss a row reads the
activity log directly.

Rate limited per principal — an agent key and the human who minted it have
separate budgets — sized for one poll a second. A 429 carries `Retry-After`.

#### Search

`GET /api/board/:id/tasks/search` is the read that lets you ask a question
instead of downloading a board. Every parameter is optional and they combine
(AND); with none, it is the whole board newest-first.

| Parameter | Meaning |
|---|---|
| `q` | Case-insensitive substring of title **or** description. `%` and `_` are literal. |
| `columnId` | On this column. |
| `assignee` | `none` (unassigned), `human:<id>`, or `agent:<id>`. |
| `priority` `type` | Exact match; an unknown value is a `400`, never a silent no-op. |
| `labelId` | Repeatable — a task must carry **all** of them. |
| `milestoneId` `sprintId` `epicId` | In this container. |
| `dueBefore` `dueAfter` | `YYYY-MM-DD`, strict; tasks with no due date match neither. |
| `includeSubtasks=true` | Subtasks are excluded by default. |
| `openOnly=true` | Outside the board's done column (no-op if it has none). |
| `limit` `cursor` | Page size (default 50, max 200) and the previous page's `nextCursor`. |

Returns `{tasks, nextCursor}`. Keep passing `nextCursor` back as `cursor` until
it is `null` — that is the last page, and a short page never needs a second
round trip to discover it. Pagination is keyset, not offset, so rows are neither
skipped nor repeated when someone edits the board mid-scan.

```
GET /api/board/1/tasks/search?q=auth&openOnly=true&assignee=none&limit=20
```

### Act on a task

| Method & path | Body | Effect |
|---|---|---|
| `POST /api/tasks` | `columnId`, `title`, `description?`, `priority?`, `dueDate?`, `assignee?`, `labelIds?`, `parentId?` | Create a task (or a subtask, with `parentId`). |
| `PATCH /api/tasks/:id` | any of `title`, `description`, `priority`, `dueDate`, `assignee`, `labelIds` | Edit a task. Only fields you send change; send `null` to clear `dueDate` or `assignee`. |
| `PATCH /api/tasks/:id` | `columnId`, `position` | Move a task — this is how status changes. `position` is 0-based in the destination column. |
| `POST /api/tasks/:id/claim` | `ttlMinutes?` | Take the exclusive working **lease**. A task another agent holds is refused (`409`) — unless that hold has expired, which anyone with the rank may take over. Your own re-claim renews it. `ttlMinutes` defaults to 60, max 1440. |
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

An agent that stays up between tasks idles on
`GET /api/board/:id/events?since=<cursor>&wait=25` rather than re-reading the
board on a timer: a board-sized read per tick is the most expensive thing a
long-running agent can do, and the feed costs one indexed range scan.

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
| `429` | Rate limited. This is the one status worth retrying after a backoff. |

Errors carry the server's own sentence in `error`, meant to be read by the agent
and acted on. A `409` claim conflict is **not** worth retrying — another agent
holds the task; pick a different one.

### The approval gate applies here

Two responses come from the §7.4 gate rather than from RBAC, and both carry a
machine-readable `code`:

| Status | `code` | Means |
|---|---|---|
| `202` | `HELD_FOR_REVIEW` | Understood, **not applied**. The change was recorded as a changeset for a human to accept or reject; the body names `runId` and `changesetId`. Do not retry it — say so in a comment and carry on. |
| `403` | `BLOCKED_BY_POLICY` | This action requires explicit human approval for this agent and was not performed. |

Which actions land in which tier is the gate's call, not the caller's — see
`src/features/agents/server/gate.ts`. A `202` is a success in HTTP terms and a
"held" in yours; treating it as "applied" is the mistake to avoid.

You do not have to send the request to find out which of the two you would get:
`Dry-Run: true` (above) reports the tier without spending a proposal.
