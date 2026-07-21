# Task List — Feature Build-out

A durable, checkable record of feature work: what has shipped (with the commit
that proves it) and what is queued next. Update it in the same commit as the
work — a task marked done here should always point at a real commit, and a task
added here is the next session's starting menu.

Companion docs: `SESSION_HANDOFF.md` (per-session narrative + gotchas),
`prd.md` (the milestone bet), `features.md` (breadth catalogue),
`../docs/task_management_feature_summary.md` (the 140-criterion scoreboard,
55 ✅ / 85 ❌).

Convention: `[x]` done → cite the commit; `[ ]` open → one line on the slice.
Migrations are numbered in `src/shared/db/migrations/` and applied 001–031.

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
- [ ] **set_estimate / set_type / aim_at_milestone / log_time** in both doors
      (runtime `tools.ts` + `mcp/server.mjs`), gated like the existing tools.

### Planning & Views breadth
- [ ] **Timeline view** — needs a task start-date field; estimate/milestone
      groundwork helps.
- [ ] **Goals/OKRs** — link tasks/milestones to measurable objectives.

### Collaboration breadth
- [ ] **Threaded comments** — replies under a comment (parent_id on `comment`).
- [ ] **Rich text** — task/comment bodies beyond plain TEXT (sanitised — an agent
      writes here).

> Anything touching **agent behaviour/budgets** or **export/product forks** should
> go through `AskUserQuestion` before building (per `prd.md` §7/§12).
