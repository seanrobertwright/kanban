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
- [x] **Objective agent tools** — done 2026-07-28; see the roadmap-item-2 section
      at the end of this file. `set_objective` (changeset) and `score_key_result`
      (auto) in both doors, after the `AskUserQuestion` PRD §7/§12 requires.
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

## Phase 3 — complete

**Knowledge & Collaboration (3.0–3.10) is complete.** Docs/wiki supports page,
meeting, and decision templates, Markdown rendering, revisions, published search,
and meeting-action promotion. A separate Yjs WebSocket process persists CRDT update
logs and compacted snapshots. Native polling chat, self-hosted Excalidraw boards with
task cards, guest object shares, and revocable tokenized public document/board pages
are available. Migrations 056–061 are applied locally; run `npm run realtime` beside
the app for collaborative editing.

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

## Phase 5 — Reporting & Analytics (building, per devdocs/SPEC.md)

- [x] **Custom reports** (058, rock 5.1) — a saved, user-defined report over the
      existing read model. `report` (workspace-scoped): a *definition* only —
      `source (tasks|time|flow|financial)`, the **reused saved-view (015) filter**
      JSONB, `group_by`, `metric`, `viz (bar|line|table)`, `visibility
      (private|shared)`, and an optional `board_id` (NULL = the whole workspace,
      the portfolio 040). Results are never stored: a pure `runReport(spec, facts)`
      folds them at read time (`lib/report.ts`) — derive-don't-store. The
      source-specific half (`server/repository.ts` `gatherFacts`) reads tasks via
      the shared `taskColumns()` join, the time ledger (027), or the flow replay
      (analytics cycle time), tags each fact with its bucket label, and applies the
      **same `taskMatchesFilter` predicate** the board bar uses — extracted from the
      client `board-filter-bar.tsx` into a pure `board/lib/filter.ts` (re-exported,
      so no caller changed) so server and client share one source of truth for
      "does this task match". Metric×source and group_by×source legality lives in
      two maps (`METRICS_BY_SOURCE`/`GROUP_BYS_BY_SOURCE`) the API validates against
      **and** the builder derives its dropdowns from, so the form can only compose a
      legal report. Charts are net-new generic `bar|line|table` primitives in the
      Insights inline-SVG language (`0 0 100 40`, `fill-primary`, `<title>`
      tooltips) — the reusable extraction SPEC 5.1 named (Insights' own charts were
      bespoke/non-exported). Gates: reads viewer+ (agents may read shared reports);
      a **private** report is authored at **member** and is owner-only (invisible +
      un-runnable to others, 404 not 403); a **shared** report is authored at
      **admin** — the §7.4 blast-radius rule; re-sharing a private report re-checks
      admin. `GET/POST /api/workspaces/[id]/reports`, `PATCH/DELETE /api/reports/[id]`,
      `GET /api/reports/[id]/run`. 19 tests (13 pure: count/sum/avg-cycle folds,
      day-vs-value ordering, cent/minute rounding, compat maps; 6 DB: count-by-status,
      estimate-by-priority, filter-before-aggregate, dup-name conflict, private
      hidden/un-runnable + member-can't-share, incompatible-metric update rejected).
      tsc/eslint clean. **Flips the Custom reports scoreboard row.**

- [x] **Financial reports** (rock 5.2) — the ⛔-adjacent business layer, built from
      our own data: `source: "financial"`, `metric: "sum:spend"` rolls each time
      entry's minutes × the board's flat `hourly_rate` (042) into spend via budget's
      pure `costOf` — the same money math the budget rollup uses, no new number
      stored. Group by board, member, or day; scope one board or the whole portfolio.
      Single-currency scope surfaces the board `currency`; a mixed-currency portfolio
      returns null rather than a misleading symbol. It is just a source in 5.1's
      builder, so it inherits the filter, gates, viz, and pure-fold pipeline whole —
      no separate slice. (No per-member/role rate history exists yet; a time-varying
      rate model is a stated follow-up.) **Flips the Financial reports scoreboard row.**

Wired into the app shell as a header **Reports** dialog (`reports-dialog.tsx`,
beside Portfolio), mounting `ReportsPanel` lazily on open with the current
workspace's boards. tsc/eslint/build clean (all three report routes compile).

---

## Truth pass — the two AI rocks the code review called overclaims (2026-07-27)

`complete-code-review.md` §5 item 4 asked for a truth pass on three ✅ rows that
were weaker than the SPEC promised. Git browse was fixed in `8c8acf2`; these are
the other two. Both went through `AskUserQuestion` first, per the Phase 4 rule
that agent-behaviour rocks do.

- [x] **AI workflow builder** (rock 4.4) — was a 14-line regex over four phrases.
      Now `POST /api/board/[id]/automations/draft`: the board's real column,
      label and member ids go to the model, which fills a **closed DTO** (one
      trigger, a flat predicate list, seven action shapes) rather than emitting
      engine JSON. `compile` turns that into `Action[]`; the result then walks
      `readTrigger`/`readCondition`/`readActions` — extracted from `handlers.ts`
      into `server/validate.ts` so the drafter and the POST body are validated by
      one predicate, not two. Ids are re-checked against the board (the generic
      validators only know "integer"). Every failure is a 400 with the reason;
      nothing is coerced. `script` is absent from the DTO by design — a model
      writing sandboxed code for a human to skim is the review that doesn't
      happen. Drafts are always `isEnabled: false`, gated at `automation.manage`
      (the authoring gate). No key configured → the old phrasebook, and the UI
      says which drafter answered. 8 pure tests (compile + refusals + fallback).

- [x] **Knowledge retrieval** (rock 4.3) — synthesis was already a real model
      call with citations; retrieval was the weak half: `simple` (no stemming),
      ordered by `updated_at` (recency, not relevance), tsvector recomputed per
      row. Migration **084** replaces the 072 expression indexes with STORED
      generated `search_tsv` columns on the `english` config + GIN, and adds
      `pg_trgm` title indexes. The reader now ranks by `ts_rank` and falls back
      to `word_similarity` on titles when strict full text finds nothing, both
      arms selecting from the same authorized CTE so the fuzzy path cannot
      become a second way into a board. 4 new DB tests (relevance beats recency,
      stemming, typo fallback, fuzzy stays inside the board filter).
      **Embeddings remain unbuilt, and the scoreboard row now says so** — semantic
      recall needs an embedding vendor this self-hosted app does not otherwise
      depend on. Decided, not forgotten.

## Phase 6/7/8 leftovers — the two that were real (2026-07-27)

A survey of the enterprise/integration/extensibility rocks found most of them
genuinely shipped: SSO (6.1), SCIM (6.2), the admin console (6.4, now five
settings sections), retention + legal hold (6.6), IP allowlisting (6.8), and all
five Phase 7 integrations. Application-level encryption (6.5) already covers
every secret this app stores itself — git host tokens, integration OAuth,
webhook signing keys — with SCIM bearer tokens owned by the better-auth plugin.
Granular permissions (6.3) has its `permission_grant` table, its central
`can()`, board grants and field ACLs, all tested in `governance.test.ts`.

Two were thinner than their rows claimed.

- [x] **eDiscovery over the real index** (rock 6.7) — was `ILIKE` over four
      unions, ordered by date, capped at 500 in silence. Now stemmed full text
      over the 084 `search_tsv` columns ranked by `ts_rank`, **unioned with** the
      substring pass rather than replacing it: a compliance search is usually for
      an identifier (a domain, an order number, half an id) that no stemmer will
      match, so recall is the requirement and relevance is the bonus. The audit
      arm stays substring-only — it has no tsvector and substring is the right
      question for it. Each hit now carries `onHold`, since "is this preserved?"
      is the first question asked of a bundle and the join was one line away. The
      cap is reported (`truncated`, `limit`) on the export, in the audit row, and
      in the panel — a truncated bundle that looks complete is worse than none.
      5 new DB tests (substring recall, ranking, hold flag on/off, truncation).

- [x] **Extension capability breadth** (rock 8.1) — the install/sandbox/bridge
      model was built and tested, but the vocabulary was one word: `task.read`.
      Went through `AskUserQuestion`; the answer was read-only breadth. The set
      is now `task.read`, `comments.read`, `labels.read`, `board.read`, each
      buying exactly one projection built by hand in the bridge — never a row, so
      adding a column to a table cannot silently widen what third-party code
      sees. Comments carry author display names, not ids or emails; the board arm
      carries structure and counts, not cards. The bridge checks the caller's
      board access first and the manifest's grant second, and a grant for one
      scope is a 403 for another. **Nothing writes**: there is no write
      capability to grant, which is the property that makes an iframe an
      acceptable place to run someone else's code. 5 new DB tests + the client
      bridge now speaks capability→scope.

## Code-review roadmap item 1 — guard rails on the GraphQL door (2026-07-28)

- [x] **GraphQL query limits** (roadmap §5 item 1) — `/api/graphql` was live with
      two query fields and no bound on what one request could ask for. The review
      called it a depth/complexity gap; the schema is acyclic (`Query → Board →
      Column → Task`, scalars at the leaves), so the exploitable shape is not
      depth at all — it is **alias amplification**: `{ a: board(id:1){id} b:
      board(id:2){id} … }` is two levels deep, trivially cheap per field, and one
      repository round trip per alias. Three static limits in
      `features/graphql/server/limits.ts`, computed from the parsed document so a
      rejected query costs a parse and no database call: **root fields ≤ 10**
      (the round-trip cap, counted through fragment spreads and inline
      fragments), **cost ≤ 2000** where a list field multiplies its subtree by an
      assumed 10 elements (`columns`/`tasks` have no page size, so the server
      pays the sub-selection once per row) and a root field costs 10, and
      **depth ≤ 8**, which today's schema cannot reach — it is there for the
      commit that adds a back-edge (`Task.parent`, `Column.board`) and makes an
      unbounded query expressible in a diff that would otherwise look innocent.
      Introspection is deliberately exempt from depth and costed flat: a tooling
      introspection query is legitimately ~11 levels deep and touches no
      repository, so measuring it would break GraphiQL and codegen to protect
      nothing. Went through `AskUserQuestion` (introspection stays open; the
      numbers stay hard-coded constants rather than four new env vars; a rate
      limit was wanted).
      `executeGraphQL` now spells out parse → `validate(specifiedRules)` →
      `checkQueryLimits` → `execute` instead of delegating to `graphql()`,
      because the limits need the parsed document — which also means **every**
      caller is behind the gate, not just the HTTP route, and `operationName` is
      now honoured. The ingress adds a per-**principal** token bucket (60 burst,
      1/s, reusing `shared/lib/rate-limit`) keyed on the agent/user id rather
      than the IP — an agent key and the human who minted it are separate
      budgets, two people behind one NAT are not — plus a pre-read
      `content-length` ceiling (413) and a query-text byte cap (413).
      Status codes now follow the GraphQL-over-HTTP split, which the guard rails
      forced the handler to take a position on: `data` absent means nothing
      executed (syntax, validation, bad variable, guard rail) → **400**; a
      resolver that refused → **200** with `errors` and a null field, because a
      board the caller can't read is a permission answer, not a failed request.
      19 new tests (9 pure limit cases including the honest ceiling — a whole
      board with every task field stays inside the budget — and 10 through the
      handler with a real agent key: 401, 400 ×3, 413 ×2, 429, and the
      200-with-errors authz case). tsc/eslint clean.

## Code-review roadmap item 2 — the doors reach the AI work (2026-07-28)

The review's finding was not that the AI rocks were unbuilt but that they were
unreachable: scheduling (4.1), risk (4.2) and the OKR writes existed as tested
libraries and REST routes, and neither agent door published a tool for any of
them. Capability an agent cannot name is capability it does not have. Three
slices, all four decisions taken through `AskUserQuestion` first (PRD §7/§12).

- [x] **Delivery risk on both doors** (rock 4.2) — `getBoardRisks` and
      `getTaskRisk` split out of `getBoardAnalytics` rather than duplicated, so
      the question can be asked without paying for six queries of flow history;
      the per-task read takes its board id out of `requireTaskRole`'s return
      instead of a second query, and answers `null` rather than a zero score
      when nothing fires. New `GET /api/board/[id]/risk` and
      `GET /api/tasks/[id]/risk` for Door 2. Both doors publish `score_risk`,
      and — the part that matters more — both **carry risk on the reads an
      agent already makes**: `list_board` returns `risks`, `get_task` returns
      `risk`. A signal you have to know to ask for is one most runs never see.
      10 tests.

- [x] **`propose_schedule` on both doors** (rock 4.1) — the tool SPEC 4.1 names.
      Read-only, decided rather than defaulted: `applyScheduleProposal` would
      have been one more line each, but it rewrites the dates of every task on a
      board in a single call, which is not a reviewable unit even held as a
      changeset. The agent plans; the dates it agrees with go through
      `set_due_date` one at a time, each an ordinary auto-tier change with its
      own activity row and its own undo. A test asserts no `apply_schedule`
      tool exists, so the absence is pinned rather than merely intended.

- [x] **`set_objective` + `score_key_result` on both doors** (the open OKR item
      above) — objective management was session-only and the repository took a
      bare `userId`, which is why these tools could not have been written. The
      repository widened to `string | Principal` (the principal.ts seam: every
      existing caller passes a string and is untouched) and three handlers moved
      to `getPrincipalFromRequest`. The tiers differ on purpose: `set_objective`
      is **changeset** (an objective states what the team is for — an agent
      drafts, a human decides), `score_key_result` is **auto** (a measurement
      against a target a human already set, score_task's shape). The auto grant
      is narrowed in the handler and not only in the description: an agent's
      key-result PATCH must be `currentValue` alone or it is a 403
      `AGENT_SCOPE`, so a measurement's permission cannot be borrowed to rename
      or re-target the measure. Both tools are added to `review.ts`'s
      `applyProposed`, the auto one included, so an operator raising its tier
      gets a proposal that can actually be accepted. Door 2's objectives
      handlers are the first callers of `externalAgentAction` — the seam
      `gate.ts` built for this and nothing had used. 9 tests.

Deletion of an objective or a key result, and *defining* a key result, stay
session-only: an agent that could invent the measure it then reports against
would be grading its own homework.

## Code-review roadmap item 5 — attachments without an object store (2026-07-28)

- [x] **Local-disk attachment fallback** — `storage.ts` threw "Attachment
      storage is not configured" the moment an upload arrived without S3 env, so
      a fresh self-host shipped an attachment UI with nowhere for the bytes to
      go. The module is now a façade over two backends: `s3-store.ts` (the
      existing code, unchanged in behaviour) and `local-store.ts`, chosen per
      call by whether **all three** of `S3_ENDPOINT`/`S3_ACCESS_KEY`/
      `S3_SECRET_KEY` are set — an endpoint with no credentials is a
      misconfiguration, and treating it as "S3 is on" would fail every upload
      while treating it as "S3 is off" would quietly write to a disk the next
      deploy discards. Local objects live under `ATTACHMENTS_DIR` (default
      `./data/attachments`, already gitignored) at the same opaque
      `tasks/<id>/<uuid>` keys, read back through `Readable.toWeb` so the
      repository cannot tell the two stores apart. The open is awaited before
      the stream is handed over, so a missing object throws where the caller can
      answer 404 instead of failing mid-body — matching what S3 does. Keys are
      resolved against the root and refused if they escape it: unreachable
      today since the repository mints every key, and checked anyway, because
      "the caller is careful" is not a property this module can hold on its own.
      S3 remains the right answer for more than one app process — two containers
      share a bucket and never a filesystem — so this is the floor, not the
      recommendation. 7 tests, needing neither Postgres nor MinIO, which is the
      deployment they describe.

## Code-review roadmap item 3 — the public feedback portal (2026-07-28)

- [x] **Tokenized public feedback intake** (SPEC 3.10 over 043) — 061 built the
      whole public-link capability (unguessable token, scope, expiry, revoke,
      rate-limited anonymous path) and forms took it up; feedback intake never
      did, so the one link a product team most wants to hand out — "tell us what
      you think" — could not be minted. Migration **085** widens the
      `public_link` subject CHECK with `'feedback'`, whose `subject_id` is a
      **board** id: the link is a door into a board's discovery inbox, and there
      is nothing to point at before a visitor has written anything. Not
      `'board'` + `scope='submit'`, because a board subject already means the
      read-only public board page and one subject meaning two pages by scope
      eventually resolves the wrong one. `workspaceFor` maps it explicitly ahead
      of the generic branch, which would otherwise read the `feedback` *table*.
      `getPublicFeedbackPortal` / `submitPublicFeedback` mirror the form pair:
      the token is the whole authorization, and the write then rides
      `createFeedback` as the link's minter (an admin at mint time) so board
      membership, tenancy and the insert all compile through the same path an
      authenticated capture uses. Signals land **unfiled** — filing under an
      idea is a triage judgement the submitter is not making — with the source
      the visitor typed or `'public'`.
      Went through `AskUserQuestion`: **submit-only** (a public roadmap would
      publish every idea title on the board, which an admin minting an intake
      link is not consenting to — it stays a separate share), and **optional
      free-text source** in the existing 80-char column rather than an email
      column and the retention promise that comes with it. `ShareDialog` learns
      the subject (submit scope, no guest-share section — an anonymous door has
      nobody to grant), and the trigger sits on the Discovery dialog's Feedback
      lens behind the same admin gate as the board's own share button.
      8 tests: the row lands on the token's board and not the neighbour's,
      unfiled, labelled `public` when unattributed; the portal returns exactly
      `{boardName}`; another workspace's owner gets not_found; expired, revoked
      and invented tokens are refused; a feedback token opens neither the board
      nor the form door; and a read-scope token cannot write.

- [x] **`vitest.config.ts` excludes `.next`** — found while verifying the above:
      `next build` with standalone output copies all of `src/` (test files
      included) into `.next/standalone`, and Vitest's default excludes cover
      `node_modules` and `dist` but not `.next`. Every `npm test` run after a
      build therefore collected each suite **twice** — 263 files instead of 131
      — and reported 19 failures from the copies, which fail on the pruned
      node_modules a standalone bundle ships. A green suite that turns red
      because someone ran a build is a verification bar nobody can trust.

## Code-review roadmap item 4 — Requests as a lens with triage (2026-07-28)

- [x] **`view_mode='requests'` + triage** (SPEC 1.8, rock 4) — 052 shipped the
      intake *read*: `listRequests` and a read-only dialog. What the SPEC names
      is a board lens, and what an intake team actually does — decide — did not
      exist at all. Migration **086** widens the `saved_view` CHECK (the 073
      pattern, sixth time) and adds a partial index on `task (column_id) WHERE
      request_meta IS NOT NULL`, the queue's whole selectivity.
      Triage state lives in the existing `request_meta` JSONB as a `triage`
      sub-object (`{state, at, actorType, actorId, reason?}`), so **no backfill**:
      an untriaged request is one with no `triage` key, which is every request
      that already exists, and the queue reads them all as open. Written with
      `jsonb_set` / `- 'triage'` rather than by replacing `request_meta`, which
      would clobber a source/requester stamp written since the row was read.
      `triageRequest` owns the verdict and nothing else: the routing half rides
      `moveTask` (with the runner's `MAX_SAFE_INTEGER` append sentinel) and
      `updateTask`, inheriting their tenancy checks, position handling,
      automation triggers and `task.moved` / `task.assigned` log rows. Member,
      not admin — every write it makes is one the same person could make by hand
      on the board. The board id in the URL is checked against the task's, so a
      member of two boards cannot triage board B's request through board A's
      door. New activity family `request.accepted|declined|reopened` with its own
      `RequestSnapshot` (source carried in the snapshot, `CustomFieldValueSnapshot`'s
      reason: the form can be deleted and the entry must still read). No
      `request.created` — a request is born a form submission, which already
      logs `task.created`.
      `RequestsView` replaces `RequestsDialog` (retired, not kept beside it —
      one surface per job) on chord **G Q** (`r` was Roadmap's), grouped
      Open → Accepted → Declined. Accept **stages** its routing (column, owner,
      priority) and commits on one press: picking an assignee is not a verdict,
      and a triager who assigns and then declines must not have accepted by
      accident. Decline takes a reason (280 chars) that the activity feed
      prints — "declined a request" alone sends the reader to the task to find
      out why. Reopen clears the verdict, so a mis-triage costs a click.
      4 DB tests: an accept routes + stamps + logs exactly one row; a decline
      carries its reason and a reopen clears it while the intake stamp survives
      both writes; an ordinary task and a wrong-board id are both refused.

## Code-review roadmap item 6 — the test-debt tail (2026-07-28)

- [x] **Seven thin slices given real coverage** (rock 6) — the review named
      "18 slices at exactly one test file", but file count is the wrong meter:
      `chat` (8 assertions), `dependencies` (12) and `checklists` (7) are
      single-file and well covered, while `views` and `whiteboards` had **one
      assertion each** guarding a whole feature. Ranked by assertion count
      instead, the tail is: views 1, whiteboards 1, docs 2, milestones 3, sla 3,
      epics 4, sprints 4. All seven now carry the invariants that would
      otherwise be found in production. **+28 tests (1052 → 1080), full suite
      green.**
      - **views 1 → 5.** The keystone test drives off `BOARD_VIEW_MODES` itself
        and saves every lens in it, which catches the two-file bug nothing else
        can: a lens added to the TS union with the CHECK-widening migration
        forgotten (or the reverse). TypeScript cannot see a Postgres constraint;
        a data-driven loop covers every future lens the day it is named. Plus
        the same-name upsert (unique on `lower(name)`), per-person isolation
        (another member's view deletes as `false`, not a throw), and ordering.
      - **whiteboards 1 → 6.** A scene of nested objects, floats and unicode
        round-trips byte-for-byte (the repository stores canvases it has never
        seen); an update *replaces* rather than merges, so a deleted shape stays
        deleted; blank titles hit 060's CHECK; a viewer reads and cannot write;
        an unknown id is not_found before the role check.
      - **sla 3 → 7.** A policy is a filter, not a blanket (unmatched tasks
        carry no timer); a re-sweep does **not** reset a running clock — the
        `ON CONFLICT DO NOTHING` that keeps deadlines from extending on every
        tick, which would make an SLA that can never breach; a disabled policy
        starts nothing until enabled; JSONB fields are three-valued so a rename
        cannot blank the condition; authoring is admin, reading is viewer.
      - **milestones 3 → 7.** dueDate/epicId/objectiveId absent-leaves vs
        null-clears; another board's epic refused on both create and update;
        unknown ids not_found; `due_date NULLS LAST` ordering; viewer reads but
        cannot author.
      - **sprints 4 → 8.** The lifecycle only walks forwards (planning cannot be
        completed, active cannot be restarted, completed is terminal — the three
        transitions that would let velocity drift); start/end dates anchor to
        today so burndown has a window; an invalid rollover target sends work to
        the backlog rather than stranding the sprint mid-completion; deleting
        un-schedules without destroying.
      - **epics 4 → 7.** A no-op rename writes no `epic.updated` row (saving an
        unchanged form is the commonest edit there is, and the feed is read to
        see what changed); alphabetical listing; not_found on unknown ids;
        viewer gate.
      - **docs 2 → 6.** Search covers **published** docs only — a draft is
        thinking-in-progress, and its leaking into knowledge results is the
        security-shaped bug of this slice; a title-only edit writes no revision;
        self-parent and cross-workspace board refused; meeting actions promote
        only where a board exists to promote them to; and a **guest sees only
        explicitly shared docs** — unshared reads, revision reads and edits all
        answer not_found rather than 403.

## Code-review roadmap item 8 — dependencies stop meaning one thing (2026-07-29)

- [x] **Typed links with lag** (migration 087) — `task_dependency` gains
      `dep_type` (FS/SS/FF) and a signed `lag_days`, so an edge can say "these
      start together" and "these finish together" as well as 018's single
      finish-to-start, and can say how far apart the two ends sit. Positive is a
      wait, negative a lead (an overlap). Bounded at ±365 — not a domain rule
      but a typo guard, since an unbounded integer lets a pasted date push a
      schedule 55,000 years out and the arithmetic will comply.
      **SF is deliberately excluded**, recorded in 087 so it does not read as an
      oversight: it is the one link type that runs backwards, and it only earns
      its keep when a plan is scheduled from its end date toward the present,
      which no consumer here does. → `fd8d29e`
- [x] **Every pre-087 edge still means what it meant.** Both columns are NOT
      NULL with defaults, so the whole existing corpus reads FS/0 — exactly what
      all three consumers already assumed. Nothing shifts under an existing
      board, which is what let the schema land ahead of the maths.
- [x] **The add upserts the link.** The primary key is the *pair*, so two tasks
      have one relationship; re-adding it with a different type restates that
      relationship rather than creating a second edge. `DO NOTHING` would have
      left changing a type reachable only by delete-then-recreate, which briefly
      unblocks the task. Idempotency is intact (same values in, same row out),
      and the dialog and both doors get "change the link" with no new endpoint.
- [x] **Both doors, unchanged tier.** `flag_blocker` takes optional
      `type`/`lagDays` on Door 1 and Door 2, defaulting to FS/0, so an agent
      written before today emits byte-identical calls. The gate tier is
      untouched — naming what a link means is the same blast radius as declaring
      the link — and the recorded input carries the link, because "blocked by
      #42" and "starts with #42, two days in" are different proposals to review.
- [x] **The maths reads the type** (rock 8's real cost) — shipping the columns
      without this would have left a field the UI writes and nothing reads, the
      inert-✅ shape §2.2 keeps naming. All three types collapse to one rule,
      `start_d >= start_b + w`, with `w` = `dur_b + lag` (FS), `lag` (SS),
      `dur_b − dur_d + lag` (FF). `criticalPath` becomes CPM proper — forward
      pass for earliest start, backward for latest, critical means zero float —
      which reduces to the old duration-sum longest path exactly when every link
      is FS/0, so all twelve existing cases passed untouched. `proposeSchedule`
      states the same three rules in calendar dates and can now produce a date it
      previously could not: an FF dependent starting *before* its blocker ends.
      The Gantt anchors each arrow at the ends its link names. → `250430b`
- [x] **Coverage.** dependencies 12 → 24 assertions (type/lag stored, lead kept,
      re-add restates, both CHECKs refuse, the link reaches the board-wide edge
      list) plus a first component suite for the section that watches the wire
      rather than the DOM — it caught a real bug pre-ship, `Number("")` being 0
      rather than NaN, which made clearing the lag box commit "no lag" instead of
      reverting. schedule 12 → 17, schedule-proposal 2 → 9.

## Code review §2.1 `whiteboards` — one canvas, two people (2026-07-29)

- [x] **The CRDT transport reaches whiteboards** (migration 088) — the review's
      row read "single-writer last-write-wins; CRDT transport exists but
      unwired", and 060's shape says why: a canvas was one JSONB array and the
      dialog PATCHed the whole array on a 500ms debounce, so two people drawing
      was not a merge but a race — whoever's timer fired last wrote their view of
      the scene over the other's, and the loser's shapes were gone with no error
      anywhere. 057 had already built the fix for exactly this shape (an
      append-cheap update log compacted into a snapshot when the last
      collaborator leaves) for docs, and nothing pointed it at the second
      subject. 088 is that pair of tables for whiteboards, with the FKs the doc
      pair has: `ON DELETE CASCADE` is what stops a deleted canvas leaving
      megabytes of Yjs history, and a polymorphic `subject_id` on one shared
      table could not carry one. → `e4bf10f`
- [x] **A Y.Map keyed by element id, not a Y.Array of the scene.** Two people
      dragging two different shapes touch two different keys and merge with no
      conflict at all, where an array of the whole scene makes every edit a
      conflict with every other edit. What a Map gives up is order, and z-order
      is meaning on a canvas — recovered from Excalidraw's own fractional `index`
      (a sortable string, which every element carries since 0.18), with the id as
      the tie-break so two elements inserted concurrently at the same index still
      paint in the same order on both peers. It is the trade upstream Excalidraw's
      multiplayer makes.
- [x] **Version-guarded writes, because plain LWW is wrong here.** Yjs will let a
      peer that writes second overwrite a *newer* element with the older copy it
      was still holding. `version` counts mutations, so a higher one strictly
      contains more edits; `versionNonce` settles genuine simultaneity the same
      way wherever it is evaluated, which is what stops two clients ping-ponging.
- [x] **A removal is not an absence.** "In the shared map, missing from my
      scene" describes two opposite events — I erased it, or you just drew it and
      I have not painted you yet — and guessing wrong in the second case deletes
      a stranger's shape as they draw it. The client tracks which ids it has
      actually rendered and claims a delete only for those, which is also what
      lets it publish *changes* rather than "my scene": the whole-scene publish is
      the bug in a new costume.
- [x] **`whiteboard.scene` stays the truth outside the room.** Every reader that
      is not in it — the dialog's first paint, exports, agents, a deployment with
      no realtime process — reads that column, so the service flattens the CRDT
      back into it when the room empties. A room then **opens on whichever copy is
      newer**: a deployment can run with no socket at all (the dialog keeps 060's
      debounced PATCH, and says so under the canvas — the two modes have
      different rules and a user about to draw with someone deserves to know
      which one they are in), so "there is Yjs state, therefore Yjs is the truth"
      would silently discard everything drawn while the service was down. When
      the JSONB wins, the superseded updates are deleted rather than ignored: a
      scene reseeded from JSON shares no ancestry with them, and keeping them
      would resurrect deleted shapes on the next merge. The reverse case — a PATCH
      landing *while* a room is live — is left as documented last-write-wins,
      since the only client that PATCHes is the same dialog that would be holding
      the socket if one were available.
- [x] **Tickets name their kind.** One shared minter (`shared/realtime/ticket.ts`)
      for both room families, because the socket service verifies all of them with
      one function. Without `kind`, a signed `{id:7}` would open `doc-7` *and*
      `wb-7` — two unrelated subjects that happen to share an integer. Member, not
      viewer: a socket is a write channel, so the gate is `updateWhiteboard`'s, and
      a viewer keeps the read-only canvas they already had. The service's recheck
      is deliberately coarser than the mint (still a non-guest member of the
      workspace) — its job is revocation inside the ticket's 60 seconds, not
      re-deriving 063's grant lattice in a process that cannot import it.
- [x] **The task-card button goes through the room.** It used to remount the
      canvas with a new seed; a live room ignores its seed (that is what stops an
      empty client from publishing emptiness over a populated canvas), so the card
      would have appeared for a second and then been wiped by the room's own
      state on the next sync.
- [x] **Coverage: whiteboards 6 → 28 assertions**, across three shapes. The room
      is driven against the **real spawned service** (`node realtime/server.mjs`,
      exactly as compose runs it) and a real Postgres — two clients merge, an edit
      to someone else's shape merges, the room flattens into `scene` and compacts
      its log, the reseed rule survives an out-of-room PATCH, and the ticket
      refusals (wrong kind, unsigned, expired) run behind a **positive control**
      so they cannot pass by the socket failing for an unrelated reason. The doc
      rooms get their first test at all, since this refactor put both kinds
      through one persistence provider and a wrong branch would write a page's
      text nowhere. The reconciliation rules are unit-tested as pure functions,
      and a first component suite watches the Excalidraw glue: a peer's write
      repaints (the only channel a remote stroke has — no props change), and a
      live canvas stops asking the parent to PATCH, which is the two-writer bug
      reappearing one layer up.

## Code review §2.1 `epics` — a grouping stops being a name (2026-07-29)

- [x] **Status and owner** (migration 089) — the review's row read "name-only (no
      dates/state/owner); no agent tools", and an epic really was three columns:
      id, board, name. A board with fifteen buckets could not say which were
      live, which were ideas, which were parked, or who to ask about any of
      them. Those are facts about the *grouping* rather than the work inside it,
      so they cannot be derived and had to be stored. `status` defaults to
      'active', which is also the honest backfill — every epic made before today
      was made to file live work under. `owner_id` is SET NULL on the person's
      deletion (004's rule): losing the owner must not lose the epic.
- [x] **No date column, on purpose.** 031's own comment argues an epic has no due
      date — "an open-ended bucket a milestone lives *inside*, and the date that
      matters is the milestone's". That argument still holds, so the window an
      epic reports is **derived**: `startDate` is the earliest start among its
      tasks, `targetDate` the latest date it points at across both its tasks'
      due dates and its member milestones' own. The second half of that is what
      makes it useful — a milestone dated for September with nothing broken down
      under it yet is the ordinary state of a plan, and reading only tasks would
      report the epic as undated. `GREATEST` is load-bearing rather than
      convenient: Postgres skips nulls in it and yields null only when every
      argument is null, which is exactly "undated until something inside carries
      a date". A stored date could disagree with the work; a derived one cannot.
- [x] **Status is a field, not a lifecycle.** A sprint's status is enforced
      because a sprint is a timebox — one active per board, a start that commits
      scope, a completion that rolls work over. An epic is a bucket: nothing to
      roll over, and no reason two cannot be active at once. So the transitions
      are free and the CHECK is the whole rule, tested by walking
      done → active → paused → proposed, which a lifecycle would refuse and an
      epic must not (a bucket reopens when more work turns up in it). 'paused'
      earns its place because "we stopped" and "we finished" are the two states a
      reader most needs told apart — and deriving status from progress, the
      alternative considered, can express neither.
- [x] **One read, not two.** `getBoard` carried a hand-copied duplicate of the
      epics progress SQL, and 089 would have been the second time a column had to
      be added in both places for the dialog and the board to keep agreeing.
      `EPIC_SELECT` is now exported from the epics repository and used by both;
      the window test asserts through `getBoard` as well as `listEpics` so a
      re-fork fails rather than drifts.
- [x] **Door 1 could not see epics at all** — worse than the review's "20 vs 11"
      count suggested. Door 2 has published `list_epics` and `assign_to_epic`
      since 031; the native runtime published neither, so an agent on that door
      could not name a grouping. Both are now on both doors, `assign_to_epic` at
      **auto** tier — it is `aim_at_milestone` one level up: filing is grouping,
      not a change of plan, silent outside the board, and undone by filing back.
- [x] **`set_epic` at changeset, on both doors.** Naming a body of work, or
      declaring it parked or finished, is `set_objective`'s blast radius and gets
      `set_objective`'s tier. That meant the epic handlers taking a principal and
      going through `externalAgentAction`, which is what makes PRD §7.1's "same
      approval policy, both doors" true here rather than merely claimed. Both new
      tools were added to `review.ts`'s apply switch — a tool held with no apply
      case is a proposal that can never become a change, which is worse than
      either tier. Deletion stays session-only: it is the one epic verb with no
      agent tool behind it. → this commit
- [x] **A bad owner is refused at the door, not in the reviewer's face.** Found
      by the test that accepted the changeset rather than merely asserting it was
      held: validating the owner only inside `execute` meant an agent naming
      someone outside its workspace got a *queued* proposal that threw when a
      human accepted it — and a throw mid-review abandons every other action in
      that changeset, so one bad proposal takes good ones down with it. The
      check moved into the gate's `authorize` hook, which exists for exactly
      this. The update path gained an `authorize` at the same time, so a Door 2
      edit against a board the agent cannot write is now refused before it is
      held rather than after.
- [x] **The PATCH route got its first client.** `/api/epics/[id]` has answered
      since 031 and no client function ever called it — the dead-door shape the
      review names, in its other direction — so renaming an epic meant curl. The
      dialog now renames, and sets status and owner **on change rather than
      behind a Save**: they are single-value edits the server treats as
      idempotent, and a form that needs saving is how a status change gets lost.
      The name keeps an explicit Rename/Save, because a half-typed name is not a
      name. Each write sends only the field that changed — a dialog that posts
      the whole epic back is how a status change comes to un-own it.
- [x] **Three-valued ownership, end to end.** `undefined` leaves the owner and
      `null` clears it, and that distinction has to survive the wire (where
      `JSON.stringify` drops undefined), the recorded proposal input, and
      `applyProposed`. Tested at each: a rename that keeps the owner, an un-own
      that sends an explicit null, and an accepted status-only changeset that
      leaves the owner intact — the last of which is where a stray
      `ownerId: undefined` would have silently un-owned an epic on accept.
- [x] **Coverage: epics 7 → 23 assertions**, across three shapes. The repository
      suite gains the defaults, the free status walk, the CHECK's refusal, cross-
      workspace owner refusal, an owner's deletion leaving a listable epic with a
      null name, and the derived window (including the dated-milestone-only
      case). A new Door 2 suite drives the real handlers with an agent token:
      held → accepted → applied, for a create and an edit. And a first component
      suite watches the wire rather than the DOM, which is where the two wrong
      answers live — an owner picker posting `undefined` instead of `null`, and a
      status select sending a whole epic back. **Known, pre-existing:**
      `whiteboards/server/whiteboard-room.test.ts` fails when that directory's
      files run in parallel (leftover `whiteboard_update` rows from a sibling
      suite) and passes in isolation — reproduced on the clean tree at `6894cdb`,
      so it is 088's flake, not this slice's.

## Code review §2.1 — the three left in the small-ones pile (2026-07-30)

The review's per-feature table listed six small gaps; `epics`, `dependencies` and
`extensions` were closed in earlier commits. These are the remaining three.

### `capacity` — "weekly points only; no time-off model" (migration 090)

- [x] **The budget 041 stored is nominal**, and the plan read it as if it always
      held. A member on leave all week showed ten points of room, which is the
      one thing a capacity planner most needs told otherwise. Absence is not
      derivable from anything the app has — no calendar, no attendance, no leave
      request — so `member_time_off` stores it: inclusive dated ranges,
      workspace-scoped and keyed to the member like `member_capacity`.
- [x] **Ranges, not a per-week deduction.** A range is what a person knows ("out
      the 14th to the 21st"), reads correctly from any window, and makes the
      future visible; a per-week number would be re-entered for every week the
      leave spans and could say nothing about next month.
- [x] **No hours, no half days, no leave types.** The read prorates whole
      workdays against a weekly *point* budget, so a half day cannot change its
      answer; a leave type is an HR policy this app does not have, and the note
      field carries whatever a human needs to see.
- [x] **Overlaps are allowed on purpose.** A sick day inside a holiday, or the
      same leave synced twice, are honest entries. The read counts *distinct*
      workdays so a duplicate cannot deduct twice — a non-overlap constraint
      would instead fail the second true row.
- [x] **Time off prorates the budget, never the demand** — leave changes how much
      of the week a person has, not which tasks are theirs. Weekends deduct
      nothing (booking Saturday off must not shrink a budget), and UTC date
      arithmetic throughout keeps the week from sliding a day for a viewer west
      of the line.
- [x] **Over-allocation had to stop reading `utilization`.** Utilization now
      divides by *available* capacity, so someone away all week reads null — a
      percentage of zero capacity is undefined. But "away throughout and still
      holding work" is unambiguously over, so `isOverAllocated` asks the question
      directly (`committed > available`, with a budget set). That split is the
      whole reason the new state is reportable at all.
- [x] **Self-or-admin, unlike the budget.** A point budget is workspace structure
      an admin decides; your own leave is yours to record (time entries' rule).
      Booking someone else's stays admin. The revoke is scoped by workspace and,
      for a non-admin, by `user_id`, so a miss reads not_found instead of
      confirming a colleague's entry id exists. Dates are validated by ISO
      round-trip, not regex alone — `2026-02-31` matches the shape and would
      otherwise reach Postgres as a 500 from a cast.
- [x] **14 pure cases + 4 real-DB.** Week windows across a month and a year
      boundary, weekend and overhang clamping, the double-count case, rounding,
      the away-all-week flag; then proration reaching the plan, the member-only
      booking gate, the non-member refusal, own-or-admin revocation.

### `reports` — "forecast metric (spend-rate × remaining) missing" (migration 091)

- [x] **All five of 058's metrics fold rows that already happened.** So the
      financial report could say what a board has spent and never where it is
      heading. `forecast:spend` = spend ÷ delivered points, applied to the points
      still open, plus the spend to date. That rate is the only one the app can
      observe without a second number for someone to maintain: a per-task budget
      would rot, and a calendar burn rate forecasts elapsed time, not work.
- [x] **"Delivered" is the board's own done column** (020), so a board that never
      chose one has delivered nothing, every point reads open, and the forecast
      declines to project rather than dividing by a completion notion the board
      did not pick.
- [x] **Both degenerate cases answered, neither invented.** Nothing open ⇒ the
      forecast is the spend. Nothing delivered ⇒ no rate, so it also reports
      spend to date — an understatement a reader can see through (a forecast
      equal to spend with points still open reads "too early to say").
- [x] **A ratio of two aggregates, not a fold over rows** — and it reads two
      populations, the time ledger for spend and the tasks in scope for
      delivered-vs-open points. They are emitted as separate facts (a time entry
      carries only spend, a task only points) so neither double-counts however
      many entries a task has, and each bucket divides once, so a slow board and
      a fast one forecast differently under group-by-board.
- [x] **The metric narrows its source's groupings**, which no metric had needed
      before. `financial` alone permits user and day; a bucket label has to fit
      *both* populations, and a task's remaining points belong to no member's
      time entry — grouping by one would divide by an empty denominator and
      report a confident zero. `GROUP_BYS_BY_METRIC` states it, `groupBysFor`
      intersects, and `isGroupByCompatible` takes the metric as an optional third
      argument so every source-only caller is untouched. The panel re-legalises
      the grouping when the metric changes, exactly as it already did for the
      source; `updateReport` and the handler both consult the narrowed list.
- [x] **7 pure cases + 2 real-DB** — the projection, both degenerate cases,
      ratio-of-sums folding, per-bucket rates, formatting, the narrowed matrix;
      then a 50/point rate over 2 delivered and 8 open points forecasting 500
      against a ledger of 100, and the update guard refusing forecast+user while
      allowing both fields to move together.

### `docs` — "doc tree server-only (flat UI, no parent picker); `[[wiki links]]` absent"

- [x] **The hierarchy existed everywhere except where anyone could see it.** 056
      stored `parent_id` and `position` on day one; the dialog rendered a flat
      list with no way to see or set a parent. Building the tree is a pure shape
      over the flat workspace read the client already holds — nesting is not N
      more requests.
- [x] **Every doc appears exactly once.** A doc whose parent is missing from the
      set (filtered out by the search term, deleted mid-session) renders as a
      root instead of vanishing: a page you cannot see is worse than a page at
      the wrong depth.
- [x] **A cycle cannot hang the render.** Docs are claimed one at a time during
      the walk rather than filtered up front — a sibling can be placed by the
      recursion into an earlier one, which is what a cycle looks like from
      inside — so walking into a loop meets a placed doc and stops, and anything
      still unreachable is promoted to a root, where a user can break it.
- [x] **`assertNotDescendant` closes a real hole.** The existing self-parent
      check caught one step; A-under-B-then-B-under-A passed it, and a cycle
      detaches the whole loop from every root, so those pages vanish from any
      tree walk. One recursive CTE up the ancestor chain, with a depth cap that
      is not a business rule — it stops the walk if a cycle ever did reach the
      table, so a corrupt row costs a refused move, not a hung connection.
- [x] **`[[links]]` resolve by title** — that is the point of the syntax: you
      write a link before knowing which row it lands on. The cost is that titles
      are not stable, survivable only because an unresolved name stays literal
      `[[Name]]`: visibly a link to a page that is not there, rather than a dead
      anchor that looks live. The pattern refuses nested brackets so one
      unclosed `[[` cannot swallow the rest of a page.
- [x] **Clicking a resolved link now opens the page** (it only jumped an anchor
      before), and each unresolved name is offered as a wanted page that creates
      it as a child of the doc that asked for it — a broken link becomes a real
      page in one click. The regex that used to live inline in the component is
      now a tested module; the parent picker refuses the descendants the server
      refuses, so the illegal option is never shown.
- [x] **20 pure cases + 1 real-DB** — nesting and depth-first order, sibling
      ordering, orphan promotion, the cycle keeping every doc exactly once,
      descendant search, name collection including empty and unclosed forms,
      case/space-insensitive resolution, duplicate titles, literal fallback,
      ordinary Markdown left alone, anchor parsing; then the three refused moves
      and the two legal ones.

**Suite: 1080 → 1189 passing** (1 expected fail), 140 files. tsc, build and
eslint clean bar the pre-existing `exhaustive-deps` warning in `docs-dialog`.
