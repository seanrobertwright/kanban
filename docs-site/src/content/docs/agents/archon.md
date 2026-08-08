---
title: Kanban + Archon
description: Use the Kanban board as the shared record for Archon workflow runs, so orchestrated agent work stays visible, claimable, and reviewable.
sidebar:
  badge:
    text: BETA
    variant: caution
---

:::caution[Beta integration]
This guide targets the current [Archon](https://github.com/coleam00/Archon) workflow engine, which is evolving quickly. Node schemas, bundled workflow names, and CLI commands may change between Archon releases. Verify examples against your installed Archon version before relying on them.
:::

[Archon](https://github.com/coleam00/Archon) encodes development processes as deterministic YAML workflows: DAGs of `prompt`, `bash`, `approval`, and `loop` nodes that drive an AI coding assistant (Claude Code, Codex, or Pi) inside an isolated git worktree, ending in a branch or pull request.

Archon answers *how the work runs*. It does not answer *what the team can see*. A workflow run lives in Archon's own database; teammates and other agents cannot inspect its ownership, progress, or review state from there.

That is the gap Kanban fills. Pair them so that:

- **Archon executes** — worktree isolation, node sequencing, validation loops, human approval gates.
- **Kanban records** — who holds the work, what changed, what is blocked, and what still needs a human decision.

The standard [agent operating spine](../workflows/) applies unchanged inside an Archon run:

```text
orient → inspect → claim → act → report → release
```

## How the pieces connect

An Archon `prompt` node launches a normal assistant session in the run's worktree. Because a worktree shares the repository's checked-in files, any project-scoped MCP configuration travels with it. There is no Archon-specific transport: the assistant inside a workflow node reaches Kanban exactly the way it does in [Connect an agent](../connect/).

```text
Archon workflow run
  └─ prompt node → Claude Code session (in worktree)
       └─ kanban MCP server (stdio, npm run mcp)
            └─ Kanban HTTP API (authenticated as the agent identity)
```

Two requirements follow:

1. **The MCP server must be discoverable from the worktree.** A project-scoped configuration (for example `.mcp.json`, or `claude mcp add --scope project`) is checked in or resolvable relative to the repository root, so every worktree inherits it. User-scoped configuration also works, since the same user account runs the assistant.
2. **The agent key must reach the spawned session.** `KANBAN_AGENT_KEY` and `KANBAN_URL` must be present in the environment Archon uses to launch the assistant, or referenced from the MCP configuration itself. Never commit the key; keep it in the environment and interpolate it.

## One identity per orchestrator

Mint a dedicated agent identity (for example `Archon Runner`) rather than reusing a personal key. Task history, claims, and held proposals then attribute to the orchestrated pipeline, and a compromised or misbehaving pipeline can be revoked without touching other agents. See [Connect an agent](../connect/) for identity creation and key handling.

If you run several Archon workflows concurrently, one identity is still usually right: the *claim* distinguishes runs, because each run claims exactly one task.

## Concept mapping

| Archon concept | Kanban counterpart | Notes |
|---|---|---|
| Workflow run | A claimed task | Claim at run start, release at run end — success or failure. |
| Worktree branch / PR | Task git context | `get_git_context` links the board to the branch the run created. |
| `loop.until: ALL_TASKS_COMPLETE` | Task checklist | Mirror plan items as checklist items; check them as the loop progresses. |
| `approval` node | Review column + comment | The board shows *that* a human gate is open, even though the gate itself lives in Archon. |
| Node failure / abort | Blocker flag + hand-off comment | Follow the [failure and hand-off protocol](../workflows/#failure-and-hand-off-protocol). |

## Two approval layers, kept distinct

Both systems can hold work for a human, and they must not be conflated:

- **Archon `approval` nodes** gate *workflow progression*. The run pauses until a person responds in Archon.
- **Kanban write policy** gates *board mutations*. A mutating tool call can return `HELD_FOR_REVIEW`, meaning the board change is a proposal a person must accept.

A run can be approved in Archon while its board mutation is still held in Kanban, and vice versa. Prompt nodes should report each layer's state exactly and never retry a held Kanban action through a broader tool. See [approval-aware prompting](../workflows/#approval-aware-prompting).

## Setup checklist

1. Complete [Connect an agent](../connect/) for the assistant Archon drives (Claude Code, Codex, or another MCP client), using a dedicated identity.
2. Confirm the MCP configuration is project-scoped or user-scoped so worktrees inherit it.
3. Export `KANBAN_URL` and `KANBAN_AGENT_KEY` in the environment where `archon serve` (or the Archon CLI) launches assistants.
4. From a scratch worktree, run the assistant manually and call `whoami` to verify identity before wiring it into a workflow.
5. Start from a bundled workflow (for example `archon-fix-github-issue` or `archon-piv-loop`) and add board reporting with the recipes in [Archon workflow recipes](../archon-recipes/).

## Boundaries

- Archon's database remains the authority on *workflow execution state*; the board is the authority on *work ownership and review state*. Do not script one to overwrite the other.
- A run that ends without releasing its claim leaves the task stuck. Put claim release in a node that executes on both success and failure paths.
- Do not let a workflow move tasks to done. Completion of an Archon run means the work is *ready for review*, not accepted.

## Continue reading

- [Archon workflow recipes](../archon-recipes/) — YAML patterns that report to the board.
- [Agent workflows](../workflows/) — the operating spine and approval-aware prompting.
- [Connect an agent](../connect/) — identity, MCP configuration, and verification.
- [MCP reference](../mcp/) — all tools and policy behavior.
