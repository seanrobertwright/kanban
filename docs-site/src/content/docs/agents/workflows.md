---
title: Agent workflows
description: Repeatable prompts and tool sequences for safe, visible work on a shared Kanban board.
---

Good agent work is not measured only by the final mutation. It is measured by whether another actor can understand ownership, context, progress, review state, and hand-off from the board.

The workflows below use the same operating spine:

```text
orient → inspect → claim → act → report → release
```

Use the smallest tool that states the intent. `set_priority` communicates more clearly in history than a broad `update_task` call that happens to change only priority.

## The standard work loop

| Phase | Tools | Invariant |
|---|---|---|
| Orient | `whoami`, `list_boards`, `list_columns` | Never guess workspace, board, or column ids. |
| Inspect | `get_task`, `task_history`, `list_dependencies`, `get_git_context` | Read current state before acting on remembered context. |
| Claim | `claim_task` | A conflict means choose other work; do not spin. |
| Act | Narrow mutation tools | Change only fields required by the task. |
| Report | `comment_on_task`, `check_item` | The board should explain progress without a private transcript. |
| Release | `release_task` | Release on completion, pause, or abandonment. |

:::caution[Transport success is not always application]
Mutating tools can be subject to approval policy. A `HELD_FOR_REVIEW` result means the proposal was recorded for a person to accept or reject. Do not describe it as applied, and do not retry it in a different form.
:::

## Workflow 1: Pick up and complete assigned work

Use this when the agent has been given a specific task id.

### Prompt

```text
Work task 42 from the Kanban board.

Before changing code or board state:
- call whoami;
- read the task, activity history, dependencies, checklist, and git context;
- stop and report if it is blocked or held by someone else;
- claim it before starting.

While working, keep checklist state and material progress visible in comments.
When the implementation is verified, comment with the result and exact checks,
move it to the board's review column, then release the claim.
Treat HELD_FOR_REVIEW as pending, not applied.
```

### Tool sequence

1. `whoami`
2. `get_task`
3. `task_history`
4. `list_dependencies`
5. `get_checklist`
6. `get_git_context`
7. `claim_task`
8. `add_checklist_item` or `check_item` as the plan changes
9. `comment_on_task` for material progress or a blocker
10. `move_task` only after the requested completion condition is met
11. `release_task`

### Human review boundary

The agent can prepare and report the implementation. A person still decides whether the code or operational result is accepted. Moving to review is not the same as moving to done unless the team’s board explicitly defines it that way.

## Workflow 2: Triage an incoming backlog

Use this for bounded intake work—not unrestricted backlog rewriting.

### Prompt

```text
Triage at most 20 open, unassigned tasks on the Product board.

First discover board, column, label, and assignee ids. Search only the backlog.
For each task, read its details and history. Recommend type, priority, labels,
and missing acceptance information. Apply only low-risk metadata changes that
policy allows. Do not assign people, change due dates, move tasks, or delete work.
Leave one concise comment on ambiguous items. Finish with a summary grouped by:
ready, needs product decision, duplicate candidate, and blocked.
```

### Tool sequence

1. `list_boards`, `list_columns`, `list_labels`, `list_assignees`
2. `search_tasks` with `columnId`, `openOnly`, `includeSubtasks: false`, and a bounded `limit`
3. `get_task` and `task_history` for each candidate
4. `set_type`, `set_priority`, or `set_labels` when evidence is clear
5. `comment_on_task` when information is missing

### Ownership boundary

Triage improves legibility. It should not silently commit the organization to an owner, deadline, milestone, epic, or objective. Those fields express decisions beyond classification.

## Workflow 3: Investigate delivery risk

Use the board’s derived signals instead of inventing a second scoring system.

### Prompt

```text
Prepare a delivery-risk review for the Engineering board.

Call score_risk and board_analytics. For each high-risk task, read the task,
dependencies, activity, assignee, and git context. Separate observed facts from
inferences. Do not reprioritize or reschedule work. Propose the smallest concrete
next action and name who needs to decide. Add comments only where the task history
does not already contain the finding.
```

### Tool sequence

1. `score_risk`
2. `board_analytics`
3. `get_task`, `list_dependencies`, `task_history`, `get_git_context`
4. `comment_on_task` for a new evidence-backed finding
5. `propose_schedule` only if the user explicitly asks for a dependency-aware schedule proposal

