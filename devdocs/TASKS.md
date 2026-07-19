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
Migrations are numbered in `src/shared/db/migrations/` and applied 001–027.

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

---

## Next up — candidates, roughly by value

### Agile & Product (largest remaining coherent cluster)
- [ ] **Sprints / iterations** — a `sprint` table (board-scoped, start/end),
      `task.sprint_id`; the estimate + done-column machinery is already in place.
- [ ] **Velocity** — points completed per sprint; reads the same done-column
      signal `analytics.ts` already folds.
- [ ] **Burndown chart** — remaining points over a sprint's days; another SVG in
      the Insights dialog's shape.
- [ ] **Backlog** — an unscheduled queue distinct from board columns.

### M2 hardening (leftovers from the pre-sweep handoff — stay on the wedge)
- [ ] **`flag_blocker` tool** — record a `task_dependency` blocked-by edge from an
      agent; named in §7.1, exists in neither door. Cleanest next M2 slice.
- [ ] **Durable run-queue drainer** — `dispatchRun` relies on `after()`; a run
      enqueued then interrupted stays `queued` with no worker.
- [ ] **`agent_action.activity_id`** — column defined (013), never populated by
      `recordAction`; wiring it closes the action→activity link.
- [ ] **Haiku in `cost.ts`** — §7.3's triage model prices as $0 today.
- [ ] **Stale doc** — `mcp/README.md:83` still calls approval tiers "later work".

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
