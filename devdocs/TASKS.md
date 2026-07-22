# Task List — Feature Build-out

A durable, checkable record of feature work: what has shipped (with the commit
that proves it) and what is queued next. Update it in the same commit as the
work — a task marked done here should always point at a real commit, and a task
added here is the next session's starting menu.

Companion docs: `SESSION_HANDOFF.md` (per-session narrative + gotchas),
`prd.md` (the milestone bet), `features.md` (breadth catalogue),
`../docs/task_management_feature_summary.md` (the 140-criterion scoreboard,
79 ✅ / 61 ❌ as of 2026-07-22 — the M4 agile cluster, the planning +
collaboration sweep, the Gantt + Goals/OKRs sweep, and Portfolio/Timesheets are
scored ✅; the 2026-07-22 rocks sweep closed the **Core Work Items** (14/14),
**Planning & Views** (16/16), and **Agile & Product** (14/14) capability areas
outright — Forms/intake, Program/initiative hierarchy, Resource + Capacity
planning, Budget, Product discovery + Feedback intake, Teams + Scaled Agile
(039–044)).

Convention: `[x]` done → cite the commit; `[ ]` open → one line on the slice.
Migrations are numbered in `src/shared/db/migrations/` and applied 001–044.

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

## Phase 1 — Workflow & Automation engine (building, per devdocs/SPEC.md)

- [x] **Automation engine core** (045) — the Phase 1 spine, not itself a
      scoreboard row (it enables the twelve). A board-scoped
      trigger→conditions→actions rule engine welded to the existing activity tap:
      `logActivity` already fans every committed mutation to webhooks (025), so
      the engine is a *second subscriber* at that same post-commit seam
      (`queueAutomations` beside `queueDelivery`) — a rule fires on exactly the
      events a webhook sees, no second bus. `automation_rule` (trigger/conditions/
      actions JSONB, board-scoped, `created_by` the principal it acts as) +
      `automation_run` (every fire logged, `UNIQUE(rule_id, activity_id)` doubling
      as the idempotency key). The pure heart lives in `lib/engine.ts` —
      `evaluate(conditions, snapshot)` over an AND/OR/NOT predicate tree and
      `planActions(actions, snapshot)` (per-action `onlyIf` branch = 1.2 in data
      form; no-op self-move elided) — total by construction so a rule can never
      crash the mutation that triggered it. The runner re-reads the committed
      activity (the receipt), dispatches by (board, event), and applies effects
      **as the rule's author through the ordinary repositories** (moveTask,
      updateTask, createComment) — so an automation's blast radius is exactly its
      admin author's, no elevated door. Guards: idempotency (the UNIQUE claim) +
      an AsyncLocalStorage cascade depth cap (an action logs activity, which
      re-enters the runner — capped so A→B→A cannot recurse). Authoring admin
      (acts as the workspace, §7.4); reads viewer+. Agent authoring deferred
      behind `AskUserQuestion` (§7 — a rule an agent can write is agent surface).
      `GET/POST /api/board/[id]/automations`, `PATCH/DELETE /api/automations/[id]`,
      `GET /api/automations/[id]/runs`. 15 pure tests + 6 DB (incl. end-to-end
      fire + idempotency). No scoreboard flip yet — 1.1/1.2 add the builder UI
      that flips those rows.

- [x] **No-code automations + Conditional branching** (045, rocks 1.1 + 1.2) —
      the builder UI on the engine spine, and the two are one commit because 1.2
      *is* 1.0's evaluator surfaced: the `AutomationsDialog` (Forms-shaped,
      self-fetching) is a When·If·Then recipe builder — a trigger-event picker, an
      **If** block that composes an AND/OR predicate tree (combinator + per-field
      operator rows, the conditional-branching row in the flesh), a **Then**
      ordered action list (move / set field / add label / comment, each with the
      right picker), an enable/pause toggle, and a per-rule run-log reading
      `automation_run`. A saved rule reads back as a sentence ("When a task is
      moved, if all of…, then move to Done"). Authoring admin (`canDeleteColumns`,
      §7.4 — a rule acts as the workspace); reads viewer+. Mounted beside Forms in
      the board toolbar. tsc/eslint/build clean; the engine's 21 tests cover the
      evaluator the builder emits. **Flips two scoreboard rows** (81 ✅ / 51 ❌).

