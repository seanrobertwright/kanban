# Task List — Feature Build-out

A durable, checkable record of feature work: what has shipped (with the commit
that proves it) and what is queued next. Update it in the same commit as the
work — a task marked done here should always point at a real commit, and a task
added here is the next session's starting menu.

Companion docs: `SESSION_HANDOFF.md` (per-session narrative + gotchas),
`prd.md` (the milestone bet), `features.md` (breadth catalogue),
`../docs/task_management_feature_summary.md` (the 140-criterion scoreboard,
76 ✅ / 64 ❌ as of 2026-07-22 — the M4 agile cluster, the planning +
collaboration sweep, the Gantt + Goals/OKRs sweep, and Portfolio/Timesheets are
scored ✅; the 2026-07-22 rocks sweep closed the **Core Work Items** (14/14) and
**Planning & Views** (16/16) capability areas outright — Forms/intake,
Program/initiative hierarchy, Resource + Capacity planning, Budget (039–042)).

Convention: `[x]` done → cite the commit; `[ ]` open → one line on the slice.
Migrations are numbered in `src/shared/db/migrations/` and applied 001–042.

---

## Done — 2026-07-19 feature-breadth sweep

- [x] **Task type + estimate** (022) — task/bug/story enum, story points; card
      TypeMark + estimate chip. → `50fc0f8`
- [x] **Kanban WIP limits** (023) — per-column limit, "4/3" goes loud when over,
      never blocks. → `af84a4f`
- [x] **Bulk edit** — POST `/api/tasks/bulk` loops per-task mutations; list-view
      checkbox column + bulk bar. → `813cdfa`
- [x] **CSV/JSON export** — GET `/api/board/[id]/export`, RFC-4180, names not ids,
      subtasks included; Export dropdown. → `7824deb`
- [x] **@mentions + comment resolution** (024) — server-parsed `comment_mention`,
      bell "mentioned you on", resolve/reopen. → `cc54dd0`
- [x] **Flow insights** — `/api/board/[id]/analytics` replays activity_log
      (lead/cycle time, throughput, CFD) + workload; SVG charts. → `a79ec40`
- [x] **Outbound webhooks** (025) — HMAC-signed activity stream, queued
      post-commit from `logActivity`; admin/human-only management. → `d521a7c`
- [x] **Webhook SSRF gate** — refuse loopback/RFC1918/link-local/metadata
      literals; `WEBHOOK_ALLOW_PRIVATE_NETWORK=1` escape hatch. → `29b5319`
- [x] **Milestones** (026) — board-scoped, SET NULL on delete, progress vs done
      column; task picker + Milestones dialog + export column. → `ddff98f`
- [x] **Time tracking** (027) — `time_entry` minutes ledger, viewer-open logging,
      own-or-admin delete; Time section in the task dialog. → `feb486c`
- [x] **Feature-summary scoreboard** — all 140 rows marked ✅/❌; handoff
      regenerated; delete-snapshot sentinel updated (8 fields). → `f65918d`
- [x] **Durable task list** — this file. → `8212b65`

## Done — 2026-07-19 agile phase (M4 opened)

- [x] **Sprints** (028) — stateful lifecycle (planning → active → completed,
      one active per board via a partial unique index, Start/Complete with
      rollover of unfinished work to a planning sprint or the backlog).
      `task.sprint_id` SET NULL; progress in points; a planning surface whose
      capacity view counts agents beside humans (the PRD §4.3 payoff); picker
      in the task dialog; export sprint column; `sprint.*` activity actions.
      → `d1619fd`

---

## Next up — candidates, roughly by value

### Agile & Product (M4 — sprints + velocity + burndown + backlog landed)
- [x] **Velocity** — completed points per *completed* sprint, oldest first, in
      `BoardAnalytics.velocity`; reads the frozen done-scope (completion rolls
      unfinished work out, so what remains is what got done). Bar chart + a
      dashed average line in the Insights dialog. → `9c5f7e0`
