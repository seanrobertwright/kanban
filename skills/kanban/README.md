# Kanban skill for coding agents

A drop-in [Claude Code skill](https://docs.claude.com/en/docs/claude-code)
that teaches an agent working in **your** repository how to drive your Kanban
board: connect with its own identity, find and file work, claim tasks, honor
the approval gate, and avoid the API's sharp edges.

## Install into a repository

Copy the folder into the repo the agent works in:

```sh
mkdir -p .claude/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .claude/skills/kanban/SKILL.md
```

(or copy `skills/kanban/` from a checkout of this repo — the skill is the one
`SKILL.md` file).

Then give the agent a connection, either:

- **Environment** — set `KANBAN_URL` and `KANBAN_AGENT_KEY` (minted in the app
  under **Settings → Agents → Add an agent**, kind *external*; the `kbn_…`
  token is shown once), or
- **MCP** — wire `mcp/server.mjs` from this repo into the target repo's
  `.mcp.json` (see the skill body for the exact block). Keep `.mcp.json`
  gitignored: it holds a live credential.

The skill triggers whenever the user mentions the board, its tasks, or asks
the agent to file/update/pick up work. Everything the agent does is
attributed to its own identity in each task's history, and consequential
actions are held for human review per your workspace's approval policy.

Docs: the **Agents** section of the docs site covers the same ground for
humans — connecting (`agents/connect`), the MCP tool reference
(`agents/mcp`), suggested workflows (`agents/workflows`), and the raw HTTP
API (`agents/http-api`).