- [x] **State transition rules** (046, rock 1.3) — a Jira-style allowed-transition
      map on the board (`board.workflow JSONB`, nullable = today's any→any). A
      move that changes column now consults the map in `moveTask`: an unlisted
      edge is a 409 (`AuthzError('conflict')`, the move-to-another-board line's
      twin), and an edge carrying a guard evaluates it through the *automation
      engine's own evaluator* (a transition guard is a rule condition by another
      name) against the task snapshot — fail → 409. A from-column absent from the
      map is unconstrained, so naming one column's transitions doesn't silently
      lock the rest; reorders within a column are never gated. `get/setBoardWorkflow`
      (viewer read / admin write, every referenced column tenancy-checked),
      `GET/PUT /api/board/[id]/workflow`, and a columns×columns matrix editor in
      the Automations dialog (opt-in toggle; `move_task` — human or agent — inherits
      the guard automatically). 2 DB tests (refused edge, guard, clear). **Flips
      one scoreboard row** (82 ✅ / 50 ❌).

- [x] **Recurring automation rules** (047, rock 1.4) — scheduled rules that fire
      on a timer, not an event. A synthetic `schedule.tick` trigger with an
      interval (hourly/daily/weekly) + a `next_run_at` column; a due rule *scans*
      the board (a Task's fields ARE a snapshot for the evaluator) and applies its
      actions to every matching task, then advances `next_run_at` to the next slot
      **from now** (catch up, don't replay missed ticks). Reuses the durable
      run-queue drainer (030): the same sweep that recovers stranded agent runs
      calls `tickScheduledAutomations`, so no second worker is introduced. Runs
      recorded with a null `activity_id` (a timer, not an event — the NOT NULL was
      relaxed; the UNIQUE idempotency key still guards event runs, and
      `next_run_at` guards scheduled ones). Builder gains the "on a schedule"
      trigger + interval picker. 1 DB test (scans + acts on matches only, advances,
      no re-fire on the same tick). **Flips one scoreboard row** (83 ✅ / 49 ❌).

- [x] **Notification rules** (rock 1.5) — a `notify` action, "who gets pinged on
      what". The bell has no notification table — it derives from the activity log
      + comment mentions (016/024) — so a notify *posts a comment that @-mentions
      the target*, which surfaces as "mentioned you on" in their bell, no new
      storage. Target is `"assignee"` (resolved to the task's current human
      assignee from the event snapshot) or an explicit member; the whole feature
      is `When task.assigned If assignee=… Then notify`. Builder gains a "notify
      assignee" action with a message. 1 DB test (a move fires the rule → a
      mentioning comment lands for the assignee). **Flips one scoreboard row**
      (84 ✅ / 48 ❌).

- [x] **Forms routing** (048, rock 1.7) — send a submission to the right column /
      assignee / labels by its answers. An ordered `form.routing JSONB` list;
      `submitForm` evaluates each route (the automation engine's condition
      evaluator, over a snapshot of the answers keyed by question label) and the
      first match overrides the form's default target column and sets the new
      task's assignee + labels. A form thus routes with the same predicate
      vocabulary a rule fires on. Empty = today's behavior. Compact routing editor
      in the FormsDialog builder ([question][op][value] → [column]). 3 tests (pure
      resolveRouting + a DB submit routed vs default). **Flips one scoreboard row**
      (85 ✅ / 47 ❌).

- [x] **External automation connectors** (049, rock 1.12) — the inbound arm.
      Outbound was already done (the engine's webhook action + 025's HMAC stream
      make the app callable from n8n/Make/Power Automate); this is the mirror: a
      scoped, revocable `automation_trigger` token per board that an external tool
      POSTs to (`POST /api/board/[id]/triggers/[token]`, no session — the token IS
      the credential, 025's shape), raising a synthetic `external.trigger` event.
      Like schedule.tick it scans the board and applies matching rules — the
      difference is what wakes it — reusing the extracted `scanBoardWithRule`. Token
      mint/list/revoke/delete is admin; a token minted for one board can't fire
      another (board+token both checked); a bad/inactive token is a flat 404. UI
      section in the Automations dialog mints tokens and shows the fire URL. 1 DB
      test (active token fires + acts, wrong board / revoked → null). Native
      Zapier/Make *listings* stay ⛔ — this makes the app connectable from them.
      **Flips one scoreboard row** (86 ✅ / 46 ❌).

- [x] **SLA management** (050, rock 1.6) — service timers with breach +
      escalation, on the engine. `sla_policy` (board-scoped: `applies_when`
      condition, `target_mins`, `action_on_breach` = engine actions) + `task_sla`
      (per task: started/due/breached timestamps, one live timer per (task,
      policy)). Elapsed + remaining are **derived** (now() vs due_at), never
      stored. A sweep rides the durable drainer's tick: pass 1 starts a timer
      (due target_mins out) for each task a policy matches without one; pass 2
      stamps `breached_at` on every open timer past due (claimed in the same
      UPDATE so two sweeps can't double-fire) and runs its escalation action —
      each breach guarded so one bad action can't abort the sweep. Policy CRUD
      admin, reads viewer+; `GET /api/tasks/[id]/sla` exposes the derived status.
      Compact policy editor in the Automations dialog. 3 tests (pure remaining +
      breach math, DB start→force-overdue→breach+escalate, no re-breach). **Flips
      one scoreboard row** (87 ✅ / 45 ❌).

- [x] **Workflow templates** (051, rock 1.9) — a reusable process bundle (column
      set + automation rules + SLA policies) applied to a board in one move; the
      task-templates pattern (019) one level up. `workflow_template` (workspace-
      scoped, three JSONB bundles) holds a workspace's saved templates; built-in
      presets (Kanban / Scrum / Incident) live in code and apply the same way.
      Apply replays the ordinary create-* repositories as the applying admin —
      appends missing columns by title (existing left alone), then creates the
      rules and SLA policies — so an applied template can do nothing a human admin
      couldn't, and every object is logged like a hand-made one. `list` (viewer, +
      built-ins) / `create` / `delete` (admin) + `POST /api/board/[id]/apply-template`.
      Templates section in the Automations dialog. 2 tests (built-ins listed;
      Incident apply adds columns+rules+SLA, idempotent on columns). **Flips one
      scoreboard row** (88 ✅ / 44 ❌).

- [x] **Incident/service workflows** (rock 1.10) — not a new engine, per the
      SPEC: the **Incident** built-in template (1.9) *is* the native incident
      process — severity columns (Triage/Investigating/Mitigated/Resolved), an
      escalation SLA (urgent within 30m → notify + comment on breach), and a
      notify-on-urgent rule — applied to any board in one move. This rock adds the
      one missing primitive to *declare* one: a `create_task` engine action that
      spawns a task (into a named column or the triggering task's, defaulting
      through the same createTask gate), so a rule/template can open an incident.
      Added to the builder as "create task". 1 DB test (a rule's create_task
      spawns the task in the target column). **Flips one scoreboard row** (89 ✅ /
      43 ❌).

- [x] **Request management** (052, rock 1.8) — a structured intake queue by
      composition, not a new object: a "request" is a Form (039) submission — it
      already lands as a task in a status column (custom statuses ✅), routed by
      its answers (1.7) and timed by SLAs (1.6). This rock adds the intake
      identity (`task.request_meta` JSONB — source form + requester, stamped on
      submit; its presence marks a task as a request) and the **Requests queue**:
      a self-fetching lens (`listRequests` viewer+, `GET /api/board/[id]/requests`)
      that groups intake tasks by status, each showing its source form, requester
      (resolved through user/agent like the activity feed), and nearest open SLA
      due. RequestsDialog on the toolbar. 1 DB test (a form submission appears with
      its source + requester; an ordinary task does not). **Flips one scoreboard
      row** (90 ✅ / 42 ❌).

- [x] **Custom scripts/functions** (rock 1.11) — a sandboxed `script` action, the
      phase's highest-risk rock, so it ships last, admin-only, **off by default**
      (`AUTOMATION_SCRIPTS_ENABLED`). Its safety rests on a capability-free design:
      the script gets a *frozen copy* of the task and returns effect *descriptors*
      (plain JSON) — it never touches the DB, fs, or network. The engine
      re-validates every returned effect (no nested script) and applies it through
      the same gated repositories a declared action uses, so a script can only
      produce actions its admin author could type by hand. The `node:vm` sandbox
      adds a hard CPU timeout and strips Node globals (no require/process/fetch);
      the threat model is documented honestly (node:vm isn't a hard boundary
      against a determined admin — isolated-vm is the drop-in hardening behind the
      same seam). Builder gains a "run script" action (code textarea). 6 pure
      sandbox tests (effects through, invalid/nested-script dropped, no globals,
      frozen snapshot, timeout). **Flips one scoreboard row** (91 ✅ / 41 ❌) —
      **closes the Workflow & Automation area (15/15 ✅)** and all twelve Phase 1
      rocks.

## Rocks sweep — outcome

Three capability areas are now fully native: **Core Work Items 14/14 ✅**,
**Planning & Views 16/16 ✅**, and **Agile & Product 14/14 ✅** (043–044 closed
the last three Agile rocks — Product discovery, Feedback intake, Scaled
Agile/SAFe). Scoreboard 79 ✅ / 61 ❌. Full suite 541 tests / 61 files green;
tsc/eslint/build clean per feature.

## Phase 2 — Developer & DevOps / Git (building, per devdocs/SPEC.md)

- [x] **Secret encryption at rest** (6.5, pulled forward) — the enabler Phase 2's
      git-host credential rides. `shared/crypto/secret-box.ts`: an app-side
      AES-256-GCM box keyed by `ENCRYPTION_KEY` (falling back to
      `BETTER_AUTH_SECRET`, so it works in every deployment that already runs),
      minting self-describing `v1.<iv>.<tag>.<ct>` tokens. AEAD means tampering is
      a hard decryption failure, not silent corruption; the version prefix is the
      seam for later key rotation. Does not retrofit 025's plaintext webhook key
      (that signs outbound only — its own commit). Pure, 8 unit tests (round-trip,
      IV uniqueness, tamper→throw, malformed→throw). **Flips the Encryption
      scoreboard row** (92 ✅ / 40 ❌). SPEC's build sequence: 6.5 lands before
      Phase 2/7 store any third-party token.

- [x] **Git provider connection + link model** (053, rock 2.0, the spine — not
      itself a scoreboard row, enables 2.1–2.10) — the mirror of webhooks (025):
      a *verified inbound* ingress where 025 is signed outbound. `repo_connection`
      (workspace-scoped, provider/repo, inbound signing secret **encrypted** via
      6.5, `created_by` NOT NULL CASCADE so a git event has a real actor —
      automation_rule's model) + `task_git_link` (per-task branch/pr/commit rows,
      `UNIQUE(task,provider,kind,external_id)` so a PR that opens→merges is one row
      that changes state). Pure smart-commit parsing (`lib/parse.ts`: `#123` in
      messages, `feature/123-slug` branch refs, strict enough to skip `v1.2.3`).
      The ingress (`ingestEvent`, provider-agnostic) resolves refs to tasks **in
      the connection's workspace only** (repo A can't touch repo B's board),
      upserts links, and logs a `git.*` activity **only on a real state change**
      (idempotent redelivery, no delivery-id bookkeeping) — which rides the same
      post-commit sink webhooks + the automation engine subscribe to, so
      **"when a PR merges, move to Done" is an ordinary Phase-1 rule** (one-line
      runner relaxation to dispatch `git.` events; git trigger events added to the
      builder). New `git.*` activity family (GitAction + GitSnapshot = the linked
      task's snapshot + the git artifact) with feed narration + bell verbs.
      Connection CRUD admin (secret shown once), link reads viewer+, ingress takes
      no session (the signature is the credential — boardForTriggerToken's shape).
      16 tests (10 git: secret-encrypted-at-rest, ingest+tenancy, idempotency,
      end-to-end pr_merged→rule-fire; + 6 pure parse). tsc/eslint/build clean.

- [x] **GitHub integration** (rock 2.1) — the concrete GitHub App adapter on the
      2.0 spine: `github.ts` verifies `X-Hub-Signature-256` (constant-time, over
      the raw body before parse) against the connection's decrypted secret, then
      normalizes `pull_request` (opened/merged/closed → the right `git.*` action),
      `push` (one commit link per commit), and `create` (branch) payloads onto the
      provider-agnostic `NormalizedGitEvent` the 2.0 ingress consumes. Route
      `POST /api/git/webhook/github/[id]` (no session — the signature is the
      credential; a bad id/provider/signature is a flat 404/401 that leaks
      nothing). So a real GitHub App drives the board and fires Phase-1 rules
      end-to-end. The OAuth install handshake + installation-token REST (branch
      creation 2.6, CI backfill 2.7) are wired to the same `repo_connection` but
      run against the live API, not the sandbox. 14 tests (pure: signature
      valid/tampered/missing, PR/push/create normalization; DB: a signed
      pull_request webhook links its `#ref` task, bad-sig→401, unknown-conn→404).
      **Flips the GitHub integration scoreboard row** (93 ✅ / 39 ❌).

- [x] **Pull request + commit links** (rocks 2.4 + 2.5) — the `task_git_link`
      rows (2.0) surfaced. A read-only, self-fetching `DevelopmentSection` in the
      task dialog (TimeSection's shape, inert until a repo references the task —
      CustomFieldsSection's precedent) lists the linked PRs/commits/branches with a
      kind icon, a link out to the artifact, and a PR state chip
      (open/merged/closed). `GET /api/tasks/[id]/git-links` (viewer+). No writes —
      the git host owns a link's lifecycle. 3 component tests (PR by title + chip +
      href, titleless commit → short sha, empty → renders nothing); task-dialog
      test mocks it like the other self-fetching sections. tsc/build clean, eslint
      clean (the grandfathered task-dialog set-state-in-effect only). **Flips the
      Pull request links + Commit links scoreboard rows** (95 ✅ / 37 ❌). Branch
      *creation* (2.6) stays ❌ — tracking is done, the API-create half is live-only.

- [x] **GitLab integration** (rock 2.2) — the second vendor adapter on the 2.0
      spine, the twin of 2.1. `gitlab.ts` differs from GitHub in exactly two
      provider-specific spots: GitLab carries a *plain* secret in `X-Gitlab-Token`
      (no HMAC), so `verifyGitlabToken` is a constant-time equality against the
      connection's decrypted secret (length-checked, fail-closed), and the body may
      be read after verifying (no raw-body-before-parse constraint); and payloads
      are keyed off the in-body `object_kind` — `merge_request` (`object_attributes`
      iid/url/title/description/state/source_branch → the right `git.*` action, MR
      states opened/locked/reopened→open, merged, closed) and `push` (one commit
      link per commit, plus a branch link when the push creates the branch — the
      all-zero `before` SHA, GitLab's equivalent of GitHub's `create` event). Route
      `POST /api/git/webhook/gitlab/[id]` (no session — the token is the credential;
      a bad id, a non-GitLab connection, or a wrong token all answer a flat
      404/401). Everything downstream (task resolution, link upsert, idempotency,
      rule firing) is 2.0's, shared. No migration — `createConnection` already
      validates any provider. 9 tests (pure: token valid/wrong/missing, MR
      open/merged/closed normalization, push commits, new-branch link, unmodeled
      events; DB: a token-authed merge_request webhook links its `#ref` task,
      bad-token→401, unknown-conn→404, a GitLab token on a GitHub connection→404).
      tsc/eslint/build clean. **Flips the GitLab integration scoreboard row**
      (96 ✅ / 36 ❌).

- [x] **Bitbucket integration** (rock 2.3) — the third vendor adapter, sibling of
      2.1/2.2. Bitbucket sits with GitHub on verification: a configured secret makes
      it HMAC-SHA256 the raw body and send `X-Hub-Signature: sha256=…` (GitHub's
      scheme, header minus the `-256`), so `verifyBitbucketSignature` is GitHub's
      constant-time compare. Events ride `X-Event-Key` (`pullrequest:*`,
      `repo:push`) with Bitbucket's nested payload — a PR's `id`/`links.html.href`/
      `source.branch.name`/`state` (OPEN→open, MERGED→merged, DECLINED|SUPERSEDED→
      closed) and a push's `push.changes[]` (one commit link per commit across all
      changes via `commits[].hash`/`links.html.href`, plus a branch link for a newly
      created branch — `change.old == null`). Route `POST
      /api/git/webhook/bitbucket/[id]` (no session — the signature is the credential;
      bad id / non-Bitbucket connection / bad signature → flat 404/401). No
      migration. 8 tests (pure: signature valid/tampered/missing, PR
      open/merged/declined, push commits across changes, new-branch link, unmodeled
      events; DB: a signed pullrequest webhook links its `#ref` task, bad-sig→401,
      unknown-conn→404). tsc/eslint/build clean. **Flips the Bitbucket integration
      scoreboard row** (97 ✅ / 35 ❌) — **all three git hosts now drive the board.**

- [x] **CI/CD integration** (054, rock 2.7) — build/deploy/pipeline status on the
      task. A CI run is not a link (a branch/PR/commit): it is *about* a ref, has a
      two-part lifecycle (a `status` running queued→in_progress→completed, then a
      `conclusion`), and re-reports as it runs — so it gets its own `task_ci_status`
      table rather than overloading `task_git_link.state`. GitHub `check_suite` and
      GitLab `pipeline` webhooks fold onto a shared normalized vocabulary
      (`normalizeGithubCiEvent` / `normalizeGitlabCiEvent`) and resolve to the task
      by the run's head branch — 2.0's smart-commit parsing, reused (`resolveTaskRefs`
      re-typed to the `branch`/`messages` it reads so both event kinds share it). The
      ingest (`ingestCiEvent`, the twin of `ingestEvent`) upserts per task and logs
      `git.ci_passed`/`git.ci_failed` **only on the transition to a terminal pass/fail
      conclusion** — an in-flight or redelivered or `neutral` (skipped/cancelled) run
      upserts silently — so a build fires a Phase-1 rule exactly once ("when CI fails,
      notify the assignee"). New `git.ci_*` activity family (feed narration + bell
      verbs + trigger events + builder labels). `GET /api/tasks/[id]/ci-status`
      (viewer+); the Development section gains a pass/fail/running chip (green
      check / red x / dashed) beside the PR/commit rows. 17 tests (pure: GH check_suite
      + GL pipeline status folding, unresolvable/wrong-kind → null; DB: in_progress
      upserts-no-fire, completed failure fires ci_failed once + idempotent redelivery,
      success fires ci_passed, neutral records-no-fire, cross-workspace tenancy;
      component: failed + running chips). tsc/eslint/build clean. **Flips the CI/CD
      integration scoreboard row** (98 ✅ / 34 ❌).

- [x] **Release management** (055, rock 2.8) — versions grouping delivered work.
      A `release` (board-scoped: name/state/notes/url) + `task.release_id`
      (milestone_id's SET-NULL twin) that rolls up done/total exactly as a milestone
      does. The git-native part: a release flips planned→released either by hand
      (`updateRelease state='released'`) or when a matching git tag publishes —
      `normalizeGithubReleaseEvent`/`normalizeGitlabReleaseEvent` (published/create
      only, drafts skipped) feed `ingestReleaseEvent`, which ships the planned
      release **of the same name in the connection's workspace only** (a repo can't
      ship another workspace's release — ingestEvent's tenancy rule), stamps
      `released_at`, and freezes notes — author notes win, then the tag body, then a
      pure `compileReleaseNotes` list of the shipped tasks' titles (frozen at ship
      time, derive-don't-store's exception). Shipping logs `release.released` onto
      the same post-commit sink, so a shipped release can fire a Phase-1 rule. New
      `release.*` activity family (action/snapshot/Activity arm/ActivityInput arm/
      bell — the four-touch rule). CRUD member (`GET/POST /api/board/[id]/releases`,
      `PATCH/DELETE /api/releases/[id]`); assignment is a dedicated
      `POST /api/releases/[id]/tasks` kept **off** the task create/update hot path by
      design (a release is its own surface). Self-fetching ReleasesDialog (Forms/
      Timesheet shape) mounted beside Milestones, with per-release rollup, ship, and
      a task-assignment panel. 13 tests (pure: notes compile, GH/GL release
      normalization; DB: create + duplicate conflict + rollup, manual ship freezes
      auto-notes + logs, assignment tenancy, git-tag ships + idempotent redelivery,
      cross-workspace tag refused). tsc/eslint/build clean. **Flips the Release
      management scoreboard row** (99 ✅ / 33 ❌).

- [x] **Branch linking/automation** (rock 2.6) — two halves, mostly already
      standing. *Tracking* was delivered by 2.0 (a `feature/123-slug` branch links
      to task 123 via `parseBranchRef`) and *automation* by Phase 1 + the 2.0 runner
      relaxation: `git.branch_linked` is a trigger event, so "branch created → move
      to In Progress" is an ordinary no-code rule today. This rock adds the missing
      *create* primitive's pure core: `suggestBranchName(taskId, title)` —
      `feature/<id>-<slug>`, the **exact inverse of `parseBranchRef`**, pinned by a
      round-trip test (`parseBranchRef(suggestBranchName(id, t)) === id`) so a name
      we suggest always re-links. Surfaced as a copyable branch name in the task
      dialog's Development section (shown once a repo references the task, the
      inert-until-git rule). The provider-API call that opens the branch on the
      remote stays live-only (needs an installation token), the 2.5 branch-creation
      note's honest boundary. 4 pure tests (slug build, empty-title fallback, length
      cap, round-trip). tsc/eslint/build clean. **Flips the Branch linking/automation
      scoreboard row** (100 ✅ / 32 ❌).

