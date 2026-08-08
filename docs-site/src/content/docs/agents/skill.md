---
title: The Kanban skill
description: A drop-in skill that teaches a coding agent in any repository how to work your board — install it, connect it, and know what it will and will not do.
---

The repository ships a ready-made **agent skill** — a single `SKILL.md` file
you drop into any repository where a coding agent works (Claude Code reads
`.claude/skills/`; the format is plain Markdown with a name and trigger
description, so other skill-aware clients can consume it too). Once installed,
the agent knows how to find your board, act under its own identity, and stay
inside the approval gate — without you re-explaining the API in every session.

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

In the repository the agent works in:

```sh
mkdir -p .claude/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .claude/skills/kanban/SKILL.md
```

Or copy `skills/kanban/` from a checkout. The skill is self-contained — one
file, no scripts.

## Connect

The skill needs one of two connections (both described in
[Connect a coding agent](/kanban/agents/connect/)):

1. **Environment variables** — `KANBAN_URL` (the app's origin) and
   `KANBAN_AGENT_KEY`. Mint the key in the app under **Settings → Agents →
   Add an agent** (kind *external*, role `member` for a working agent or
   `viewer` for a read-and-comment one). The token is shown once.
2. **MCP** — point the target repo's `.mcp.json` at `mcp/server.mjs` in this
   repository with the same two values in its `env` block. Keep `.mcp.json`
   out of version control; it holds a live credential.

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
