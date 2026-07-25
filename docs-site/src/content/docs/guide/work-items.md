---
title: Work items
description: Tasks, subtasks, checklists, recurrence, custom fields, templates, and everything on a card.
sidebar:
  order: 1
---

Tasks are the unit of work. Every task lives in a column on a board, opens in a slide-over panel, and carries the metadata described on this page. Viewers can read everything here; changing anything requires the member role or above, and a few actions are called out below as admin-only.

## Creating tasks

Create a task from the `Add task` button at the bottom of any column, or open the command palette (<kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd>) and run `Create new task`, which adds to the first column. Only the title is required.

Every task has a type — `Task`, `Bug`, or `Story` — set in the panel's `Type` select. On cards, a bug shows a red bug icon and a story a blue book icon; plain tasks show no mark. Type is a first-class field, so bug tracking and user stories use the same card, panel, and history as everything else.

## The task panel

Clicking a card (or choosing `Edit` from its `⋯` menu) opens the task in a slide-over panel on the right, with the board still visible behind it. Content fields save when you press `Save changes`; the panel's sections below the fields (subtasks, checklist, attachments, comments, and so on) write immediately.

| Field | What it holds |
|---|---|
| `Title` | Required. The only mandatory field. |
| `Description` | Optional Markdown. Toggle between `Write` and `Preview` above the box — the preview renders the same safe subset comments use (`**bold**`, `` `code` ``, `- lists`, links). |
| `Assignee` | One person **or one agent**. The select groups options under `People` and `Agents`; agent assignees show a bot icon on the card. |
| `Priority` | `Urgent`, `High`, `Medium`, `Low`, or `No priority` (the default). |
| `Start date` / `Due date` | The work's window, side by side. Either can stand alone. |
| `Type` | `Task`, `Bug`, or `Story`. |
| `Estimate` | Effort in points (whole number, 0 or more). Empty means unestimated; shows as a small chip on the card. |
| `Value` / `Risk` / `Score` | Value and risk are 0–10. The read-only `Score` is `value / (estimate × (1 + risk/10))`, previewed live as you type; the List view can rank by it. |
| `Milestone`, `Epic`, `Objective`, `Sprint` | Planning links — each picker appears only once the board has created at least one. See [planning views](/kanban/guide/planning-views/). |
| `Repeat` | `Does not repeat`, `Daily`, `Weekly`, or `Monthly`. See [recurring tasks](#recurring-tasks). |
| `Labels` | Any number of labels from the workspace vocabulary. |

For an existing task, the panel continues with Subtasks, Checklist, Dependencies, Attachments, Time, Custom fields, Development (linked branches/PRs), Comments, and History sections. Agents can read and write the same fields through the [HTTP API](/kanban/agents/http-api/).

## Subtasks

A subtask decomposes a task into smaller pieces. Each piece is a whole task — its own status, assignee, priority, dates, labels, and comments — but it never appears on the board; the only way to reach it is through its parent. Nesting is one level deep: a subtask cannot have subtasks of its own.

1. Open the parent task and find the **Subtasks** section.
2. Type in the `Add a subtask…` box and press <kbd>Enter</kbd> (or click `Add`). New pieces start in the board's first column.
3. Click a row to open that piece in the same panel. A back link with the parent's title appears at the top; click it to return without closing the panel.

Because a subtask is never on the board, its panel gains a `Status` select that a top-level task doesn't have. Changing it moves the piece immediately — no save step, exactly like dragging a card. Subtasks also hide the Milestone/Epic/Objective/Sprint and Repeat controls; a piece is planned and completed through its parent.

The parent's card shows a tree icon with the subtask count. Deleting a piece from the list takes two clicks — the trash button asks `Really?` before it commits.

## Checklists

A checklist is a lightweight tick-list inside a task — cheaper than subtasks when the pieces don't need their own assignee or status. In the **Checklist** section of the panel, type into `Add an item` and press <kbd>Enter</kbd>. Tick the checkbox to complete an item (it renders struck through), or use the `×` to remove it.

The card shows progress as a `done/total` badge (for example `2/5`); when every item is done the badge switches to the accent color.

## Recurring tasks

Set the panel's `Repeat` field to `Daily`, `Weekly`, or `Monthly` and the task becomes recurring, marked with a loop icon on its card.

Recurrence completes through the board's **done column**. When a recurring task is moved into it, the app spawns the next occurrence:

- The successor is a copy — title, description, priority, type, estimate, assignee, value/risk — created in the board's **first** column.
- Its start and due dates advance by the cadence (a weekly task that ran Mon–Fri recurs Mon–Fri the next week). A task with no dates just spawns a fresh copy.
- The recurrence rule *moves* to the successor. The completed task in the done column no longer recurs, so dragging it around later spawns nothing, and only one occurrence is ever live.

:::note
The done column is a per-board designation: open a column's `⋯` menu and choose `Set as done column` (admin-only, and choosing it again clears it). The done column gets a green accent and a check mark. A board with no done column can't complete a recurring task — the loop never fires.
:::

## Custom fields

Custom fields are board-scoped metadata definitions — extra columns every task on the board can answer. Click the `Fields` button in the board toolbar to open the **Custom fields** dialog:

1. Under `New field`, name the field and pick a type: `Text`, `Number`, `Date`, `Select`, or `Checkbox`.
2. For a `Select`, list its options comma-separated (e.g. `Low, Medium, High`).
3. Click `Add field`. Defining fields is member+; viewers see the list read-only.

Values are set per task in the panel's **Custom fields** section (it appears only when the board defines fields). On cards, each answered field renders as a small `name: value` chip — a checkbox reads `Yes`/`No` — and the List view adds one table column per field.

:::caution
Deleting a field deletes its values on every task, which is why the dialog's `Delete` asks `Really?` first. Custom-field edits are also outside the activity log by design — they don't appear in a task's History.
:::

## Task templates

Templates are saved task shapes — title, description, priority, and labels — shared across the workspace. Click `Templates` in the board toolbar to manage them: the form at the bottom creates a template, and each row's pencil/trash icons edit or delete one. Viewers can read the list but not change it.

To use one, open a `New task` dialog and pick from the `Start from a template` select at the top. Choosing a template pre-fills the form — it is a starting point, not a lock, so adjust anything before clicking `Create task`. `Blank task` resets nothing and is safe to leave selected.

## Bulk edit

Bulk edit lives in the **List** view (switch views with the toolbar's toggle). Members see a checkbox on every row plus a select-all box in the header; tick some rows and a bulk bar appears above the table showing `N selected` with:

- `Move to…` — send all selected tasks to a column.
- `Set priority…` — apply one priority to all.
- `Assign to…` — a person, an agent, or `Unassigned`.
- `Delete` — remove all selected tasks.
- `Clear` — drop the selection.

Each pick applies immediately. The server loops per-task mutations, so every task keeps its own permission check and its own history rows; if some fail, the bar reports `2 of 12 failed` with the first error. Filtering the view prunes the selection — hidden rows can never ride into a bulk action.

## Attachments

The panel's **Attachments** section lists a task's files with name and size. Click `Add file` to upload (one file at a time, up to 25 MB; empty files are refused). Each row links to a download that streams through the app — there is no public file URL — and the `×` removes the file. The card shows a paperclip with the attachment count.

## Priority on cards

Priority renders on cards as a colored dot before the title: gray for `Low`, blue for `Medium`, amber for `High`, red for `Urgent`. `No priority` renders nothing at all — most cards are untriaged, and a board of gray dots would say nothing. Hover the dot (or use a screen reader) for the label; the full word lives in the panel. The same dot appears on subtask rows and in the List view's Priority column.

## Labels

Labels are a workspace-scoped vocabulary: every board in the workspace shares one list, and tasks pick from it. Click `Labels` in the board toolbar to open the manager:

- `New label` names a label (32 characters max) and picks one of seven colors from the swatch row. Creating is member+.
- Deleting a label is **admin-only**, because it strips the label from every task wearing it.

The manager is deliberately the only place labels are minted — the task panel's `Labels` picker can only choose existing ones, which keeps the vocabulary a curated set instead of free text. On cards, labels render as colored chips under the title; a chip whose label was just deleted falls back to slate until the board refreshes.

## Due dates and overdue

Due dates show on the trailing edge of the card. Once the date is in the past, it renders red and bold, its tooltip reads `Overdue — was due …`, and an amber warning triangle appears next to the title (the same at-risk mark a task blocked by unfinished work gets). Dates are plain calendar dates — no times, no timezones.

## Activity history

Every existing task ends with a **History** feed: creations, moves between columns (named), field changes (priority reads as "raised"/"lowered"), label changes, comments, time entries, and agent actions, each attributed to the person or agent that did it. The feed refreshes as you comment, so the receipt below always matches the conversation above.

## Comments and @mentions

The **Comments** section is the task's conversation thread. The box accepts the same Markdown subset as descriptions — the placeholder spells it out — and <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> posts. Replies nest one level under a top-level comment via its `Reply` link. Authors can `Edit` their comments (marked `· edited`) and `Delete` them with a two-click `Really?` confirm. Agents post here too — an agent's report on a task lands in this thread.

**Mentions**: type `@` followed by a member's exact display name — `@Sean Wright` mentions Sean; a partial handle like `@seanw` mentions nobody. Mentions are parsed server-side on every write, so editing a comment to remove the `@` removes the mention. A mentioned member sees "mentioned you on …" in their notification bell.

**Resolve / reopen**: a comment that can be resolved shows a `Resolve` link; resolving marks it `· resolved`, dims its body, and swaps the link to `Reopen`. Use it to track which threads still need attention.

:::tip
Automation rules can post comments and @mention people for you — "when CI fails, notify the assignee" is a stock rule. See [automations](/kanban/guide/automations/).
:::
