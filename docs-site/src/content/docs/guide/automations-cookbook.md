---
title: Automations cookbook
description: Copy-paste recipes for the rule engine — triage, escalation, routing, git, schedules, and cross-channel notifications.
sidebar:
  order: 4.5
---

Ready-made recipes for the rule engine. Each one names the **When · If · Then**
you'd build in the **Automations** dialog, and — where it helps — the exact rule
JSON you can `POST` through the [HTTP API](/kanban/agents/http-api/). For the
full vocabulary (every trigger, operator, and action), see
[Automations and workflow](/kanban/guide/automations/).

Every rule is board-scoped. Create one from the API with:

```http
POST /api/board/{boardId}/automations
Content-Type: application/json

{ "name": "...", "trigger": {...}, "conditions": {...}, "actions": [...] }
```

`conditions` is a tree — a leaf `{ "field", "op", "value" }`, or a group
`{ "all": [...] }` / `{ "any": [...] }` / `{ "not": {...} }`. An empty `{}`
always matches. Actions run in order, top to bottom.

## Triage every new task

Flag anything that arrives without an estimate or a due date so it can't slip
through unscoped.

- **When** a task is created · **If** *any of* estimate is empty, due date is
  empty · **Then** comment a triage reminder.

```json
{
  "name": "Triage new tasks",
  "trigger": { "event": "task.created" },
  "conditions": { "any": [
    { "field": "estimate", "op": "isEmpty" },
    { "field": "dueDate", "op": "isEmpty" }
  ] },
  "actions": [
    { "type": "comment", "body": "New item — needs an estimate and a due date before it's picked up." }
  ]
}
```

## Escalate urgent bugs the moment they land

Two actions in one rule: ping the assignee and pull the task into your triage
column.

- **When** a task is prioritized · **If** priority is `urgent` *and* type is
  `bug` · **Then** notify the assignee, then move to In Progress.

```json
{
  "name": "Escalate urgent bugs",
  "trigger": { "event": "task.prioritized" },
  "conditions": { "all": [
    { "field": "priority", "op": "eq", "value": "urgent" },
    { "field": "type", "op": "eq", "value": "bug" }
  ] },
  "actions": [
    { "type": "notify", "target": "assignee", "message": "Urgent bug — you're on point." },
    { "type": "move", "columnId": 2 }
  ]
}
```

`columnId` is the numeric id of the target column on this board.

## Auto-label by content or field

Tag work so a saved view or a downstream rule can find it. `add_label` takes a
label id from the workspace vocabulary (**Labels** on the board toolbar).

- **When** a task is created · **If** title contains `hotfix` · **Then** add the
  `incident` label and set priority to high.

```json
{
  "name": "Hotfixes are incidents",
  "trigger": { "event": "task.created" },
  "conditions": { "field": "title", "op": "contains", "value": "hotfix" },
  "actions": [
    { "type": "add_label", "labelId": 1540 },
    { "type": "set_field", "field": "priority", "value": "high" }
  ]
}
```

## Move tasks on git activity

The `git.*` events carry the linked task's snapshot, so shipping a PR can drive
the board with no human in the loop.

- **When** a linked PR merges · **Then** move the task to Done.

```json
{
  "name": "PR merged → Done",
  "trigger": { "event": "git.pr_merged" },
  "conditions": {},
  "actions": [ { "type": "move", "columnId": 3 } ]
}
```

A `move` to the column a task is already in is dropped, so this can't loop even
if the task was already in Done. Connect a repository first — see
[Git and DevOps](/kanban/guide/git-devops/).

## Declare an incident when CI breaks

`create_task` is the "spawn one" primitive. Point it at a triage column and set
a priority.

- **When** CI fails on a linked PR · **Then** create an urgent investigation
  task in Triage.

```json
{
  "name": "CI failure → incident",
  "trigger": { "event": "git.ci_failed" },
  "conditions": {},
  "actions": [
    { "type": "create_task", "title": "Investigate CI failure", "columnId": 1, "priority": "urgent" }
  ]
}
```

## Nudge stale work on a schedule

A `schedule.tick` rule has no triggering task — when it comes due it *scans* the
board and acts on every task its conditions match.

