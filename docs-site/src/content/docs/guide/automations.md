---
title: Automations and workflow
description: The rule engine, SLAs, forms routing, requests, workflow templates, and connectors.
sidebar:
  order: 4
---

One engine drives everything on this page. An automation rule is a board-scoped
recipe — **When** an event fires · **If** a condition tree holds · **Then** a
list of actions runs — and notification rules, SLAs, forms routing, scheduled
jobs, and incident workflows are all rule types or bundles on that same engine.
Every action a rule takes goes through the same repositories (and the same
permission checks) a human edit does, so an automation can never do anything a
member could not.

## The rule engine

Open **Automations** from the board toolbar. Board admins author rules; anyone
who can see the board can read the rules and their run log.

A rule has three parts:

1. **When** — one trigger event (or a schedule).
2. **If** — a condition tree evaluated against the task snapshot the event
   carries. An empty condition is always true.
3. **Then** — up to 20 actions, applied in order.

### Trigger events

| Event | Fires when |
|---|---|
| `task.created` | A task is created on the board. |
| `task.moved` | A task changes column. |
| `task.updated` | A task's fields change. |
| `task.assigned` | A task's assignee changes. |
| `task.prioritized` | A task's priority changes. |
| `task.scheduled` | A task's dates change. |
| `task.labeled` | A task's labels change. |
| `schedule.tick` | A timer — hourly, daily, or weekly (see [scheduled rules](#recurring-and-scheduled-rules)). |
| `external.trigger` | An external tool POSTs the board's trigger token (see [connectors](#external-connectors)). |
| `git.branch_linked`, `git.commit_linked` | A branch or commit is linked to the task. |
| `git.pr_opened`, `git.pr_merged`, `git.pr_closed` | A linked pull request changes state. |
| `git.ci_passed`, `git.ci_failed` | A CI run on a linked PR finishes. |

The `git.*` events carry the linked task's snapshot, so "when a PR merges, move
the task to Done" is an ordinary recipe.

### Conditions

A condition is either a leaf comparison — a snapshot field, an operator, a
value — or a boolean group: **all of** (AND), **any of** (OR), and **not**.
Groups nest, so you can compose arbitrary AND/OR/NOT logic (up to 10 levels
deep). Fields use dotted paths for nested values, e.g. `assignee.id`.

Operators: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `contains` (substring on a
string, membership on an array — so it matches a task's label set), `in`,
`isSet`, `isEmpty`. Every operator is total: a missing field is simply "not
set", never an error, so a rule can never crash the edit that triggered it.

### Actions

| Action | What it does |
|---|---|
| `move` | Moves the task to a column. |
| `assign` | Sets (or clears) the task's assignee. |
| `set_field` | Writes one scalar field: `priority`, `type`, `estimate`, `dueDate`, `startDate`, `milestoneId`, `sprintId`, `epicId`, `objectiveId`, `value`, or `risk`. |
| `add_label` | Adds a label to the task's set. |
| `comment` | Posts a comment on the task. |
| `notify` | Pings a target — the assignee, a named member, a Slack channel, a Teams channel, or an email address. |
| `create_task` | Spawns a new task, into a named column or the triggering task's. |
| `script` | Runs a sandboxed custom script (off by default — see [custom scripts](#custom-scripts)). |

The dialog's builder exposes all of these except `assign`, which is available
when authoring rules through the [HTTP API](/kanban/agents/http-api/) and is
used by workflow templates. Slack, Teams, and email notify targets deliver
through the connections described in
[Integrations](/kanban/guide/integrations/); the builder's "notify assignee"
covers the common case.

### Example recipes

- **When** `task.prioritized` · **If** `priority` eq `urgent` · **Then**
  `notify` assignee — "Urgent incident assigned to you".
- **When** `git.pr_merged` · **Then** `move` to Done.
- **When** `task.created` · **If** any of: `estimate` isEmpty, `dueDate`
  isEmpty · **Then** `comment` — "New item — needs triage and an estimate."

## Conditional branching

Besides the rule-level condition tree, each action can carry its own `onlyIf`
sub-condition. An action with `onlyIf` runs only when that condition also holds,
so one rule can do different things to different tasks — "**Then**: if priority
is urgent, notify the assignee; otherwise just add a label". Per-action branches
are part of the rule JSON (API and templates); the dialog builder edits the
rule-level tree.

## The run log

Every fire is logged. Expand a rule in the Automations dialog to see its runs,
each with a status:

- `matched` — conditions held and the actions were applied.
- `skipped` — the event fired but conditions did not hold.
- `error` — an action failed; the message is recorded.
- `capped` — the cascade limit stopped the rule.

:::note
Rules can trigger rules: a `move` action logs activity, which can fire another
rule. The engine carries a cascade depth and stops at 5, logging the run as
`capped` — and a `move` to the column the task is already in is dropped
outright, so "when moved, move to Done" cannot loop forever.
:::

## State transition rules

The **Workflow** section of the Automations dialog is a columns-by-columns
matrix of allowed moves. Enforcing is opt-in — off means any column can move to
any column. When on, ticking a box allows that from→to edge; a from-column with
no row configured stays unconstrained, and reorders within a column are never
gated.

The board's workflow can also attach a **guard** to an edge — a condition (the
same tree rules use) that the task must satisfy to cross it. Guards are
supported by the engine and editable through `PUT /api/board/[id]/workflow`;
the dialog's grid edits the allowed matrix.

A disallowed edge or a failed guard rejects the move with a **409 Conflict** —
for humans, agents, and automations alike, since they all move tasks through
the same repository.

## Recurring and scheduled rules

Pick "on a schedule" (`schedule.tick`) as a rule's trigger and choose an
interval: **hourly**, **daily**, or **weekly**. A scheduled rule has no
triggering event — when its `next_run_at` comes due, it *scans* the board,
applies its actions to every task its conditions match, and advances
`next_run_at` to the next slot from now (it catches up rather than replaying
missed ticks). Scheduled fires appear in the run log with the number of tasks
matched.

- **When** `schedule.tick` every daily · **If** `dueDate` isEmpty · **Then**
  `comment` — "This task still has no due date."

## Notification rules

"Who gets pinged on what" is just a rule with a `notify` action:

- **When** `task.assigned` · **Then** `notify` assignee.

The bell has no separate notification store — it derives from the activity log
and comment mentions. A `notify` targeting a person posts a comment that
@-mentions them, which surfaces as "mentioned you on…" in their bell. The
`assignee` target resolves to the task's current human assignee at fire time
(unassigned or agent-assigned tasks are a quiet no-op); Slack, Teams, and email
targets deliver externally instead.

## SLA management

SLA policies live in the Automations dialog (admin to edit, viewer to read). A
policy has:

- **applies when** — a condition selecting the tasks it times, e.g. `priority`
  eq `urgent`.
- **target** — minutes to resolution (`targetMins`).
- **action on breach** — engine actions to run when the timer expires, e.g.
  notify the assignee and post an escalation comment.

A background sweep starts a timer for every matching task without one (due
`targetMins` after it starts) and stamps a breach on every open timer past due,
running its escalation actions exactly once. Elapsed and remaining time are
derived from the timestamps, never stored; `GET /api/tasks/[id]/sla` returns a
task's live timers with `remainingMins` (negative once overdue) and `breached`.

## Forms intake and routing

**Forms** (on the board toolbar) define reusable intake: a name, ordered
questions (`text`, `textarea`, or `number`, each optionally required, up to
20), and a target column. Submitting a form creates a task — the first answer
becomes the title, and every answered question becomes a `**Label:** value`
line in the description. A closed form refuses submissions. Members create,
edit, and submit forms; viewers can read them.

**Routing** sends a submission to the right place by its answers. Each form
holds an ordered list of routes — a condition over the answers (keyed by
question label, numeric answers coerced so numeric operators work), and the
column, assignee, and labels to apply. The first matching route wins; no match
keeps the form's defaults. Routes speak the same predicate vocabulary rules
fire on:

- **If** `Severity` eq `high` · route to the **Escalations** column, assign the
  on-call lead, add the `incident` label.

## Request management

A **request** is a form submission wearing its intake identity: the created
task carries `request_meta` (source form + requester). The **Requests** dialog
on the toolbar is a queue over those tasks, grouped by status (their current
column), each showing the form it came through, who filed it, and its nearest
open SLA due time. Any board viewer can read the queue — the requests lens adds
no new object, so working a request is just working its task.

## Workflow templates

A workflow template bundles **columns + rules + SLA policies** and applies to a
board in one move from the Templates section of the Automations dialog. Three
built-in presets ship in code:

| Preset | What it sets up |
|---|---|
| **Kanban** | Backlog / To Do / In Progress / Done columns. |
| **Scrum** | Sprint columns plus a "Triage new tasks" comment rule on `task.created`. |
| **Incident** | Triage / Investigating / Mitigated / Resolved columns, a notify-on-urgent rule, and a 30-minute urgent SLA that notifies and comments on breach. |

Workspaces can also save their own templates (workspace admin to create or
delete; anyone can list). Applying a template (board admin) appends missing
columns by title — existing columns are left alone, so re-applying is safe —
then creates the rules and SLA policies through the ordinary repositories, so
everything an applied template makes is logged like a hand-made object.

## Incident workflows

There is no separate incident engine — the **Incident** preset *is* the native
incident process, and the `create_task` action is the "declare one" primitive:
a rule or template can spawn an incident task into a named column (or the
triggering task's) with a priority. Combine them:

- **When** `git.ci_failed` · **Then** `create_task` — "Investigate CI failure"
  in **Triage**, priority `urgent`.

## Custom scripts

The `script` action runs an admin-authored JavaScript function against a frozen
copy of the task and expects it to *return an array of effect descriptors* —
plain JSON like `[{ type: "comment", body: "escalated" }]`. The script has no
capabilities: no network, filesystem, database, or Node globals — `task` is the
only binding, with a hard 100 ms timeout. Every returned effect is re-validated
(scripts cannot emit `script`, so no recursion) and applied through the same
gated repositories as declared actions.

:::caution
Scripts are off by default. Set `AUTOMATION_SCRIPTS_ENABLED=true` on the server
to enable the action; authoring remains admin-only. The sandbox is a safety
rail for trusted admins, not a hard boundary for untrusted authors.
:::

## External connectors

The engine connects both ways, which makes the app callable from n8n, Make,
Zapier, Power Automate, or any script:

**Outbound — webhooks.** Workspace admins register webhook URLs (Webhooks
dialog) that receive a POST for every board event, optionally filtered to a
list of event names. Deliveries carry an `x-kanban-event` header and an
`x-kanban-signature-256: sha256=…` HMAC of the body, computed with the secret
shown once at creation, so receivers can verify authenticity. An SSRF gate
refuses targets on localhost, private ranges, and cloud metadata addresses.
The list shows each hook's last delivery status. See
[Integrations](/kanban/guide/integrations/) for Slack, Teams, and email
delivery targets.

**Inbound — trigger tokens.** The Automations dialog's "Inbound triggers"
section mints per-board tokens (admin only; the full fire URL is shown to copy
once, then masked). An external tool fires the board with
`POST /api/board/[id]/triggers/[token]` — no session, the token is the
credential. That raises the synthetic `external.trigger` event: every enabled
`external.trigger` rule scans the board and acts on the tasks its conditions
match, exactly like a schedule tick — only what wakes it differs. Revoking or
deleting a token disables it; a bad, revoked, or wrong-board token is a flat
404.

## Draft a rule in plain language

The Automations dialog starts with a draft box: describe a rule in constrained
natural language — "When a PR merges, move it to Done", "When CI fails,
comment: investigate" — and it is parsed into a real rule. Unrecognized intent
is refused rather than guessed, and a draft is always created **disabled**, so
you review the trigger, conditions, and actions in the builder before switching
it on. For richer drafting — schedules, dependency-aware plans, and workflow
proposals authored by agents — see [AI agents](/kanban/guide/ai-agents/).
