# Kanban skill for coding agents

A drop-in skill that teaches a coding agent working in **your** repository how
to drive your Kanban board: connect with its own identity, find and file
work, claim tasks, honor the approval gate, and avoid the API's sharp edges.

`SKILL.md` follows the cross-platform Agent Skills format (YAML frontmatter +
Markdown), so the **same file** works unchanged in Claude Code, OpenAI Codex
CLI, and Pi — only the install directory differs. Gemini CLI uses its
extension format instead; a ready-made wrapper sits in [`gemini/`](./gemini).

## Install

Run the block for your client from the repository the agent works in.

**Claude Code**

```sh
mkdir -p .claude/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .claude/skills/kanban/SKILL.md
```

**Codex CLI** — project-level `.agents/skills/` (commit it with the repo), or
`~/.codex/skills/` for every project:

```sh
mkdir -p .agents/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .agents/skills/kanban/SKILL.md
```

**Pi** — project-level `.pi/skills/`, or `~/.pi/agent/skills/` for every
project:

```sh
mkdir -p .pi/skills/kanban
curl -fsSL https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md \
  -o .pi/skills/kanban/SKILL.md
```

**Gemini CLI** — install the extension (from a checkout of this repo):

```sh
gemini extensions install ./skills/kanban/gemini
```

The extension carries the same instructions as `SKILL.md`, loaded as
always-on context (`GEMINI.md`) rather than a triggered skill.

## Connect

The skill needs one of two connections, whichever client runs it:

- **Environment** — set `KANBAN_URL` and `KANBAN_AGENT_KEY`. Mint the key in
  the app under **Settings → Agents → Add an agent** (kind *external*, role
  `member` for a working agent, `viewer` for read-and-comment); the `kbn_…`
  token is shown once. The skill then drives the plain HTTP API — no other
  wiring needed, works in every client.
- **MCP** — wire `mcp/server.mjs` from this repo into the client's MCP config
  (Claude Code `.mcp.json` · Codex `~/.codex/config.toml` · Gemini
  `.gemini/settings.json`) with those same two values in its env. Keep any
  file holding the key out of version control.

Use one agent identity per repository or per agent, so a task's history reads
as who actually did the work. Everything the agent does is attributed, and
consequential actions are held for human review per your workspace's approval
policy.

Docs: the **Agents** section of the docs site — connecting
(`agents/connect`), this skill (`agents/skill`), the MCP tool reference
(`agents/mcp`), workflows (`agents/workflows`), and the raw HTTP API
(`agents/http-api`).
