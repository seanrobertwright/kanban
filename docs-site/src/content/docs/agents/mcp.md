---
title: MCP server
description: Let Claude Code, Cursor, or any MCP client work the board as a teammate.
---

The MCP server lets a coding agent (Claude Code, Codex, Cursor — anything that
speaks MCP) work a board: read it, add and edit tasks, claim work, and report
back. It is a thin adapter over the [Agent HTTP API](/kanban/agents/http-api/) —
the tools map one-to-one onto those endpoints, so an MCP agent is subject to
the exact same RBAC and audit trail.

## Tools

| Tool | What it does |
|---|---|
| `list_board` | Columns + top-level tasks. Source of column ids. |
| `get_task` | One task by id. |
| `task_history` | A task's activity log, newest first. |
| `create_task` | New task in a column. |
| `update_task` | Edit fields (only what you pass changes). |
| `move_task` | Move to a column/position — how status changes. |
| `claim_task` | Take the exclusive hold before working a task. |
| `release_task` | Drop the hold when done. |
| `comment_on_task` | Post a comment under the agent's name. |
| `create_subtask` | Decompose a task into a piece. |
| `flag_blocker` | Record a blocked-by edge (cycles refused). |

## Setup

```sh
# 1. Migrate (creates the agent table)
npm run db:migrate

# 2. Mint an agent key (printed once)
npm run create-agent -- --workspace <slug|id> --name "My Bot"

# 3. Run the server
npm run mcp
```

Then register it with your MCP client. For Claude Code, a project
`.mcp.json`:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "npm",
      "args": ["run", "mcp"],
      "env": { "KANBAN_AGENT_KEY": "kbn_..." }
    }
  }
}
```

:::caution
The agent key is a credential. Keep `.mcp.json` out of version control
(the repo's `.gitignore` already excludes it).
:::

## Working style

The claim tools exist so several agents (and humans) can share a board without
collisions: **claim before you work, comment what you did, release when done.**
A task another agent holds refuses a second claim with a conflict, and every
move an agent makes is attributed to it in the task history.
