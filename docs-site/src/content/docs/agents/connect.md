---
title: Connect a coding agent
description: Create an agent identity, configure Claude Code, Codex, Cursor, or another MCP client, and verify the connection safely.
---

Kanban’s MCP server is a local `stdio` process. Your coding client starts it, sends tool calls over standard input/output, and the server forwards authenticated requests to the Kanban HTTP API.

The adapter is intentionally thin. The agent still uses the application’s workspace scope, roles, claims, approval policy, and activity history.

:::tip[Skip the explaining]
The repository ships a drop-in [agent skill](/kanban/agents/skill/) — one `SKILL.md` copied into the target repo teaches the agent the connection order, the work loop, and the approval gate without a custom prompt.
:::

## Before you begin

You need:

- A running Kanban application.
- The repository cloned on the same machine as the coding client.
- Node.js and the repository dependencies installed.
- A workspace slug or id.
- Permission to create an agent identity in that workspace.

The examples assume the repository root is your current directory and the application is at `http://localhost:3000`.

## 1. Create the agent identity

Run the repository script:

```sh
npm run create-agent -- --workspace <slug-or-id> --name "My Coding Agent" --role member
```

Roles:

- `member` can read and perform allowed board mutations.
- `viewer` is appropriate for agents that should inspect and comment without moving or editing work.

The command prints a key beginning with `kbn_`. It is shown once.

:::caution[The key is a credential]
Do not paste it into prompts, screenshots, issue comments, or committed configuration. Store it in an environment variable or a secret manager. Create separate identities for separate agents so history remains attributable.
:::

Set the values in the shell that launches your coding client:

```sh
KANBAN_URL=http://localhost:3000
KANBAN_AGENT_KEY=kbn_...
```

`KANBAN_BOARD_ID` is optional. Set it when a workspace has multiple boards and you want omitted `boardId` arguments to resolve predictably.

## 2. Choose your client

### Claude Code

Claude Code supports local `stdio` servers through `claude mcp add`. From the repository root:

```sh
claude mcp add \
  --scope project \
  --transport stdio \
  --env KANBAN_URL=http://localhost:3000 \
  --env KANBAN_AGENT_KEY=kbn_... \
  kanban -- npm run mcp
```

Then verify the server:

```sh
claude mcp get kanban
claude mcp list
```

Inside Claude Code, `/mcp` shows connection state. A project-scoped server may require workspace approval the first time it is loaded.

See the official [Claude Code MCP reference](https://code.claude.com/docs/en/mcp) for scope, transport, approval, and troubleshooting details.

### Codex CLI or IDE extension

Codex stores MCP configuration in its shared `config.toml` and can add a local server from the CLI:

```sh
codex mcp add kanban \
  --env KANBAN_URL=http://localhost:3000 \
  --env KANBAN_AGENT_KEY=kbn_... \
  -- npm run mcp
```

Check it with:

```sh
codex mcp list
```

In the Codex terminal UI, `/mcp` shows active servers. The desktop app, CLI, and IDE extension share the same host configuration.

See the official [Codex MCP reference](https://developers.openai.com/codex/mcp/) for `config.toml`, timeouts, enablement, and tool approval modes.

### Cursor

Cursor reads project servers from `.cursor/mcp.json`. Keep the secret in the environment and use interpolation:

```json
{
  "mcpServers": {
    "kanban": {
      "type": "stdio",
      "command": "npm",
      "args": ["run", "mcp"],
      "env": {
        "KANBAN_URL": "${env:KANBAN_URL}",
        "KANBAN_AGENT_KEY": "${env:KANBAN_AGENT_KEY}"
      }
    }
  }
}
```

Open **Customize → MCP** to inspect or toggle the server. Cursor asks for approval before MCP tool calls by default; its Run Mode controls subsequent approvals.

See the official [Cursor MCP reference](https://cursor.com/docs/mcp.md) for configuration locations, environment interpolation, transports, and approval behavior.

### Another MCP client

Any client that supports local `stdio` servers can start the same process. Translate these fields into the client’s format:

```json
{
  "command": "npm",
  "args": ["run", "mcp"],
  "env": {
    "KANBAN_URL": "http://localhost:3000",
    "KANBAN_AGENT_KEY": "kbn_...",
    "KANBAN_BOARD_ID": "optional-board-id"
  }
}
```

Run the command from the repository root. If the client supports environment references, use them rather than placing the key directly in its configuration file.

## 3. Verify identity and scope

Ask the connected agent:

> Call `whoami`. Report your agent name, role, workspace, and every board you can access. Do not mutate anything.

A healthy response identifies one agent and one workspace, then lists accessible boards. Continue with:

> Call `list_boards`, choose the board named “Engineering,” then call `list_columns`. Report the board id and column ids. Do not change the board.

This confirms all of the important layers:

1. The client started the local process.
2. The process reached `KANBAN_URL`.
3. The key resolved to an active agent.
4. Workspace and board scope are correct.
5. MCP tool results can return to the client.

## 4. Run a safe first workflow

Use an existing non-critical task or create one manually in a sandbox board. Then ask:

> Read task 42 with `get_task`, inspect `task_history` and `list_dependencies`, then claim it. If the claim succeeds, add a comment that you are beginning investigation. Do not edit fields or move the task. Release the claim when finished.

Inspect the task in the web interface. You should see the claim and comment attributed to the agent identity.

## Recommended operating instructions

Add a short policy to the coding client’s project instructions:

```text
When working from Kanban:
1. Call whoami before the first board action in a session.
2. Read the task, history, dependencies, and git context before changing work.
3. Claim a task before starting and never retry a claim conflict.
4. Report material progress in task comments.
5. Treat HELD_FOR_REVIEW as recorded but not applied.
6. Release the claim when work is completed, paused, or abandoned.
7. Never expose the agent key in output or committed files.
```

These rules make the board useful to other actors instead of turning it into a delayed transcript.

## Troubleshooting

### The server does not start

Run the process directly from the repository root:

```sh
KANBAN_URL=http://localhost:3000 KANBAN_AGENT_KEY=kbn_... npm run mcp
```

The process is a `stdio` server, so it may wait silently for protocol input. Startup errors indicate missing dependencies, a wrong working directory, or an invalid runtime.

### `401` or “bad key”

- Confirm the full key reached the process without quotes or trailing whitespace.
- Confirm the key has not been revoked.
- Mint a new key instead of trying to recover one that was not stored.

### `403` or “role too low”

The connection works; the identity lacks permission for that operation. Use a less powerful tool or ask a workspace administrator to change the agent’s role. Do not route around the role with another integration.

### `404` for a board or task that exists

Resource ids are workspace-scoped. Confirm `whoami`, `list_boards`, and the board selected by `KANBAN_BOARD_ID`. A resource in another workspace is intentionally indistinguishable from a missing resource.

### `409` when claiming

Another agent holds the task. Do not retry in a loop. Read the task and history, choose different work, or leave a comment for the holder if coordination is needed.

### The client shows tools but calls fail

Tool discovery proves only that the local process started. Re-run `whoami` to separate client transport problems from application authentication or network problems.

### Windows cannot find `npm`

Use `npm.cmd` as the command in clients that do not resolve Windows command shims:

```json
{ "command": "npm.cmd", "args": ["run", "mcp"] }
```

## Next steps

- [MCP reference](../mcp/) — all tool groups, inputs, and policy behavior.
- [Agent workflows](../workflows/) — repeatable claim-to-release prompts.
- [Agent HTTP API](../http-api/) — use the same domain over plain HTTP.