- [x] **Burndown chart** — `BoardAnalytics.burndown`: remaining committed
      points at each day's end over the active sprint's window, replayed from
      `activity_log` (the CFD fold's shape — per-task sprint/column/estimate
      state, a running total nudged by each event's delta). Future days null so
      the actual line stops at today; ideal line committed→0. → `9c5f7e0`
- [x] **Backlog view** (029) — the `sprint_id IS NULL` queue as a fourth board
      lens: the backlog beside the board's planning/active sprints, drag a card
      into a sprint to schedule it (sets `sprint_id`, leaves the column alone).
      Completed sprints are not drop targets (frozen scope). `view_mode` CHECK
      widened to admit `backlog`; savable like any lens. → `fd8146f`
- [x] **Epics** (031) — a board-scoped grouping one level above the milestone.
      Tasks file directly (`task.epic_id`) and milestones file under
      (`milestone.epic_id`); epic progress rolls up direct + member-milestone tasks
      (counted once). Name-only (no due date); both FKs SET NULL, so CRUD is member.
      Epic dialog + task/milestone pickers + export column. → `54c75a0`

### M2 hardening (leftovers from the pre-sweep handoff — stay on the wedge)
- [x] **`flag_blocker` tool** — records a `task_dependency` blocked-by edge from an
      agent, in both doors (runtime `tools.ts` + `mcp/server.mjs`). Auto tier: the
      edge is idempotent, cycle-checked, same-board, silent, and reversible by
      removal, so it lands immediately via `addDependency` (018). → `e8b40e3`
- [x] **Durable run-queue drainer** (030) — `instrumentation.ts` `register()` starts
      a sweep that revives crashed `running` runs (stale heartbeat) and re-dispatches
      `queued` orphans past a grace window. `executeRun` now claims atomically, so
      re-dispatch from more than one caller runs the loop once. → `6a2b827`
- [x] **`agent_action.activity_id`** — the 013 column is now populated: `logActivity`
      returns the id into an `AsyncLocalStorage` sink, the gate stamps it on the
      auto tier, and changeset apply stamps it at accept time. → `2c3c440`
- [x] **Haiku in `cost.ts`** — §7.3's triage model now meters at $1/$5 per MTok
      (was falling back to the ~5x-dearer opus rate); shared `Price` type + tests.
      → `7774f39`
- [x] **Stale doc** — `mcp/README.md` now says approval tiers (§7.4 gate) and
      native agents landed in M2, pointing at `gate.ts`. → `7774f39`

### Agent tools for the new fields (let the wedge use what this sweep built)
- [x] **set_estimate / set_type / aim_at_milestone** in both doors — Door 1 gets
      three narrow tools (`tools.ts`), each auto tier in `DEFAULT_TIER` (field
      edits: internally reversible, silent, trigger nothing off-board); Door 2
      extends the coarse `update_task` schema with `type` / `estimate` /
      `milestoneId` (the PATCH route already accepts them). All ride `updateTask`,
      so the three-valued clears (estimate/milestone null) work as-is. → `26798e5`
- [ ] ~~**log_time** as an agent tool~~ — dropped by design. 027 and
      `time/server/handlers.ts` both state it: a time entry is a *human's* minute
      ledger, and an agent's spend is metered in dollars by the run's cost
      telemetry, not in minutes — and the write path only accepts a human session.
      Logging agent minutes would overturn that documented invariant, so the tool
      is intentionally not built.

## Done — 2026-07-20 planning + collaboration sweep

- [x] **Task start date + Timeline lens** (032) — `task.start_date` (DATE,
      three-valued like dueDate); TimelineView draws each dated task as a
      start→due bar over the tasks' own window, percentage-positioned (no per-day
      grid), with weekly ticks + a today marker; recurrence advances both dates.
      Both doors' create/update carry `startDate`; export column. → `80d1b65`
