---
title: Archon workflow recipes
description: YAML patterns for Archon workflows whose prompt nodes report ownership, progress, and hand-off to the Kanban board.
sidebar:
  badge:
    text: BETA
    variant: caution
---

:::caution[Beta integration]
These recipes are proposed patterns against the current Archon node schema (`prompt`, `bash`, `approval`, `loop`, `depends_on`). Archon is under active development — treat the YAML as illustrative and check it against `archon workflow list` and the workflow files shipped with your install.
:::

All recipes assume the setup in [Kanban + Archon](../archon/): a dedicated agent identity, project-scoped MCP configuration that worktrees inherit, and `KANBAN_URL` / `KANBAN_AGENT_KEY` in the launch environment.

The recurring shape is the same one described in [Agent workflows](../workflows/): claim before acting, keep material progress on the board, release on every exit path.

## Recipe 1: Task-driven fix

Drive a fix from a Kanban task id instead of a GitHub issue. The first node claims and orients; the last node reports and releases regardless of outcome.

```yaml
# .archon/workflows/kanban-task-fix.yaml
name: kanban-task-fix
description: Implement a Kanban task through to a reviewable branch.
inputs:
  - name: task_id
nodes:
  - id: claim-and-orient
    type: prompt
    prompt: |
      Work Kanban task {{task_id}}.
      Call whoami, then read the task, its history, dependencies,
      checklist, and git context. If it is blocked or held by another
      actor, stop and report why instead of proceeding.
      Otherwise claim it, and mirror the implementation plan as
      checklist items on the task.

  - id: implement
    type: prompt
    depends_on: [claim-and-orient]
    prompt: |
      Implement Kanban task {{task_id}} in this worktree.
      Check off checklist items as they complete. Comment on the task
      when you hit a material finding or a blocker — the board should
      explain progress without this transcript.

  - id: validate
    type: bash
    depends_on: [implement]
    script: npm test

  - id: human-gate
    type: approval
    depends_on: [validate]

  - id: report-and-release
    type: prompt
    depends_on: [human-gate]
    prompt: |
      Comment on Kanban task {{task_id}} with the outcome: what changed,
      the exact checks that ran, and the branch name. If the work is
      verified, move the task to the board's review column. Treat any
      HELD_FOR_REVIEW result as pending, not applied, and say so.
      Finally, release the claim.
```

Failure path: if `validate` fails and the run aborts, the claim survives. Add a terminal cleanup node (or an Archon on-failure hook if your version provides one) whose prompt follows the [failure and hand-off protocol](../workflows/#failure-and-hand-off-protocol): comment with verified state, flag the blocker, leave the checklist accurate, release the claim, and do not move the task.

## Recipe 2: Checklist-driven loop

Archon's `loop` nodes repeat until a completion condition holds. Anchor the condition to the task's checklist so the board — not the session transcript — is the progress record.

```yaml
  - id: story-loop
    type: loop
    depends_on: [claim-and-orient]
    loop:
      until: ALL_TASKS_COMPLETE
      fresh_context: true
    prompt: |
      Call get_checklist for Kanban task {{task_id}} and select the
      first unchecked item. Implement only that item, verify it, then
      check it off with check_item and comment if anything material
      surfaced. If every item is checked, state that all tasks are
      complete and stop.
```

`fresh_context: true` gives each iteration a clean session, which is exactly why the checklist matters: it is the durable state that survives between iterations. Do not carry plan state in the prompt alone.

## Recipe 3: Surface the PR on the board

After Archon creates or updates a pull request, close the loop so a teammate can find it from the task.

```yaml
  - id: link-pr
    type: prompt
    depends_on: [create-pr]
    prompt: |
      Call get_git_context for Kanban task {{task_id}} to confirm the
      branch and pull request are linked. Comment on the task with the
      PR URL and a one-paragraph review guide: what to look at first,
      what is risky, and what was explicitly out of scope.
```

## Recipe 4: Bounded triage as a scheduled workflow

Archon can run a triage pass on a schedule. Reuse the bounded triage prompt from [Agent workflows](../workflows/#workflow-2-triage-an-incoming-backlog) verbatim inside a single `prompt` node — the bounds (at most 20 tasks, low-risk metadata only, no assignment or moves) are what make it safe to run unattended. Pair it with an `approval` node if your write policy does not already hold risky mutations.

## What not to encode

- **No done moves.** Workflow completion means ready for review. Acceptance is a human decision on the board or in the PR.
- **No board-state mirroring into Archon.** Query the board fresh at node start (`get_task`, `get_checklist`) instead of passing stale state between nodes as variables.
- **No retry-through-a-broader-tool.** A `HELD_FOR_REVIEW` or denied result inside one node must not be re-attempted by a later node with `update_task` or `bulk_update_tasks`. Report it and let the human decide.
- **No unbounded loops against the board.** If a loop polls for a human response, use `wait_for_changes` with a cursor and a bounded timeout rather than re-reading the board each iteration — see [waiting efficiently](../workflows/#workflow-7-wait-efficiently-for-changes).

## Continue reading

- [Kanban + Archon](../archon/) — setup, identity, and the two approval layers.
- [Agent workflows](../workflows/) — prompts and tool sequences the recipes build on.
- [MCP reference](../mcp/) — tool inputs and policy behavior.
