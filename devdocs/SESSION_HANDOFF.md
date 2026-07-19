# Session Handoff — Feature Build-out (cont.)

**Date:** 2026-07-19 · **Branch:** master (all work merged + pushed to origin)

## ⚠️ Read first: communication style

`CLAUDE.md` now contains **"You must always speak caveman."** (committed `2733806`,
at the owner's request). Honour it in your prose to the user. Keep *deliverables*
exact — code, commit messages, migration comments, and this handoff are written in
normal precise English; caveman is for the conversational narration only.

## What this session did

Continued the M3 "Views + Core Work Items" build-out from the 140-criterion
reference model (`docs/task_management_feature_summary.md` = `devdocs/features.md`;
product intent + milestones in `devdocs/prd.md`; wedge = **agent-native
coordination**). One fully-verified feature per commit. This session cleared the
entire "Next up" catalog the prior handoff listed.

## Shipped this session (newest first — read the commit messages for design reasoning)

| Commit | Feature |
|--------|---------|
| `10d7425` | **Blocked-vs-unblocked card state** — completes 018's deferred criterion using 020's done column. Derived `Task.blockedByOpenCount` (blockers not yet in their board's done column); card reads red "blocked by N unfinished" vs muted "depends on N". Derived-only, no migration. |
| `c9ab1cb` | **Attachments** — files on a task; metadata in PG, bytes in S3-compatible store (MinIO local). Migration 021 + `attachment` table. Proxy upload/download (authz per byte), not presigned. |
| `3e4424c` | **Recurring tasks** — daily/weekly/monthly, spawn-on-complete. Migration 020: `board.done_column_id` + `task_recurrence`. Completion = moving a recurring task into the board's designated done column; successor born in first column, rule handed over. |
| `2733806` | docs: caveman rule in CLAUDE.md |
| `2c59cae` | **Task templates** — workspace-scoped saved task shape (title/desc/priority/labels); instantiate = prefill the New-task form. Migration 019 + `task_template` + `template_label`. |
| `fa22d76` | **Task dependencies** — `blocked_by` edges, cycle prevention (board-scoped advisory lock + reachability CTE). Migration 018 + `task_dependency`. |

Prior session's shipped list: see the git log below `fa22d76` (checklists,
notification bell, saved views, list/calendar views, search/filter, Docker, fonts).

## Current environment state

- **Dev stack** via `docker compose up -d` (auto-merges `docker-compose.override.yml`
  → `next dev --webpack`, bind-mounted, http://localhost:3000). Now includes a
  **MinIO** service (added `c9ab1cb`): S3 API host **:9000**, console **:9001**
  (user `minio` / pass `minio_dev_password`), volume `kanban_minio`. Postgres on
  host **:5434**.
- **Migrations 001–021 applied.** Apply new ones with:
  `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) node scripts/migrate.mjs`
- **Board is EMPTY** unless you created tasks. Sign in + create to see cards.
- **`.env.local` (gitignored)** now also holds `S3_ENDPOINT` (http://localhost:9000
  for host runs), `S3_REGION`, `S3_BUCKET=attachments`, `S3_ACCESS_KEY=minio`,
  `S3_SECRET_KEY=minio_dev_password`. The compose `app` service overrides
  `S3_ENDPOINT` to `http://minio:9000`. A fresh checkout must recreate these for a
  host `npm run dev`; the containerized stack works out of the box.
- **`@aws-sdk/client-s3`** is now a dependency. If the dev **app container** needs
  attachments at runtime, rebuild it (`docker compose up -d --build
  --renew-anon-volumes`) so its node_modules anon volume picks up the new dep — the
  host has it already for `npm run dev`/tests.

## The recipe (unchanged) + verification bar

The DB-backed feature recipe is unchanged from the prior handoff (migration →
types → repository → handlers → route → client api → UI wired into `board.tsx` /
`task-dialog.tsx` / `page.tsx`). Verification bar per feature, all must pass before
commit:
- `npx tsc --noEmit` — clean.
- `npx eslint <changed>` — clean. **Known pre-existing error at `task-dialog.tsx`
  in the form-sync effect (`react-hooks/set-state-in-effect`, now ~line 201 after
  this session's additions) — not yours, leave it.**
- `npm run build` with throwaway `DATABASE_URL`/`BETTER_AUTH_SECRET` — compiles;
  confirm new routes appear.
- Exercise DB features against real Postgres via `docker exec kanban-postgres psql`
  (auth-gated app; can't curl authed endpoints). For features with real
  side-effects (recurrence spawn, S3 round-trip), prefer a **real-DB vitest** in
  `src/features/**/server/*.test.ts` — see `recurrence.test.ts` and
  `attachments.test.ts` for the harness (they create a user/workspace/board, act,
  assert, and clean up in `afterAll`). Run them with the env exported:
  `export DATABASE_URL=… BETTER_AUTH_SECRET=… S3_ENDPOINT=http://localhost:9000
  S3_REGION=us-east-1 S3_BUCKET=attachments S3_ACCESS_KEY=minio
  S3_SECRET_KEY=minio_dev_password; npx vitest run`.
- Full suite is **348 tests / 25 files** green as of `10d7425`.

## Gotchas (new this session, plus carried-over)

- **Adding a `Task` field breaks 3 inline fixtures** in
  `src/features/tasks/components/{task-card,subtask-list,task-dialog}.test.tsx`.
  The card now carries six derived counts/flags via correlated subqueries in
  `taskColumns()` (`src/features/tasks/server/task-row.ts`): `subtaskCount`,
  `blockedByCount`, `blockedByOpenCount`, `recurrence`, `attachmentCount`,
  `checklist`. Each is one subquery per board row — fine at current scale, revisit
  when boards paginate.
- **`task-dialog.test.tsx` mocks the self-fetching sections** (subtask-list,
  dependency-section, attachment-section) so the dialog test stays hermetic. Add a
  `vi.mock` for any new self-fetching section you mount in the dialog.
- **Recurrence completion notion** = `board.done_column_id`, set from a column's
  menu (admin). The spawn lives in `moveTask` (crossing detection). Deleting the
  done column `SET NULL`s the designation.
- **Attachments seam**: a CASCADE reaches rows, never S3 objects. `deleteAttachment`
  removes the object by hand; a **task-delete cascade orphans objects** (documented
  in 021 — a future key-sweep reclaims them; nothing in the DB dangles).
- Carried over: **Next 16 ≠ standard Next** (read `node_modules/next/dist/docs/**`
  before unfamiliar APIs); dev↔prod compose flip needs `--build
  --renew-anon-volumes`; React purity lint is strict (no `Date.now()` in render);
  LF→CRLF git warnings on commit are benign (Windows).

## Next up — the prior catalog is exhausted

Suggested directions, pick with the owner if unsure:

1. **Return to the M2 agent wedge** (the product's actual differentiator per
   `devdocs/prd.md` §7 — agent tools, changeset review, budgets). Much of the
   scaffolding exists (`agent`, `agent_run`, `agent_budget`, native-agent runs, MCP
   door). This is where the product bet is; M3 was pulled ahead of it.
2. **More `features.md` criteria** not yet built — skim the 140 for high-value
   gaps (e.g. task **watchers/subscriptions**, **@mentions in comments**, **card
   cover images** (attachments already give the storage), **bulk actions**, **task
   relations beyond blocked_by**, **CSV/JSON export**, **keyboard shortcuts**).
3. **Attachments follow-ups**: the orphaned-object sweeper; presigned URLs for
   large files; inline image preview / card cover from an attachment.

(The prior "blocked vs unblocked" dependency follow-up was completed this
session — `10d7425`.)

Product forks to surface via `AskUserQuestion` before building (don't silently
pick): anything touching agent behaviour/budgets (§7), and export formats.

## Suggested skills for the next session

- **`AskUserQuestion`** — for the product forks above (agent-wedge scope, export
  formats).
- **`/code-review`** or **`/simplify`** — before shipping, at the chosen effort.
- **`Explore` agent** — to re-map the agent subsystem (`src/features/agents/**`) if
  picking direction 1; it's the least-touched area this session.
- **`/handoff`** — regenerate this doc at the end of the next session.

## To resume

1. `docker compose up -d` (dev stack incl. Postgres + MinIO; `--build
   --renew-anon-volumes` if last run in prod mode or the app container lacks the
   new S3 dep).
2. Confirm http://localhost:3000 serves; create a task if the board is empty.
3. Pick the next direction (agent wedge recommended); follow the recipe +
   verification bar; one commit; push. **Speak caveman.**