- [x] **Threaded comments + safe rich text** (033) — `comment.parent_id`
      (self-ref, CASCADE, depth-1 held in the repo like subtasks); replies nest
      client-side. `shared/ui/rich-text` renders a Markdown subset to React
      *elements*, never HTML — hostile input escapes by construction, link hrefs
      whitelisted, no dangerouslySetInnerHTML. Comment bodies render through it;
      a per-comment reply box. → `2f3fc0a`
- [x] **Prioritisation scoring** (034) — `value` + `risk` (0–10, CHECK-bounded)
      reuse `estimate` as effort; the score `value / (estimate × (1 + risk/10))`
      is derived in `taskColumns` (formula in code, no migration to change it).
      Dialog inputs + live readout; list-view Score column click-sorts; export;
      both doors + Door 1 `score_task` (auto tier, the triage payoff). → `90114d5`
- [x] **Custom fields** (035) — board-scoped definitions (`custom_field`: text /
      number / date / select / checkbox) + per-task values (`custom_field_value`,
      TEXT coerced by type). Manager dialog, self-fetching task-dialog section,
      dynamic export columns. Deliberate cuts (stated in code): no activity/undo
      wiring, values not on cards. → `68b4697`

## Done — 2026-07-21 planning + OKR sweep

- [x] **Gantt / critical path** (036) — a sixth lens: the Timeline's bars with
      the dependency graph (018) drawn on top. Blocked-by edges read board-wide
      onto BoardData; arrows drawn in measured px (a ResizeObserver) from the same
      fractions the % bars use, so they stay locked at any width. Critical path is
      classic CPM longest-weighted-path in a pure, cycle-guarded schedule.ts (12
      unit tests), shared with the refactored Timeline. → `52fcb19`