### Review boundary

Risk scores are derived from board facts such as overdue dates, blockers, and age. They focus attention; they do not authorize priority, assignment, or date changes.

## Workflow 4: Recover a failing pull request

Use this when a task already links to a branch or pull request with failing CI.

### Prompt

```text
Investigate the failing CI linked to task 73.

Read task 73, its history, dependencies, and git context. Claim the task only if
it is not already held. Inspect the linked CI evidence before editing code. Fix
the root cause in the repository, run the narrow relevant verification, and post
a task comment containing the failure, root cause, changed files, and exact check
result. Do not merge, close the task, or mark it done. Move it to review only when
CI and local verification are green, then release the claim.
```

### Tool sequence

1. `get_task`, `task_history`, `get_git_context`
2. `claim_task`
3. Repository tools outside Kanban for diagnosis and implementation
4. `comment_on_task` with evidence
5. `move_task` to the identified review column
6. `release_task`

### Ownership boundary

The agent owns diagnosis and a bounded fix. Repository merge authority and final acceptance remain with the configured review process.

## Workflow 5: Decompose a large task

Subtasks should create inspectable pieces, not duplicate the parent description.

### Prompt

```text
Decompose task 18 into independently verifiable subtasks.

Read the parent, history, checklist, and dependencies. Propose the decomposition
in a comment before creating anything. Each subtask must have a distinct outcome,
explicit acceptance condition, and no hidden dependency on a sibling. After the
proposal is accepted, create the subtasks in the backlog column, preserve relevant
labels, and flag only real dependency edges. Do not change the parent status.
```

### Tool sequence

1. `get_task`, `task_history`, `get_checklist`, `list_dependencies`
2. `comment_on_task` with the proposed decomposition
3. Wait for human acceptance when requested by policy or prompt
4. `create_subtask`
5. `flag_blocker` for genuine finish-to-start, start-to-start, or finish-to-finish relationships

### Review boundary

Decomposition changes how the team understands the work. Present it before creating a large subtask tree, and preserve the parent as the statement of outcome.

## Workflow 6: Board-aware stand-up

Use factual metrics and recent history; do not infer personal performance from card counts.

### Prompt

```text
Prepare today's stand-up for the Delivery board.

Use board_analytics for flow context and search open tasks updated since the last
stand-up. Read high-risk and blocked tasks. Summarize completed movement, active
work, blockers, and decisions needed. Attribute facts to task history. Do not rank
people, infer effort from task counts, change the board, or mark notifications seen.
```

Relevant tools: `board_analytics`, `score_risk`, `search_tasks`, `get_task`, `task_history`, and `list_dependencies`.

## Workflow 7: Wait efficiently for changes

`wait_for_changes` avoids repeatedly reading an entire board while nothing happens.

1. Call it once without `since` to receive a cursor.
2. Call it again with that cursor and a bounded timeout.
3. An empty response means wait again with the **same** cursor.
4. An event is a nudge to read the affected task or board; `task_history` remains the authoritative record.

Do not treat the change feed as a lossless event log. Concurrent writes can arrive out of cursor order.

## Approval-aware prompting

Prompts should distinguish four outcomes:

- **Applied** — the state changed now.
- **Held for review** — a proposal exists; a person must decide.
- **Denied** — policy or role refused the action.
- **Conflict** — another actor holds the work or current state makes the request invalid.

A robust instruction includes:

```text
After every mutation, inspect the returned status. Report held, denied, or
conflicting actions exactly. Never retry a held or denied action through a broader
tool, and never claim that a proposal changed board state.
```

## Failure and hand-off protocol

When the agent cannot finish:

1. Comment with the verified current state, not a guess.
2. Name the blocker and the actor or decision required.
3. Preserve useful partial artifacts in the repository or task attachments as appropriate.
4. Leave checklist state accurate.
5. Release the claim.
6. Do not move the task to done.

A useful hand-off lets the next actor resume from the board without reconstructing the private session.

## Continue reading

- [Connect an agent](../connect/) — client-specific setup and verification.
- [MCP reference](../mcp/) — all 56 tools and policy behavior.
- [HTTP API](../http-api/) — direct requests without MCP.
