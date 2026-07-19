# Session Handoff — Feature Breadth Sweep

**Date:** 2026-07-19 · **Branch:** master

## ⚠️ Read first: communication style

`CLAUDE.md` contains **"You must always speak caveman."** Honour it in your prose
to the user. Deliverables — code, commits, migrations, this handoff — stay in
normal precise English; caveman is conversational narration only.

## What this session did

The largest single-session build-out so far: **nine feature batches, nine feature
commits + one security fix**, working through `docs/task_management_feature_summary.md`
(the 140-criterion reference model), which now carries a ✅/❌ status mark on every
row. Each batch followed the recipe (migration → types → repository → handlers →
route → client → UI) with real-DB tests, tsc/eslint/build clean per batch.

| Commit | Feature |
|--------|---------|
| `50fc0f8` | **Task type + estimate** (022) — task/bug/story enum + story points; TypeMark and estimate chip on cards; fixes a pre-existing tsc error in `admin.test.ts`. |
| `af84a4f` | **WIP limits** (023) — `board_column.wip_limit`; "4/3" header goes loud when over, never blocks; member-gated editor in the column header. |
| `813cdfa` | **Bulk edit** — POST `/api/tasks/bulk` loops per-task mutations (each keeps authz + log rows); checkbox column + bulk bar in the list view. |
| `7824deb` | **CSV/JSON export** — GET `/api/board/[id]/export`; RFC-4180, names via listAssignees (email-free), subtasks included; Export dropdown. |
| `cc54dd0` | **@mentions + comment resolution** (024) — server-parsed `comment_mention` (exact member name after `@`); bell says "mentioned you on"; resolve/reopen member-gated with two new actions. |
| `a79ec40` | **Flow insights** — `/api/board/[id]/analytics` replays activity_log (lead/cycle time, weekly throughput, 30-day CFD) + workload; SVG charts in an Insights dialog. |
| `d521a7c` | **Outbound webhooks** (025) — activity stream over HTTP, HMAC-signed (x-kanban-signature-256), queued post-commit from `logActivity` via after(); admin/human-only management in board switcher. |
| `29b5319` | **SSRF gate** — webhook targets refuse loopback/RFC1918/link-local/metadata literals; `WEBHOOK_ALLOW_PRIVATE_NETWORK=1` is the self-hosted escape hatch (tests set it). |
| `ddff98f` | **Milestones** (026) — board-scoped, task.milestone_id SET NULL on delete; progress vs done column; picker in task dialog, Milestones dialog, export column, `milestone.*` actions. |
| `feb486c` | **Time tracking** (027) — `time_entry` minutes ledger; viewer-open logging, own-or-admin delete; `time.logged/deleted` actions with TimeSnapshot; Time section in the task dialog. |

Read each commit message before touching its area — they are the design records.

## Migrations

**001–027 applied** (022 type/estimate, 023 wip_limit, 024 comment thread,
025 webhook, 026 milestone, 027 time_entry). Apply with
`DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) node scripts/migrate.mjs`.

## Gotchas (new this session, plus carried-over)

- **A new snapshot family costs four touches**: the `*Action` union + `*Snapshot`
  in `activity/types.ts`, the `Activity` union arm (feed rendering narrows on it),
  the `ActivityInput` arm in `activity/server/repository.ts`, and bell verbs in
  `notification-bell.tsx`. Milestone and Time both walked this path — copy them.
- **`logActivity` now queues webhook delivery** (`webhooks/server/dispatch.ts`)
  and RETURNING id. Delivery re-reads the row post-commit (rollback-safe) and is
  a no-op outside a request scope; tests call `deliverActivity` directly.
- **Webhook tests need `WEBHOOK_ALLOW_PRIVATE_NETWORK=1`** in the env (they
  deliver to a 127.0.0.1 listener the SSRF gate rightly refuses otherwise).
- **The 3 inline Task fixtures** (`task-card/subtask-list/task-dialog.test.tsx`)
  grew `type`, `estimate`, `milestoneId`; the next Task field grows them again.
  `board-column.test.tsx` now inlines a Column (wipLimit). `task-dialog.test.tsx`
  mocks TimeSection alongside the other self-fetching sections.
- **Milestone tenancy**: `assertMilestoneOnBoard` refuses cross-board aims with
  not_found (anti-oracle). Deleting a milestone is member-level because SET NULL
  un-aims without destroying.
- Carried over: `queryOne` returns `undefined`; external-agent tokens (and now
  webhook secrets) surface exactly once; assigning a task to a NATIVE agent fires
  a run (tests use external agents); Next 16 ≠ standard Next; grandfathered
  `react-hooks/set-state-in-effect` in task-dialog/members-dialog (agents-dialog,
  and any load-on-open dialog, inherits it); LF→CRLF warnings benign.

## Verification bar (unchanged) + suite size

tsc clean; eslint clean (grandfathered errors only); `npm run build` compiles
with routes visible; real-DB vitest per feature. Full suite is now
**390 tests / 36 files** (was 355/26).

## The feature-summary scoreboard

`docs/task_management_feature_summary.md` now marks all 140 rows: **55 ✅ / 85 ❌**.
The ❌s cluster where the honest answer is "different product" (docs/wiki, chat,
sprints/Scrum, portfolio, SAFe), "certification not code" (SOC 2, ISO, HIPAA,
uptime SLA), or "hosted-vendor integration" (Slack, Teams, Google/M365, Zapier).

## Next up (candidates, roughly by value)

1. **Sprints/velocity/burndown** — the largest remaining coherent cluster;
   estimate + done-column machinery is now in place to compute both charts.
2. **M2 hardening leftovers from the previous handoff** — `flag_blocker` tool,
   durable run-queue drainer, `agent_action.activity_id`, Haiku pricing in
   `cost.ts`, stale `mcp/README.md:83`.
3. **Timeline view** — needs a start-date field; estimate/milestone groundwork helps.
4. **Threaded comments / rich text** — steps toward the Collaboration column.
5. **Agent tools for the new fields** — set_estimate/set_type/aim_at_milestone in
   both doors, so the wedge can use what this session built.

## To resume

1. `docker compose up -d`; confirm http://localhost:3000; migrations are applied
   in the dev DB already.
2. Exercise the new UI: list view checkboxes (bulk bar), board header (Milestones /
   Insights / Export), column menu (WIP limit), board switcher (Webhooks), task
   dialog (Type, Estimate, Milestone, Time, comment Resolve).
3. Pick the next slice; follow the recipe + verification bar; one commit per
   feature; push. **Speak caveman.**