- [x] **Custom-field values on cards / list columns** (035 follow-up) — a
      customFields subquery in taskColumns (labels' twin), field defs on BoardData;
      a name:value chip per answered field on cards (checkbox → Yes/No), one column
      per field in the list. Still absent from TaskSnapshot — 035's undo cut holds.
      Manager dialog onChanged → refresh. → `c7c0cca`
- [x] **Custom-field activity/undo** (035 follow-up) — value edits log a
      `customField.valued` row each, a dedicated CustomFieldValueSnapshot family
      (not a widened TaskSnapshot) carrying the before/after string + field name.
      No-op guard skips an unchanged set. Field-definition delete stays out of the
      log — the larger cut 035 named. → `71bc4c1`
- [x] **Goals / OKRs** (037) — objectives + N key results (measurable
      start→target with clamped, decreasing-aware progress); tasks and milestones
      link via objective_id (epic's SET-NULL twin). Full stack + ObjectivesDialog,
      task/milestone objective pickers, export column, objective.* activity, board
      rollup. Agent tools deferred (PRD §7 guardrail). → `17ca057`

## Next up — candidates, roughly by value

### Collaboration breadth
- [x] **Rich text on task descriptions** — the task dialog's Description now
      has a Write/Preview toggle: Write is the raw textarea (placeholder names the
      Markdown), Preview mounts 033's `RichText` over the same string. No schema or
      write-path change — the stored value stays raw Markdown, and submit hands back
      the raw text (a test asserts Preview→Save does not mutate it), so escaping
      stays the renderer's job (React elements, never HTML). Toggle resets to Write
      on open. → `82cb2c1`

### Planning breadth
- [x] **Roadmap view** (038) — a seventh lens, the level above the task board:
      each epic (031) is a swimlane and the milestones (026) filed under it are
      dated markers on one shared time track, each with its own done/total fill.
      Pure `buildRoadmap` (lanes in board order, Unfiled last, window padded like
      the Timeline) with 7 unit tests; RoadmapView reuses schedule.ts's
      percentage-positioning + today line. No new data — only the view_mode CHECK
      widened (038 migration). Clicking a milestone opens the Milestones dialog
      (the roadmap reads; CRUD stays put). → `6e738f7`

### OKR follow-ups (037 cuts, if the wedge wants them)
- [ ] **Objective agent tools** — a `set_objective` / `score_key_result` in both
      doors so the wedge can move OKRs. Touches agent behaviour, so it goes through
      `AskUserQuestion` first (PRD §7/§12).
- [ ] **Key-result activity** — KR nudges are read live, not logged; a
      `keyResult.*` family would put "moved NPS 40 → 45" in the feed.

### Portfolio breadth
- [x] **Portfolio view + rollups** — a workspace-level glance at every board:
      a Portfolio dialog in the header (beside the switcher) listing each board's
      completion, milestones and overdue work, with the workspace totals across
      them (the "rollup"). Read-only — no migration, no activity; a pure
      `summarizePortfolio`/`donePercent` (6 unit tests), one workspace-scoped
      rollup query (correlated subqueries per board, top-level tasks, done keyed
      on each board's done column), viewer+. Rows link to the board where the
      work is done. Flips two scoreboard rows (Portfolio view + Portfolio
      rollups). → `d2fe742`

### Reporting breadth
- [x] **Timesheets** — the time_entry ledger (027) rolled up per contributor per
      day over a week, in a Timesheet dialog beside Insights. No migration —
      pure `buildTimesheetGrid` (rows by total desc, day totals, inclusive day
      list) with 9 unit tests, a board-scoped rollup query (join to board, group
      by user×day, viewer+), a clamped/defaulted window (week ending today, span
      ≤ 31d), and a week-navigating grid. Humans-only holds by construction —
      time_entry only records a human session. → `9e0ddfd`

### Custom-fields follow-ups (035 cuts, if the wedge wants them)
- [ ] **Custom-field values on the Gantt/Timeline** — answers show on cards and
      list columns now; the schedule lenses do not read them.

## Done — 2026-07-22 rocks sweep (finish Core Work Items + Planning & Views areas)

- [x] **Forms / intake** (039) — a board-scoped, reusable intake definition: a
      name, a target column, and an ordered list of questions
      (text/textarea/number, each optionally required). Submitting a form creates
      a task — the first answer is the title, every answered field compiles into a
      `**Label:** value` description (pure `compileSubmission`, 2 unit tests). A
      form rides `createTask` for submission (member gate, task.created logged), so
      it never opens a wider door; a closed form and a missing required answer are
      refused (`FormSubmitError` → 400). Target column is a SET NULL FK that falls
      back to the board's first column. Self-fetching FormsDialog (Timesheet's
      shape — not on BoardData) with a builder + a fill panel. Member manages +
      submits; CRUD stays out of the activity log (035's custom-field-def cut). 6
      DB tests + 2 pure. **Closes the Core Work Items area (14/14 ✅).** → `a4f8ca4`
- [x] **Program / initiative hierarchy** (040) — the workspace grouping above a
      board: `program` (workspace-scoped) + `board.program_id` SET NULL. A program
      gathers projects (boards) into an initiative and rolls their portfolio
      numbers up — the view is the portfolio grouped by initiative, so
      `PortfolioBoard` + `summarizePortfolio` are reused and the grouping is a pure
      `buildProgramsOverview` (programs by name, empty programs still shown,
      Unassigned last; 3 unit tests). Reads viewer+; create/rename/delete + filing
      a board are admin (structural, blast-radius rule) — delete SET-NULLs, never
      removing a board. Cross-workspace filing refused (not_found). ProgramsButton
      in the header beside Portfolio. No activity (workspace-level, portfolio's
      read-only precedent). 5 DB tests + 3 pure. → `27aad54`
- [x] **Resource + Capacity planning** (041) — one model, two capability rows.
      `member_capacity` (workspace-scoped: a member's `weekly_points` budget + a
      `role` label, keyed to the membership). A board Capacity dialog weighs each
      member's open assigned demand (sum of `estimate`, done-column work excluded —
      the same unit as the budget so they compare directly) against their budget:
      role + who-carries-what (resource planning) and demand-vs-capacity with
      over-allocation flagged (capacity planning). Pure `utilization` /
      `isOverAllocated` / `summarizeCapacity` (5 unit tests); reads viewer+, budget
      edits admin (upsert, member-guarded not_found). Humans-only by design —
      agents are metered in dollars, not points (the log_time cut's reasoning).
      Unassigned demand + a rollup footer. No activity (planning config). 3 DB
      tests + 5 pure. **Flips two scoreboard rows.** → `c1af7f3`
- [x] **Budget / financial planning** (042) — a project's money on the board:
      `board.budget_amount` (nullable, three-valued), `hourly_rate`, `currency`.
      Spend is derived, never stored — the time_entry ledger (027) rolled up ×
      the rate (priority_score's derive-don't-store rule), with a per-contributor
      breakdown, so the financial picture moves only as real work is logged and no
      per-task cost column was needed. Pure `costOf` / `remainingOf` /
      `budgetUtilization` (4 unit tests). Reads viewer+, budget/rate edits admin
      (three-valued clear). Budget dialog with spend/remaining figures, an
      over-budget flag, and a utilization bar. No activity (planning config). 2 DB
      tests + 4 pure. **Closes the Planning & Views area (16/16 ✅) — both rocks
      done.** → `a689bd6`

## Done — 2026-07-22 Agile & Product rocks sweep (finish the Agile & Product area)

- [x] **Product discovery + Feedback intake** (043) — one model, two capability
      rows. Two board-scoped tables: `idea` (a pre-task candidate moving through
      an exploring → validating → validated → promoted | archived pipeline, with
      the four RICE inputs) and `feedback` (a customer/stakeholder signal, votes,
      sentiment, optionally filed under the idea it argues for). RICE is derived
      in a pure `riceScore` (priority_score's derive-don't-store rule), the
      backlog ranked by stage then score in `buildDiscoveryOverview`; feedback
      demand (count + votes) rolls onto each idea. Promoting a validated idea
      rides `createTask` (member gate, task.created logged) with a compiled
      footer carrying its detail + demand, stamps `status='promoted'` +
      `promoted_task_id` in one txn, and refuses a second promotion
      (`PromoteError` → 400). Feedback SET-NULLs back to the inbox when its idea
      is deleted; idea_id filing is the three-valued forms shape and cross-board
      guarded. Reads viewer+, authoring/promote member. DiscoveryDialog
      (Timesheet's self-fetching shape) with an Ideas backlog + a Feedback inbox.
      No activity log (pre-commitment plumbing, forms' cut). 5 DB tests + 8 pure.
      **Flips two scoreboard rows.**

- [x] **Teams + Scaled Agile / SAFe** (044) — the layer this app was missing to
      express scaled agile end to end. Three of SAFe's four layers already
      existed (the workspace Portfolio view, the Program/ART grouping 040, the
      Board=project); 044 adds the Team layer (`team` workspace-scoped +
      `team_member` join + `board.team_id` SET NULL) and a pure `buildScaledAgile`
      that *composes* the whole cake — Portfolio(totals) → ART(program) →
      Team → Board — by reusing `summarizePortfolio` and mirroring
      `buildProgramsOverview`'s grouping, boards carrying their owning team. Reads
      viewer+; team create/rename/delete, roster, and board→team ownership are
      admin (workspace-structure, §7.4). Roster guarded to workspace members
      (capacity's guard); board→team same-workspace guarded (setBoardProgram's
      twin); team delete SET-NULLs boards. ScaledAgileButton in the header beside
      Programs/Portfolio, self-fetching, with per-board team pickers + roster
      management. No activity log (workspace-level, portfolio/programs precedent).
      3 DB tests + 3 pure. **Closes the Agile & Product area (14/14 ✅).**

## Rocks sweep — outcome

Both target capability areas are now fully native: **Core Work Items 14/14 ✅**
and **Planning & Views 16/16 ✅**. Scoreboard 76 ✅ / 64 ❌. Full suite 523
tests / 57 files green; tsc/eslint/build clean per feature.

> Anything touching **agent behaviour/budgets** or **export/product forks** should
> go through `AskUserQuestion` before building (per `prd.md` §7/§12).
