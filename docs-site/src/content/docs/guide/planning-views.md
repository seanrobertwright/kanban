---
title: Planning and views
description: Eight lenses over one board, saved views, dependencies, capacity, portfolio, OKRs, and budgets.
sidebar:
  order: 2
---

Every board is one set of tasks seen through eight interchangeable lenses. The
lens switcher sits above the board area (see
[Using the app](/kanban/using-the-app/)): `Board`, `List`, `Calendar`,
`Timeline`, `Gantt`, `Backlog`, `Roadmap`, `Dashboard`. The command palette
(`⌘K`) offers the same jumps as `Go to Board`, `Go to List`, and so on, plus
`Open Milestones`, `Open Capacity`, `Open Budget`, and the other panels.

| Lens | Unit | Best for |
|---|---|---|
| `Board` | Card in a column | Flow of work through statuses; the only lens that drags |
| `List` | Table row | Sorting, scanning, and bulk edits |
| `Calendar` | Due date cell | Deadline load by month |
| `Timeline` | Start→due bar | Schedule shape without dependencies |
| `Gantt` | Bar + dependency arrows | Sequencing and the critical path |
| `Backlog` | Sprint bucket | Sprint planning by drag |
| `Roadmap` | Milestone marker per epic lane | The plan above the tasks |
| `Dashboard` | Stat tile / rollup | Health at a glance |

All eight read the same filtered task set: what the filter bar hides is hidden
everywhere.

## Filter bar

The filter bar sits left of the lens switcher and narrows every lens at once.
Filtering is client-side, so results update per keystroke.

- **`Search tasks`** — free-text match.
- **`Priority`** — a checkbox dropdown over the priority levels.
- **`Label`** — checkbox dropdown over the workspace's labels (only shown when
  labels exist).
- **`Assignee`** — checkbox dropdown listing `Unassigned`, every member, and
  every agent (agents carry a bot icon).

While any filter is active a `3 of 12` readout shows matched vs. total tasks,
and a `Clear` button resets everything.

:::note
Dragging is disabled on the Board lens while a filter is active — reordering a
subset would write positions against gaps the hidden cards still occupy. Clear
the filter to rearrange.
:::

## Saved views

A saved view is a named lens + filter pair, private to you within the
workspace.

1. Set the lens and filters you want.
2. Click `Save` (next to the `Views` button), type a name, press Enter.
3. Reapply it any time from the `Views` dropdown — each entry shows its name
   and lens, and clicking it sets both the lens and the filter.

Saving under an existing name overwrites that view; the trash icon on a row
deletes it. There is no sharing UI — every row in the menu is yours.

## Board

The default lens: columns of draggable cards.

- **Move a card** — drag it within a column to reorder, or into another column
  to change status. Positions persist on drop. Moving a recurring task into the
  board's done column spawns its next occurrence server-side.
- **Add a task** — `Add task` at the bottom of any column (member and up).
- **Add a column** — `Add column` at the right edge of the board; type a name,
  press Enter (member and up).

### Column menu

Each column header shows a task count (or `4/3`-style count against its WIP
limit) and a `⋯` options menu:

| Menu item | What it does | Role |
|---|---|---|
| `Rename` | Inline-edit the title; Enter commits, Escape abandons | member |
| `Set WIP limit` / `Change WIP limit` | Inline number editor; empty clears the limit | member |
| `Move left` / `Move right` | Reorder columns (buttons, not drag — keyboard-reachable) | member |
| `Set as done column` / `Unset done column` | Mark this column as the board's completion state | admin |
| `Delete column` | Delete — refused with a message while tasks remain in it | admin |

**WIP limits** are advisory, not blocking: when a column holds more tasks than
its limit the count turns red (`Over the WIP limit: 4 of 3`), and nothing stops
the drop. **The done column** (marked with a check icon) is what "done" means
everywhere else — dashboard percentages, milestone progress, capacity's "open
work", and recurring-task respawns all key off it.

## List

