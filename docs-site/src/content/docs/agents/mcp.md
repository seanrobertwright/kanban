---
title: MCP reference
description: "The complete Kanban MCP surface: 56 tools, two resources, two prompts, policy behavior, and operating rules."
---

The Kanban MCP server lets Claude Code, Codex, Cursor, and other MCP clients work on the board through named tools. It is a local `stdio` adapter over the [Agent HTTP API](../http-api/), not a second application backend.

Start with [Connect an agent](../connect/) if the server is not configured yet.

## Runtime contract

```text
coding client ⇄ stdio MCP server ⇄ authenticated HTTP API ⇄ feature handlers ⇄ Postgres
```

Required environment:

| Variable | Purpose |
|---|---|
| `KANBAN_AGENT_KEY` | Workspace-scoped credential beginning with `kbn_`. |
| `KANBAN_URL` | Application origin; defaults to `http://localhost:3000`. |
| `KANBAN_BOARD_ID` | Optional default board when the workspace has more than one. |

Run the server from the repository root with `npm run mcp`.

## Discovery rules

- Call `whoami` first. It is the authoritative identity and workspace context.
- Use `list_boards` instead of assuming a board id.
- Most board-level tools accept an optional `boardId`. If omitted, the pinned board is used, then the workspace’s first board.
- Task, board, column, sprint, epic, milestone, label, and checklist ids are not interchangeable.
- A resource in another workspace returns not found rather than revealing its existence.

## Tool results and errors

Successful tool output includes JSON text and structured content. Failures are structured:

```json
{
  "error": {
    "code": "CONFLICT",
    "status": 409,
    "message": "Task is already claimed",
    "retryable": false
  }
}
```

Use `code`, `status`, and `retryable`; do not parse prose to decide recovery.

## Dry runs and approval policy

Most mutating tools accept `dryRun: true`. A dry run reports:

- the approval tier that would apply;
- the target’s current state;
- the proposed state;
- no database write.

Use it before a consequential or uncertain call. Claims, releases, and bulk updates do not advertise dry-run support because the underlying operations cannot provide it honestly.

A mutation can be:

- **applied now**;
- **held for human review**;
- **blocked by policy**.

`HELD_FOR_REVIEW` is a successful proposal, not an applied change. Do not retry through a broader tool.

## Orientation — 6 tools

| Tool | Inputs | Use |
|---|---|---|
| `whoami` | none | Agent identity, role, workspace, and accessible boards. |
| `list_boards` | none | Every board available to the current agent. |
| `list_board` | `boardId?` | Columns, top-level tasks, subtask counts, and board risk. Large response. |
| `list_columns` | `boardId?` | Column ids, names, order, and WIP limits without tasks. |
| `list_assignees` | none | People and agents available for assignment. |
| `list_labels` | none | Workspace label ids and names. |

## Find and inspect work — 6 tools

| Tool | Inputs | Use |
|---|---|---|
| `search_tasks` | `boardId?`, filters, `limit?`, `cursor?` | Paged task search; filters combine with AND. Prefer over reading a large board. |
| `get_task` | `id` | One task with fields, checklist progress, subtask count, and risk. |
| `task_history` | `id` | Authoritative activity log, newest first. |
| `list_subtasks` | `id` | Direct child tasks. |
| `list_comments` | `id` | Comment thread, oldest first. |
| `list_dependencies` | `id` | Blocked-by edges with FS/SS/FF type and signed lag. |

`search_tasks.assignee` is either `{ "type": "human" | "agent", "id": "..." }` or the string `"none"`. `labelIds` requires all supplied labels. Use the returned `nextCursor` until it becomes `null`.

## Create and change work — 19 tools

| Tool | Inputs | Use |
|---|---|---|
| `create_task` | `columnId`, `title`, optional task fields | Create a top-level task. |
| `update_task` | `id`, any supported fields | Broad patch; omitted fields stay unchanged and nullable fields can be cleared. |
| `assign_task` | `id`, `assignee` | Assign or unassign one person or agent. |
| `rename_task` | `id`, `title` | Change only the title. |
| `set_priority` | `id`, `priority` | Set `none`, `low`, `medium`, `high`, or `urgent`. |
| `set_labels` | `id`, `labelIds` | Replace the complete label set; `[]` clears it. |
| `set_due_date` | `id`, `dueDate` | Set a `YYYY-MM-DD` date or `null`. |
| `set_estimate` | `id`, `estimate` | Set integer effort points, including `0`, or clear with `null`. |
| `set_type` | `id`, `type` | Set `task`, `bug`, or `story`. |
| `score_task` | `id`, `value`, `risk` | Set nullable 0–10 prioritization inputs. |
| `aim_at_milestone` | `id`, `milestoneId` | Attach to or remove from a milestone. |
| `move_task` | `id`, `columnId`, `position` | Change status and order; position is zero-based. |
| `bulk_update_tasks` | up to 100 `ids` plus one patch | Apply move, assignee, priority, or due-date edits with per-task results. |
| `claim_task` | `id`, `ttlMinutes?` | Take or renew an exclusive, expiring working hold. |
| `release_task` | `id` | Drop the current agent’s claim; a missing own claim is a no-op. |
| `comment_on_task` | `id`, `body` | Post under the agent identity. |
| `create_subtask` | `parentId`, `columnId`, `title`, optional fields | Create a full task nested under a parent. |
| `flag_blocker` | `id`, `dependsOnId`, `type?`, `lagDays?` | Add or revise a dependency; cycles and self-links are refused. |
| `unflag_blocker` | `id`, `dependsOnId` | Remove a dependency edge. |