- **When** the daily tick fires · **If** the task is still missing a due date ·
  **Then** comment a nudge.

```json
{
  "name": "Daily: chase missing due dates",
  "trigger": { "event": "schedule.tick", "every": "daily" },
  "conditions": { "field": "dueDate", "op": "isEmpty" },
  "actions": [ { "type": "comment", "body": "This task still has no due date." } ]
}
```

Intervals are `hourly`, `daily`, or `weekly`. Scheduled fires show up in the run
log with the number of tasks matched.

## Notify the right channel

The `notify` action's **target** is where the message lands. The dialog's notify
row now has a target picker — pick **assignee**, **member**, **Slack channel**,
**Teams**, or **email** — and each kind carries a different reference:

| Target | JSON | Where it delivers |
|---|---|---|
| Assignee | `"assignee"` | An @-mention comment to the task's current human assignee. |
| Member | `{ "type": "human", "id": "<userId>" }` | An @-mention comment to that member. |
| Slack | `{ "type": "slack", "channelId": "C0123ABCD" }` | The workspace's connected Slack channel. |
| Teams | `{ "type": "teams", "connectionId": 7 }` | A connected Teams webhook (its integration id). |
| Email | `{ "type": "email", "to": "oncall@acme.com" }` | A one-off email via the workspace mailer. |

Slack and Teams connections are set up in the admin console; see
[Integrations](/kanban/guide/integrations/). A person target posts an
@-mention that surfaces in their bell; Slack, Teams, and email deliver
externally.

- **When** a task is labeled · **If** labels contain the `release-blocker` id ·
  **Then** post to the release Slack channel.

```json
{
  "name": "Release blockers → #releases",
  "trigger": { "event": "task.labeled" },
  "conditions": { "field": "labels", "op": "contains", "value": 1543 },
  "actions": [
    { "type": "notify",
      "target": { "type": "slack", "channelId": "C0123ABCD" },
      "message": "A release blocker was just tagged." }
  ]
}
```

## Do different things to different tasks

Give a single action its own `onlyIf` sub-condition and one rule can branch. The
rule-level `conditions` gate whether the rule runs at all; each action's
`onlyIf` gates that action alone.

- **When** a task is created · **Then** *if* priority is urgent, notify the
  assignee; *always* add the `triage` label.

```json
{
  "name": "Branch on priority",
  "trigger": { "event": "task.created" },
  "conditions": {},
  "actions": [
    { "type": "notify", "target": "assignee", "message": "Urgent — please look now.",
      "onlyIf": { "field": "priority", "op": "eq", "value": "urgent" } },
    { "type": "add_label", "labelId": 1544 }
  ]
}
```

Per-action `onlyIf` is authored through the API and workflow templates; the
dialog builder edits the rule-level tree.

## Fire the board from an outside tool

Mint an inbound token in the Automations dialog's **Inbound triggers** section,
then have n8n, Make, a cron job, or any script `POST` it:

```http
POST /api/board/{boardId}/triggers/{token}
```

No session — the token is the credential. That raises the synthetic
`external.trigger` event, and every enabled `external.trigger` rule scans the
board and acts on matching tasks, exactly like a schedule tick.

- **When** an external trigger fires · **If** the task is in review longer than
  it should be (your condition) · **Then** notify a channel or escalate.

```json
{
  "name": "Nightly sync escalation",
  "trigger": { "event": "external.trigger" },
  "conditions": { "field": "priority", "op": "gte", "value": "high" },
  "actions": [
    { "type": "notify", "target": { "type": "email", "to": "oncall@acme.com" },
      "message": "High-priority work still open at the nightly sync." }
  ]
}
```

## Where to go next

- Guard which column-to-column moves are even legal with a
  [workflow matrix](/kanban/guide/automations/#state-transition-rules).
- Time work against a target and escalate on breach with
  [SLA policies](/kanban/guide/automations/#sla-management).
- Bundle columns, rules, and SLAs into a one-click
  [workflow template](/kanban/guide/automations/#workflow-templates).
- Let an agent draft rules for you from plain language — see
  [AI agents](/kanban/guide/ai-agents/).