The board as a sortable table — the same rows, top-to-bottom in board order,
with each task's column shown as a `Status` cell. Columns: `Task`, `Status`,
`Assignee`, `Priority`, `Score` (click the header to cycle ranking by
prioritization score: off → highest-first → lowest-first), `Due`, `Labels`,
plus one column per custom field. Clicking a row opens the task dialog.

List is also the bulk-edit surface: tick rows (member and up) and a bar
appears with `Move to…`, `Set priority…`, `Assign to…` (people and agents),
`Delete`, and `Clear`. Each action applies immediately to every ticked task,
with per-task permission checks and history server-side. See
[Core work items](/kanban/guide/work-items/) for the task dialog itself.

## Calendar

A month grid keyed on due dates. Use the `‹` / `›` arrows to page months and
`Today` to jump back. Each dated task appears as a chip in its day's cell;
click it to open the task. Tasks with no due date are listed under
`No due date (N)` below the grid rather than dropped.

## Timeline

Every task with a start or due date becomes a horizontal bar: one row per
task, the bar running from its start date to its due date, with weekly date
ticks, gridlines, and a today line. A task with only one of the two dates
renders as a small fixed-width marker. The window is the tasks' own extent
(earliest start to latest end, padded two days each side). Tasks with neither
date are listed under `Unscheduled (N)` below. Click any bar to open the task;
set `Start date` and `Due date` in the task dialog to place it.

## Gantt

The Timeline's bars with the dependency graph drawn over them:

- **Arrows** — each blocked-by edge draws a finish-to-start elbow connector
  from the blocker's bar to the dependent's bar. Rows sort chronologically by
  start date so arrows tend to read top-down.
- **Critical path** — the longest chain of dependent work, weighted by each
  bar's duration in days, is highlighted: its bars fill with the primary color
  and its arrows draw heavier. A `Critical path` legend swatch appears in the
  header whenever one exists. That chain is the schedule's driving edge — slip
  any task on it and the end date slips.

Arrows only draw when both endpoints have bars on screen: a blocker that is
undated, filtered out, or a subtask has no row to point from.

## Backlog

The sprint-planning lens: a `Backlog` bucket (tasks with no sprint) beside a
column per planning or active sprint, each header showing task count and total
story points. Drag a card into a sprint to schedule it, or back into `Backlog`
to unschedule — this sets only the task's sprint, never its board column.
Cards sort by priority, then age. Completed sprints are not drop targets and
their tasks do not appear here; see [Agile & product](/kanban/guide/agile/)
for the sprint lifecycle and the `Sprints` dialog.

## Roadmap

The level above the task board: each epic is a swimlane, and the milestones
filed under it appear as flag markers positioned by due date on a shared time
track, each showing its `done/total` rollup as a fill. Milestones with no epic
gather in an `Unfiled` lane; undated milestones sit in the lane's label gutter.
Clicking any marker opens the Milestones dialog — the roadmap reads the plan;
editing stays where milestone CRUD lives.

## Dashboard

Board health derived live from the tasks on screen (the filter applies here
too):

- **Stat tiles** — `Tasks` (count across columns), `Completed` (percent in the
  done column; shows `—` / "no done column set" if none is designated),
  `Points` (total story points, with delivered points when a done column
  exists), `At Risk` (overdue or blocked count).
- **Column Rollup** — a bar per column with count and percent of all tasks.
- **At Risk · Needs Attention** — every unfinished task that is overdue
  (`OVERDUE`, with its due date) or waiting on unfinished blockers (`BLOCKED`,
  with how many). Click a row to open the task.

For lead/cycle time, throughput, cumulative flow, and the workload table, open
the `Insights` dialog instead — analytics is a glance-and-close panel, not a
ninth lens.

## Milestones

Named checkpoints the board's tasks aim at. Open with the `Milestones` toolbar
button (or `⌘K` → `Open Milestones`). The dialog lists each milestone with its
due date and a progress bar counting linked tasks in the board's done column.

To create one (member and up): type a name under `New milestone`, optionally
pick a due date, an epic to file it under, and an objective to aim it at, then
click `Add`. `Delete` (with a `Really?` confirm) un-aims tasks; it destroys
nothing. Link a task to a milestone from the `Milestone` picker in the task
dialog.