Task deletion and archiving are absent from the named MCP tool surface. The direct HTTP API does expose task deletion to member-role agent principals, so absence here is an MCP interface boundary rather than an authorization guarantee.

### Patch semantics

`update_task` supports title, description, priority, type, estimate, milestone, sprint, epic, value, risk, start date, due date, assignee, and labels. Only supplied fields change. Use the narrow tool when one expresses the intent; activity history then reads as an action rather than a generic patch.

### Claim semantics

- Claim before working.
- A claim conflict is not retryable; choose other work or coordinate with the holder.
- Claiming your own hold renews it.
- Set a bounded TTL appropriate to the session.
- Release even when stopping without completion.

## Checklists, custom fields, and time — 6 tools

| Tool | Inputs | Use |
|---|---|---|
| `get_checklist` | `id` | Checklist items and completion state. |
| `add_checklist_item` | `id`, `content` | Append a visible step or acceptance item. |
| `check_item` | `itemId`, `done?`, `content?` | Complete, reopen, or reword one item. |
| `list_custom_fields` | `boardId?` | Field definitions and options. |
| `set_custom_fields` | `id`, `values` | Replace every custom-field value on a task. Read first to preserve entries. |
| `get_time_entries` | `id` | Logged minutes, actor, date, and description. |

## Planning containers — 6 tools

| Tool | Inputs | Use |
|---|---|---|
| `list_milestones` | `boardId?` | Milestones with progress derived from board status. |
| `list_sprints` | `boardId?` | Sprint goals, windows, and planning/active/completed state. |
| `add_task_to_sprint` | `id`, `sprintId` | Attach or detach a task. |
| `list_epics` | `boardId?` | Epics, ownership, status, progress, and derived work window. |
| `assign_to_epic` | `id`, `epicId` | Attach or detach a task. |
| `set_epic` | `id?`, `boardId?`, fields | Create or edit an epic; typically consequential and review-held. |

Epic dates are derived from work inside the epic rather than written directly.

## Analytics, governance, and context — 13 tools

| Tool | Inputs | Use |
|---|---|---|
| `board_analytics` | `boardId?` | Lead/cycle time, throughput, cumulative flow, and workload. |
| `list_objectives` | `boardId?` | Objectives, key results, and derived progress. |
| `score_key_result` | `id`, `currentValue` | Record the measurement only; target and definition stay fixed. |
| `set_objective` | `id?`, `boardId?`, fields | Create or edit an objective; normally review-held. |
| `propose_schedule` | `boardId?` | Read-only dependency/capacity schedule proposal with reasons. |
| `score_risk` | `boardId?` | Deterministic overdue, blocked, and age signals. |
| `export_board` | `boardId?` | Full JSON export; large, so use only when necessary. |
| `list_attachments` | `id` | Attachment metadata, not file bytes. |
| `get_git_context` | `id` | Linked branches, commits, PRs, and CI status. |
| `get_notifications` | none | Registered, but currently requires a human browser session; agent keys receive `401`. |
| `mark_notifications_seen` | none | Registered, but currently requires a human browser session; agent keys receive `401`. |
| `wait_for_changes` | `boardId?`, `since?`, `timeoutSeconds?`, `limit?` | Bounded long poll; use as a nudge, then read authoritative state. |
| `knowledge_query` | `question` | Registered, but currently requires a human browser session; agent keys receive `401`. |

:::caution[Current agent-key limitation]
Do not include `get_notifications`, `mark_notifications_seen`, or `knowledge_query` in an external-agent loop yet. Their routes currently authenticate only a human session cookie even though the MCP server registers the tools. The remaining 53 tools use the agent-key path described on this page.
:::

### Prioritization and risk

Task priority and delivery risk are different:

- Priority is an explicit field.
- The optional prioritization score is derived from value, risk input, and estimate.
- Delivery risk is derived from observable board facts and does not authorize a mutation.

### Change cursor

On the first `wait_for_changes` call, omit `since` and store the returned cursor. Subsequent calls pass it back. If a wait expires empty, reuse the same cursor. When events arrive, read the task or board; concurrent activity can arrive out of cursor order, while `task_history` cannot skip.

## Resources

Clients that support MCP resources can attach current state without first spending a tool call:

| URI template | Content |
|---|---|
| `kanban://board/{boardId}` | One board with columns and tasks as JSON. |
| `kanban://task/{taskId}` | One task with its fields as JSON. |

Resources remain subject to the same key and workspace scope.

## Prompts

The server publishes two reusable prompts:

- `work_task(taskId)` — claim, read history/comments/checklist, perform work, report, move, and always release.
- `triage_board(boardId?)` — inspect analytics, unassigned and overdue work, dependencies, then recommend without mutating.

A client may expose prompts differently or not at all. The same operating patterns are written out in [Agent workflows](../workflows/).

## Recommended first session

```text
1. Call whoami and list_boards.
2. Use list_columns on the intended board.
3. Search for one open, unassigned task.
4. Read get_task, task_history, list_dependencies, and get_git_context.
5. Do not mutate until the user confirms this is the intended board and task.
```

## Security and operations

- Keep `KANBAN_AGENT_KEY` out of version control and model-visible prompts.
- Give each agent its own identity and least-privilege role.
- Pin `KANBAN_BOARD_ID` in multi-board workspaces when defaults would be ambiguous.
- The server writes protocol data to stdout and diagnostics to stderr; wrapping it with commands that print to stdout can break MCP framing.
- Stop and restart the local process after changing environment variables.

## Continue reading

- [Connect an agent](../connect/) — configuration for major coding clients.
- [Agent workflows](../workflows/) — concrete prompts and hand-off patterns.
- [HTTP API](../http-api/) — endpoint-level integration.
