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

| Tool | What it does |
|---|---|
| `list_board` | Columns + top-level tasks (each with a `subtaskCount`). Source of column ids. |
| `get_task` | One task by id. |
| `task_history` | A task's activity log — every change, newest first, with who made it. |
| `create_task` | New task in a column. |
| `update_task` | Edit a task's fields (only what you pass changes). |
| `move_task` | Move a task to a column/position — how status changes. |
| `claim_task` | Take an exclusive hold before working a task; refused if another agent holds it. |
| `release_task` | Drop your hold when you stop or finish. |
| `comment_on_task` | Post a comment under the agent's name. |
| `create_subtask` | Decompose a task into a piece (a whole task with its own status). |
| `flag_blocker` | Record that a task is blocked by another on the same board (a blocked-by edge); self-references and cycles are refused. |

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
           "KANBAN_AGENT_KEY": "kbn_…"
         }
       }
     }
   }
   ```

   `KANBAN_URL` defaults to `http://localhost:3000`; point it at your deployment if
   the board is hosted. The app must be running for the tools to work.

## Notes

- The token's only copy is the create-agent output; the database stores just its
  hash. Lose it and mint a new agent.
- **Claiming** prevents two agents working the same task: `claim_task` takes an
  exclusive hold, and a second agent's claim on a held task is refused. Claim
  when you start, release when you finish. A workspace admin can break a hold a
  crashed agent left stuck (from the board, once that UI lands).
- Deleting or archiving is deliberately **not** exposed — this cut is read + add +
  edit + claim. Approval tiers (the §7.4 gate — auto/changeset/block) and native
  (hosted) agents both landed in M2; see `src/features/agents/server/gate.ts`.
