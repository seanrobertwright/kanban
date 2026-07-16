# Kanban MCP server

Lets a coding agent (Claude Code, Codex, Cursor — anything that speaks MCP) work
this board: read it, and add / edit tasks. It is PRD §7.1's "Door 2" — a thin
adapter over the same REST API the web UI uses, so an agent is subject to the
exact RBAC and audit trail a human is. Every action the agent takes shows in a
task's history under the agent's own name.

## Tools

| Tool | What it does |
|---|---|
| `list_board` | Columns + top-level tasks (each with a `subtaskCount`). Source of column ids. |
| `get_task` | One task by id. |
| `create_task` | New task in a column. |
| `update_task` | Edit a task's fields (only what you pass changes). |
| `move_task` | Move a task to a column/position — how status changes. |
| `comment_on_task` | Post a comment under the agent's name. |
| `create_subtask` | Decompose a task into a piece (a whole task with its own status). |

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
- Deleting or archiving is deliberately **not** exposed — this cut is read + add +
  edit. Approval tiers, claiming, and native (hosted) agents are later M2 work.