## Dependencies

A dependency is a blocked-by edge between two tasks on the same board.

1. Open a task and find the **`Blocked by`** section.
2. Pick a task from `Add a blocking task…` and click the `+` button. The list
   offers only same-board tasks that would not create a cycle; the server
   refuses anything else and its message is shown verbatim.
3. Remove an edge with the `×` beside it.

Cards show the consequence: a link icon with a count reads red as
"blocked by N" while any blocker is unfinished, and neutral as "depends on N"
once all blockers sit in the done column (a task's at-risk warning triangle
keys off the same state). The Gantt draws every edge as an arrow, and the
Dashboard's at-risk list tags blocked tasks.

## Capacity

Open with the `Capacity` toolbar button. The dialog weighs the board's open
work (story points on tasks outside the done column) against each member's
weekly point budget:

- Per member: role, `committed/budget pts`, utilization percent, an open-task
  count, and a utilization bar that turns red with an `over` flag when demand
  exceeds budget.
- An `Unassigned` row totals work nobody carries yet, and a footer rolls up
  committed vs. capacity points across members.

Anyone (viewer and up) sees the plan; admins edit each member's `Role` and
`pts/wk` budget inline and `Save`. This dialog is deliberately human-only —
agent spend is metered in money, not points. Agents do appear in the sprint
capacity breakdown (the `Sprints` dialog counts committed load per assignee,
agents beside humans) and in the workload table below.

## Workload

The `Insights` dialog includes a **`Workload — open tasks by assignee`** table:
open task counts per assignee, humans and agents alike, so distribution skew is
visible next to the flow metrics rather than in a separate lens.

## Portfolio

Workspace-wide rollup, opened with the `Portfolio` button in the sidebar tools.
Every board in the workspace appears as a card with `done/total · %` and a
progress bar (left empty when the board has no done column, rather than
implying 0%), its milestone count, and any overdue count in red. A footer
totals boards, tasks done, and overdue work across the workspace. Read-only —
each row links to its board.

## Programs

Initiatives one level above boards, opened with the `Programs` button in the
sidebar tools. Each program groups boards and rolls up their numbers
(`N boards · done/total done`, plus overdue); ungrouped boards sit under
`Unassigned`. Members read; admins manage:

- **Create** — type a name in `New initiative (e.g. Mobile)` and click
  `Add program`.
- **Rename / Delete** — per program; deleting un-groups its boards, it never
  removes one.
- **File a board** — each board row gets a program dropdown to move it between
  initiatives or back to `Unassigned`.

## Objectives (OKRs)

Open with the `Objectives` toolbar button. An objective is a qualitative
outcome; its key results are measurable targets, and the objective's progress
is the mean of its key results' progress. Each objective card shows its
progress bar, due date, and a `done/total tasks done` rollup of linked tasks
in the done column.

Member and up:

- **Add an objective** — name, optional description and due date, then
  `Add objective`.
- **Add a key result** — title plus `Start`, `Target`, and `Unit`, then
  `Add KR` (e.g. NPS 30 → 60).
- **Update progress** — edit a KR's current value and `Save`.
- **Link work** — pick the objective in a task's `Objective` dropdown, or aim
  a milestone at it from the Milestones dialog.

Deleting an objective un-aims its tasks and milestones and removes only its
own key results.

## Budget

Open with the `Budget` toolbar button. The dialog shows three figures —
`Budget`, `Spent`, `Remaining` — with a utilization bar that turns red and
flags `over budget` past 100%. Spend is not typed in: it is the board's logged
time (from the timesheet ledger) costed at the hourly rate, with a
per-contributor breakdown of hours and cost.

Everyone sees the figures; admins set the numbers in the editor at the bottom:
`Budget` (empty for none), `Rate /h`, and `Currency`, then `Save`.

:::tip
The planning surfaces compose: estimate tasks in points and Capacity, Backlog,
and Dashboard all sharpen; designate a done column and every progress
percentage — milestones, objectives, portfolio, programs — starts meaning
something.
:::
