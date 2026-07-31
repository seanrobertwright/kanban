# Kanban MCP server

Lets a coding agent (Claude Code, Codex, Cursor — anything that speaks MCP) work
this board: read it, and add / edit tasks. It is PRD §7.1's "Door 2" — a thin
adapter over the same REST API the web UI uses, so an agent is subject to the
exact RBAC and audit trail a human is. Every action the agent takes shows in a
task's history under the agent's own name.

> **Speak HTTP, not MCP?** This server is only a convenience wrapper. The same
> board is drivable directly over HTTP with an agent key — see the
> [Agent HTTP API reference](../docs/agent-api.md). The MCP tools below map
> one-to-one onto those endpoints.

## Tools

49 tools, grouped by what they are for. Each is one authenticated call to the
REST API the web UI uses.

### Orientation

| Tool | What it does |
|---|---|
| `whoami` | Your agent identity, workspace, and every board you can reach. Call this first. |
| `list_boards` | Every board in the workspace, with ids. |
| `list_board` | One board: columns + top-level tasks. Source of column ids. |
| `list_columns` | The columns alone, without their tasks — the cheap read. |
| `list_assignees` | Humans and agents a task can be assigned to. |
| `list_labels` | The workspace label vocabulary. |

### Finding work

| Tool | What it does |
|---|---|
| `search_tasks` | Text + filters over one board, paged by cursor. **Use this instead of reading a whole board.** |
| `get_task` | One task by id. |
| `task_history` | A task's activity log — every change, newest first, with who made it. |
| `list_subtasks` | A task's pieces. |
| `list_comments` | The discussion on a task. |
| `list_dependencies` | What a task is blocked by. |

### Changing work

| Tool | What it does |
|---|---|
| `create_task` | New task in a column. |
| `update_task` | Edit any subset of a task's fields. |
| `assign_task` `rename_task` `set_priority` `set_labels` `set_due_date` `set_estimate` `set_type` `score_task` `aim_at_milestone` | One field each — parity with the native runtime's tools. A narrow tool records a narrow intent in the history, where the same change through `update_task` is a patch a reader has to diff. |
| `move_task` | Move to a column/position — how status changes. |
| `bulk_update_tasks` | One edit across up to 100 tasks; per-task results. Deletion is not offered. |
| `claim_task` / `release_task` | The exclusive hold, now a **lease** — see Notes. |
| `comment_on_task` | Post under the agent's name. |
| `create_subtask` | Decompose a task into a piece. |
| `flag_blocker` / `unflag_blocker` | Add or remove a blocked-by edge. |

### Checklists, fields, time

| Tool | What it does |
|---|---|
| `get_checklist` `add_checklist_item` `check_item` | Steps and acceptance criteria on a task. |
| `list_custom_fields` `set_custom_fields` | Board-defined fields. `set_custom_fields` replaces the whole set — read first, send back what you want kept. |
| `get_time_entries` | Time logged against a task (read-only by design). |

### Planning containers

| Tool | What it does |
|---|---|
| `list_milestones` `list_sprints` `list_epics` | The board's planning containers. |
| `add_task_to_sprint` `assign_to_epic` | Put a task in one, or take it out with `null`. |
| `set_epic` | Create or edit an epic — name, status, owner. Held for review by default; an epic names a body of work. |

### Reading around the work

| Tool | What it does |
|---|---|
| `board_analytics` | Lead/cycle time, throughput, CFD, workload — what a standup report is made of. |
| `export_board` | The whole board as JSON. Large. |
| `list_attachments` | File metadata on a task (no bytes). |
| `get_git_context` | Branches, commits, PRs linked to a task, with CI status. |
| `get_notifications` / `mark_notifications_seen` | The agent's inbox. |
| `wait_for_changes` | Block until something changes on a board, instead of re-reading it on a timer. |
| `knowledge_query` | Ask the workspace's published docs a question. |

**`wait_for_changes` is how a long-running agent should idle.** Call it once with
no `since` to get a cursor and no history — a first call deliberately does not
replay the board's past. Pass that cursor back and the server holds the request
open (up to 25s) until activity lands, answering with what happened and a new
cursor; an empty answer means the wait elapsed, so poll again with the *same*
cursor. It is a nudge to go and read, not the record: ids are assigned before
commit, so a concurrent write can land out of cursor order and be missed. What
happened to a *task* is `task_history`, which cannot skip.

## Resources and prompts

