---
title: The Kanban skill
description: A drop-in skill for Claude Code, Codex CLI, Pi, and Gemini CLI that teaches a coding agent in any repository how to work your board.
---

The repository ships a ready-made **agent skill** — a single `SKILL.md` in the
cross-platform Agent Skills format (YAML frontmatter + Markdown). The same
file works unchanged in **Claude Code**, **OpenAI Codex CLI**, and **Pi**;
only the directory it lands in differs. **Gemini CLI** uses its extension
format instead, and a ready-made wrapper ships alongside. Once installed, the
agent knows how to find your board, act under its own identity, and stay
inside the approval gate — without you re-explaining the API in every
session.

The skill lives at
[`skills/kanban/SKILL.md`](https://github.com/seanrobertwright/kanban/tree/master/skills/kanban)
in the repository.

## What it teaches the agent

- **Connection discovery, in order** — use `mcp__kanban__*` tools when the MCP
  server is wired; fall back to the HTTP API when `KANBAN_URL` and
  `KANBAN_AGENT_KEY` are in the environment; otherwise stop and tell the user
  exactly what to set up rather than guessing.
- **Orientation habits** — `whoami` first; `search_tasks` with filters instead
  of reading whole boards; column *ids*, not names.
- **The work loop** — claim (a lease that expires, so a crashed agent cannot
  hold work forever), do the work, comment with commit/PR links, move or
  release.
- **The approval gate** — a `202 held for review` is a proposal, not an error:
  report it as "awaiting review", never retry it into a duplicate, and use
  `Dry-Run: true` to ask what a call *would* do before doing it.
- **Sharp edges** — `set_custom_fields` replaces the whole set; deletion is
  never offered to agents; time entries are read-only; `wait_for_changes`
  beats polling; what `401`/`403`/`409` mean here.
- **Credential hygiene** — the `kbn_…` key is never printed, committed, or
  pasted anywhere.

## Install

Run the block for your client from the repository the agent works in. The
skill is self-contained — one file, no scripts — so "install" is a copy.

### Claude Code

```sh
mkdir -p .claude/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .claude/skills/kanban/SKILL.md
```

### Codex CLI

Project-level (commit it with the repo):

```sh
mkdir -p .agents/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .agents/skills/kanban/SKILL.md
```

Or once for every project: the same file into `~/.codex/skills/kanban/`.

### Pi

Project-level:

```sh
mkdir -p .pi/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .pi/skills/kanban/SKILL.md
```

Or once for every project: the same file into `~/.pi/agent/skills/kanban/`.

### Gemini CLI

Gemini loads extensions rather than skills; the wrapper in
`skills/kanban/gemini/` carries the same instructions as always-on context.
From a checkout of the kanban repository:

```sh
gemini extensions install ./skills/kanban/gemini
```

## Connect

The skill needs one of two connections (both described in
[Connect a coding agent](/kanban/agents/connect/)):

1. **Environment variables** — `KANBAN_URL` (the app's origin) and
   `KANBAN_AGENT_KEY`. Mint the key in the app under **Settings → Agents →
   Add an agent** (kind *external*, role `member` for a working agent or
   `viewer` for a read-and-comment one). The token is shown once.
2. **MCP** — point the client's MCP config at `mcp/server.mjs` in this
   repository with the same two values in its `env` block: Claude Code uses
   `.mcp.json` in the target repo, Codex `[mcp_servers.kanban]` in
   `~/.codex/config.toml`, Gemini CLI `mcpServers` in `.gemini/settings.json`.
   Keep whichever file holds the key out of version control; it is a live
   credential.

Use a separate agent identity per repository or per agent, so a task's
history reads as who actually did the work.

## When it triggers

The skill's description makes it load whenever the user mentions the kanban
board, its tasks or tickets, sprints, or asks the agent to file, update, pick
up, or finish board work. Nothing else in the agent's behaviour changes: RBAC,
the approval policy, claims, and the audit trail apply to a skill-guided agent
exactly as they do to any other caller — the skill only removes the trial and
error.

:::tip[Pairs well with]
[Agent workflows](/kanban/agents/workflows/) shows the same loops from the
human side — what to expect in the task history when an agent follows this
skill, and how the review queue surfaces what it proposes.
:::