- [x] **GraphQL API** (rock 2.9) — a read-first `/api/graphql` beside REST, over the
      existing repositories (the `graphql` reference impl, schema-first via
      `buildSchema`). `Query.board(id)` returns the board tree (columns → tasks) +
      milestones; `Query.task(id)` a single task. The design point: it is a second
      *shape*, not a second permission system — every resolver calls `getBoard` /
      `getTask`, so it inherits their `requireBoardRole`/`requireTaskRole` gates and
      the shared principal resolution (`getPrincipalFromRequest`: a session cookie or
      an `x-agent-key`), and a query for a board the caller can't read surfaces a
      GraphQL error + null field, never another board's rows. Only the two Query
      fields need a resolver — the nested tree is pre-shaped so GraphQL's default
      field resolver reads it. Read-only first cut (mutations phase in behind the
      REST gates), so the new surface's blast radius is zero. Added the `graphql@16`
      dependency. 3 DB tests (board tree with columns+tasks, single task, a
      non-member's query errors + null — authz inherited). tsc/eslint/build clean.
      **Flips the GraphQL API scoreboard row** (101 ✅ / 31 ❌).

- [x] **Repository browsing** (rock 2.10) — a read-through proxy into the connected
      repo. `GET /api/repo-connections/[id]/tree?path=&ref=` and `/branches` call the
      provider's contents/branches API and normalize GitHub + GitLab responses onto a
      common `RepoEntry`/`RepoBranch` shape (pure `lib/browse.ts`: tree→dir/blob→file,
      dirs sorted before files). **No repo data stored** — a pass-through, not a
      mirror, the self-hosted "hold only what we must" stance. Gated viewer+ of the
      connection's workspace (`browseRepoTree`/`listRepoBranches`). The provider HTTP
      call is injected (`deps.fetchImpl`, global fetch by default), so the
      normalization + the gate are testable without a network; the installation-token
      retrieval, response caching, and a read-only file/branch panel are the live-only
      layer. Bitbucket browse is a stated follow-up (its API differs enough to
      warrant its own pass). 7 tests (pure: GH/GL tree fold + single-file + branch
      lists; DB: normalized tree/branches through a stub fetch, provider error →
      throw, non-member + unknown-connection refused). tsc/eslint/build clean.
      **Flips the Repository browsing scoreboard row** (102 ✅ / 30 ❌).

## Phase 2 — complete

**All ten Phase 2 rocks (2.0–2.10) plus the pulled-forward 6.5 have shipped.** The
Developer & DevOps / Git area is native end to end: one link model (2.0) verified
inbound from **all three hosts** — GitHub (2.1), GitLab (2.2), Bitbucket (2.3) —
surfacing PRs/commits/branches (2.4/2.5) and CI runs (2.7) on the task, generating
the canonical branch name to create (2.6), grouping delivered work into git-tag-
shipped releases (2.8), a read-first GraphQL surface (2.9), and a read-through repo
browser (2.10) — every git event riding the same post-commit sink so a merged PR,
a green build, or a shipped release fires an ordinary Phase-1 rule. Scoreboard
**102 ✅ / 30 ❌ / 8 ⛔**.

> Anything touching **agent behaviour/budgets** or **export/product forks** should
> go through `AskUserQuestion` before building (per `prd.md` §7/§12).