Two resource templates, for clients that attach context without spending a tool
call: `kanban://board/{boardId}` and `kanban://task/{taskId}`.

Two prompts: **`work_task`** (the claim → history → act → comment → release
loop, which is the protocol the claim model assumes and the thing agents most
reliably get wrong) and **`triage_board`** (survey a board, propose what to take
next, change nothing).

## Setup

1. **Migrate** (creates the `agent` table):

   ```
   npm run db:migrate
   ```

2. **Create an agent** and copy the token it prints (shown once):

   ```
   npm run create-agent -- --workspace <slug> --name "Triage Bot" --role member
   ```

   `--workspace` takes the workspace slug (from the board URL) or its id. `--role`
   defaults to `member`; a `viewer` agent can read and comment but not move cards.

   That mints an **external** agent (Door 2 — this server). For a **native**
   agent (Door 1 — one the app hosts and drives), add
   `--kind native --model claude-opus-4-8 [--prompt ./prompt.md]`: it carries a
   model and prompt instead of a token, and assigning a task to it starts a run
   (no MCP config, no `KANBAN_AGENT_KEY`). Native runs need `ANTHROPIC_API_KEY`
   in the app's environment.

3. **Register the server** in your coding agent's MCP config, passing the token as
   `KANBAN_AGENT_KEY`. For Claude Code (`.mcp.json` or user config):

   ```json
   {
     "mcpServers": {
       "kanban": {
         "command": "node",
         "args": ["mcp/server.mjs"],
         "env": {
           "KANBAN_URL": "http://localhost:3000",
           "KANBAN_AGENT_KEY": "kbn_…",
           "KANBAN_BOARD_ID": "1"
         }
       }
     }
   }
   ```

   `KANBAN_URL` defaults to `http://localhost:3000`; point it at your deployment if
   the board is hosted. The app must be running for the tools to work.

### Environment

| Variable | Default | What it does |
|---|---|---|
| `KANBAN_AGENT_KEY` | — | **Required.** The agent token from `create-agent`. |
| `KANBAN_URL` | `http://localhost:3000` | Where the app is. |
| `KANBAN_BOARD_ID` | first board | Pins the board every `boardId`-taking tool defaults to. In a multi-board workspace, set it — otherwise the default is a guess, and the server warns on stderr that it made one. |
| `KANBAN_TIMEOUT_MS` | `15000` | Per-request deadline. |

## Notes

- The token's only copy is the create-agent output; the database stores just its
  hash. Lose it and mint a new agent.

- **Errors are structured**, not prose: every failure comes back as
  `{error: {code, status, message, retryable}}`. `code` is one of
  `INVALID_REQUEST`, `AUTH_INVALID`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
  `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `SERVER_ERROR`, plus the two the
  server itself names — `HELD_FOR_REVIEW` and `BLOCKED_BY_POLICY`. Branch on
  `retryable`: a 429 or a 5xx may come out differently next time, a 409 claim
  conflict never will.

- **Retries are automatic for reads only.** A GET is retried twice with jittered
  backoff; a mutation is never retried, because a POST that timed out may have
  been applied — the socket died, not the transaction.

- **Claiming** prevents two agents working the same task, and the hold is a
  **lease** (076): it carries an expiry (60 minutes by default, `ttlMinutes` to
  choose), re-claiming renews it, and an expired hold is claimable by anyone
  with the rank. That is what stops a crashed agent wedging a task forever.

- **The §7.4 approval gate applies to this door too — to every mutating tool,
  not only the task ones.** A change the gate rates changeset-tier answers
  `HELD_FOR_REVIEW` (HTTP 202): it was recorded as a proposal for a human to
  accept or reject, **not** applied. Do not retry it. A block-tier action answers
  `BLOCKED_BY_POLICY` (403). By default:

  | Tier | Tools |
  |---|---|
  | held (202) | `move_task` `assign_task` `create_task` `create_subtask` `promote_idea` |
  | blocked (403) | starting an agent run; reviewing a changeset; reverting an action — a person does those |
  | applied now | everything else, and each one is recorded as an agent action a human can see and undo |

  The workspace's admin can raise or lower any tool's tier per agent
  (`approval_policy`, 012), so treat the table as the default rather than a
  guarantee: branch on the response code, not on the tool name. See
  `src/features/agents/server/gate.ts` and `door2.ts`.

- Deleting or archiving is deliberately **not** exposed — this cut is read + add
  + edit + claim. `bulk_update_tasks` omits the REST endpoint's `delete` flag for
  the same reason.
