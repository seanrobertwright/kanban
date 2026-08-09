---
title: The CLI
description: A noun-verb command line over the agent HTTP API, with an exit-code contract scripts and CI can branch on.
---

The `kanban` CLI is the fourth door into the board: a command line over the same REST API the web UI, [MCP server](../mcp/), and [HTTP API](../http-api/) use. It adds no privileges — every call passes the same workspace boundaries, roles, approval policy, and activity history as the other doors.

Use it from shell scripts, CI jobs, Archon `bash` nodes, or any agent runtime that speaks shell better than MCP.

## Install and authenticate

The CLI ships in the repository under `cli/` and registers a `kanban` bin:

```sh
# from the repository root
npm run cli -- me

# or link it onto your PATH
npm link && kanban me
```

Two credentials, two identities:

| Credential | Header | Acts as | Mint it |
|---|---|---|---|
| `KANBAN_AGENT_KEY` (`kbn_…`) | `x-agent-key` | A bot — history says the agent's name | `npm run create-agent`, or Settings → Agents |
| `KANBAN_USER_KEY` (`kbu_…`) | `x-user-key` | **You** — same boards, same role, your name in history | Settings → API keys |

```sh
export KANBAN_URL=http://localhost:3000
export KANBAN_USER_KEY=kbu_...   # or KANBAN_AGENT_KEY=kbn_...
kanban me
```

When both are set the personal key wins and a stderr note says so; passing both `--key` and `--user-key` is an error. `KANBAN_BOARD_ID` (or `--board`) pins the default board in a multi-board workspace.

Personal keys are shown once at mint, stored hashed, and revocable in the same settings panel. Minting requires a browser session — a leaked key cannot mint further keys.

## The exit-code contract

Output is JSON on stdout (pretty on a TTY, compact when piped; `--json` forces compact). The exit code is the contract:

| Code | Meaning |
|---|---|
| 0 | Applied, or read OK |
| 1 | Error — network, server, auth, validation, not found |
| 2 | Usage error; nothing was sent |
| 3 | **Held for review** — recorded as a proposal for a human; *not* applied |
| 4 | Denied by role or approval policy |
| 5 | Conflict — another actor holds the claim, or state refused the change |

Exit 3 is the one that breaks naive scripts: the request *succeeded as a proposal*. A script that treats non-zero as failure will wrongly retry or alarm on it; a script that treats stdout-present as success will wrongly report a held change as applied. Branch on the code:

```sh
kanban task move 42 --column 3
case $? in
  0) echo "moved" ;;
  3) echo "proposed — a human must accept" ;;
  5) echo "claimed elsewhere — picking other work" ;;
  *) echo "failed" >&2; exit 1 ;;
esac
```

## Command shape

Commands are noun-verb, mirroring the [MCP tool surface](../mcp/) — the MCP reference is the semantic reference for what each command does and which approval tier it runs under.

```sh
kanban me                                  # whoami: identity and reachable boards
kanban board columns                       # cheap read: where to put things
kanban task search --open --unassigned --limit 20
kanban task get 42
kanban task claim 42 --ttl 60
kanban checklist add 42 "verify the fix locally"
kanban task comment 42 "root cause found; fix verified"
kanban task move 42 --column 3
kanban task release 42
```

`kanban --help` lists all commands; `kanban <noun> <verb> --help` shows a command's flags. Highlights:

- **Mutations take `--dry-run`** — the server reports the approval tier the call would run under and the before/after state, writing nothing. Claims, releases, and bulk have no dry run.
- **Creates send an `Idempotency-Key` automatically**; pass `--idempotency-key` to label retries of the same logical request.
- **Nullable fields accept the literal `null`**: `kanban task due 42 null`.
- **`notify list`, `notify seen`, and `knowledge`** need a human credential — a personal key or a session; agent keys get 401 by design.

## The work loop, in shell

The same [operating spine](../workflows/) the MCP prompts teach, as a script:

```sh
#!/bin/sh
set -eu
TASK=$1

kanban task claim "$TASK" --ttl 60 || {
  [ $? -eq 5 ] && echo "held elsewhere; stopping" && exit 0
  exit 1
}

kanban task get "$TASK" --json
kanban task history "$TASK" --json

# ... do the work ...

kanban task comment "$TASK" "done: <what changed, exact checks run>"
kanban task move "$TASK" --column "$REVIEW_COLUMN" || [ $? -eq 3 ]
kanban task release "$TASK"
```

Note the `|| [ $? -eq 3 ]` on the move: a held proposal is a legitimate end state for the script, not a failure — the comment already told the human what to review.

## Continue reading

- [Connect an agent](../connect/) — minting agent identities and keys.
- [MCP reference](../mcp/) — the tool surface this CLI mirrors, tier by tier.
- [HTTP API](../http-api/) — the raw requests underneath.
- [Kanban + Archon](../archon/) — using the CLI inside Archon `bash` nodes.
