# Kanban skill for coding agents

A drop-in skill that teaches a coding agent working in **your** repository how
to drive your Kanban board: connect with its own identity, find and file
work, claim tasks, honor the approval gate, and avoid the API's sharp edges.

`SKILL.md` follows the cross-platform Agent Skills format (YAML frontmatter +
Markdown), so the **same file** works unchanged in Claude Code, OpenAI Codex
CLI, and Pi — only the install directory differs. Gemini CLI uses its
extension format instead; a ready-made wrapper sits in [`gemini/`](./gemini).

## Install

No shell commands — your agent installs its own skill. Open the coding agent
in the repository it works in and paste the prompt for your client.

**Claude Code** — paste this into your coding agent:

```text
Install the agent skill found at
https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md
into this repository at .claude/skills/kanban/SKILL.md, then confirm it loads.
```

**Codex CLI** — paste this into your coding agent (say
`~/.codex/skills/kanban/SKILL.md` instead to have it in every project):

```text
Install the agent skill found at
https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md
into this repository at .agents/skills/kanban/SKILL.md, then confirm it loads.
```

**Pi** — paste this into your coding agent (or `~/.pi/agent/skills/kanban/`
for every project):

```text
Install the agent skill found at
https://raw.githubusercontent.com/seanrobertwright/kanban/master/skills/kanban/SKILL.md
into this repository at .pi/skills/kanban/SKILL.md, then confirm it loads.
```

**Gemini CLI** — Gemini loads extensions rather than skills; the wrapper in
[`gemini/`](./gemini) carries the same instructions as always-on context
(`GEMINI.md`). Paste this into your coding agent:

```text
Install the Gemini CLI extension found in the skills/kanban/gemini folder of
https://github.com/seanrobertwright/kanban — clone the repository to a
temporary folder and run: gemini extensions install <clone>/skills/kanban/gemini
```

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
