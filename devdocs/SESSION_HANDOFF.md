# Session Handoff — Feature Build-out

**Date:** 2026-07-19 · **Branch:** master (all work merged + pushed to origin)

## What this session is doing

Building features into the kanban app, picking from the 140-criterion reference
model in `docs/task_management_feature_summary.md` (identical copy at
`devdocs/features.md`). Product intent + milestone map: `devdocs/prd.md` — the
wedge is **agent-native coordination**; the features below are the M3 "Views" +
Core Work Items build-out, pulled ahead of the M2 agent wedge at the owner's
request.

One fully-verified feature per commit. Do not batch features into one commit.

## Shipped this session (see `git log`, newest first)

| Commit | Feature |
|--------|---------|
| `afb1dc4` | Checklists — per-task text+tick items, `2/5` card badge (migration 017) |
| `57b9160` | Notification bell — workspace activity feed + unread (migration 016) |
| `c8d7d89` | Saved views — private named filter+lens (migration 015) |
| `746db73` | List + Calendar views + view switcher |
| `cc39e30` | Search + filter bar (client-side) |
| `2fce6c3` | Self-host Geist fonts (offline build) |
| `8f827bc` | Docker: slim standalone runner, split migrations, healthcheck, non-root |
| `7e806ca` | Docker dev override (live-reload) |
| `d090d20` | Fix: install `@better-auth/cli` so container boot stops crash-looping |

Read each commit message for the design reasoning; not duplicated here.

## Current environment state

- **Dev stack running** via `docker compose up -d` (auto-merges
  `docker-compose.override.yml` → `next dev --webpack`, bind-mounted, live at
  http://localhost:3000). Postgres on host port **5434** (container 5432).
- **Migrations 001–017 applied** to the running DB. Apply new ones with:
  `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) node scripts/migrate.mjs`
- **The board is EMPTY** — a fresh-volume test earlier wiped `kanban_pgdata`
  (user-approved). Sign in and create a task to see cards/badges.

## The recipe for adding a feature (followed by every commit above)

A DB-backed feature = these files, mirroring the `labels` and `views` slices:

1. `src/shared/db/migrations/0NN_name.sql` — heavy header comment explaining the
   one real decision. FK targets: `workspace(id)` TEXT, `"user"(id)` TEXT.
2. `src/features/<name>/types.ts` — TS types (source of truth for shape).
3. `src/features/<name>/server/repository.ts` — SQL + authz. Use
   `query`/`withTransaction` from `@/shared/db/client`; authz via
   `requireWorkspaceRole` / `requireTaskRole` / a `require<Thing>Role` resolver.
   `AuthzError` has `.kind` = `"not_found" | "forbidden" | "conflict"`. Missing/
   cross-tenant → `not_found` (never leak existence).
4. `src/features/<name>/server/handlers.ts` — `getSessionFromRequest` (human) or
   `getPrincipalFromRequest` (agent-capable, like activity/labels reads);
   validate shape → 400; `authzErrorResponse(error)` for the rest.
5. `src/app/api/.../route.ts` — thin: `await params`, delegate to a handler.
6. `src/features/<name>/client/api.ts` — `fetch` + a `jsonOrThrow` helper.
7. UI: a client component; wire into `board.tsx` (owns all board state) or
   `task-dialog.tsx` (mounts self-contained sections for an open task) or
   `page.tsx` header. Card fields are read once in
   `src/features/tasks/server/task-row.ts` `taskColumns()` (the single place to
   add a queryable/derived task field) and typed on `Task` in
   `src/features/tasks/types.ts`.

Verification bar per feature (all must pass before commit):
- `npx tsc --noEmit` — clean.
- `npx eslint <changed files>` — clean. (Known pre-existing error at
  `task-dialog.tsx:172`, the form-sync effect — not yours, leave it.)
- `npm run build` with throwaway `DATABASE_URL`/`BETTER_AUTH_SECRET` — compiles;
  confirm new routes appear in the route table.
- Exercise DB features against real Postgres via `docker exec kanban-postgres
  psql -U kanban -d kanban -c "..."` (the app is auth-gated so curl can't reach
  authed endpoints; validate the SQL directly — upserts, aggregates, filters).
- `npx vitest run <affected>` if you touched anything with tests. Note: adding a
  `Task` field breaks 3 inline fixtures in
  `src/features/tasks/components/*.test.tsx` — update them.

## Gotchas

- **Next 16 is not standard Next** (`AGENTS.md`): read `node_modules/next/dist/
  docs/**` before using an unfamiliar API. Turbopack is the default bundler;
  dev override forces `--webpack` for reliable polling on the Windows host.
- **Dev↔prod mode flip needs a full rebuild:** prod app image = slim `runner`
  target (no `next` binary), dev = `builder`. After switching, run
  `docker compose up -d --build --renew-anon-volumes` or you get
  `next: not found` from a stale `/app/node_modules` anon volume.
- **React purity lint is strict:** no `Date.now()` in render (use a `now` state
  set after an `await`); define fetch-on-mount functions *inside* the effect so
  setState lands after the await. See `notification-bell.tsx` /
  `activity-feed.tsx`.
- **`@better-auth/cli` is on its own version track** (latest ~1.4.x) — do NOT
  pin it to the `better-auth` core version (1.6.x → ETARGET).
- LF→CRLF git warnings on commit are benign (Windows).
- Checklist decision: checklist mutations do **not** write activity_log rows
  (documented in migration 017) — reuse that reasoning for other fine-grained
  content.

## Next up (catalog picks, recommended order)

1. **Task dependencies** (Planning & Views) — `blocked_by` / `depends_on`
   edges. Needs: migration `018_dependency.sql` (task_dependency table, unique
   edge, no self-dep, same-board CHECK), **cycle prevention** on insert
   (recursive CTE reachability check), repo/handlers/routes/client, UI in
   task-dialog ("Blocked by" picker) + a "blocked" indicator on the card.
   Caveat: "blocked vs unblocked" needs a completion notion, but columns are
   user-defined — ship the *relationship* (the criterion) first; a done-state
   badge is a follow-up.
2. **Recurring tasks** (Core) — recurrence rule + when-to-spawn (on-complete or
   scheduled). Product call needed on the spawn trigger.
3. **Task templates** (Core) — save a task shape, instantiate it.
4. **Attachments** (Core) — **needs a storage decision** (local disk / S3 /
   Postgres bytea); ask the user before building.

Do NOT silently pick attachments/recurring without surfacing their product
forks (storage backend; spawn trigger) — use `AskUserQuestion`.

## Suggested skills for the next session

- **`/handoff`** — regenerate this doc at the end of the next session.
- **`AskUserQuestion`** (tool) — for the storage/spawn-trigger product forks above.
- **`/code-review`** or **`/simplify`** — before shipping, to catch bugs /
  tighten the diff at the chosen effort level.
- **`Explore` agent** — to re-map any subsystem you're unfamiliar with (the
  board frontend map from this session is captured implicitly in the commits).
- **`improve`** — if the user wants a fresh prioritized roadmap rather than
  continuing the catalog walk.

## To resume

1. `docker compose up -d` (dev stack; `--build --renew-anon-volumes` if it was
   last run in prod mode).
2. Confirm http://localhost:3000 serves; create a task if the board is empty.
3. Pick the next feature (task dependencies recommended); follow the recipe +
   verification bar above; one commit; merge to master; push.
