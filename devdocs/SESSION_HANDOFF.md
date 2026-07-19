# Session Handoff — Feature Build-out (cont.)

**Date:** 2026-07-19 · **Branch:** master (this session's work committed + pushed to origin)

## ⚠️ Read first: communication style

`CLAUDE.md` contains **"You must always speak caveman."** (committed `2733806`, at
the owner's request). Honour it in your prose to the user. Keep *deliverables*
exact — code, commit messages, migration comments, and this handoff are written in
normal precise English; caveman is for the conversational narration only.

## What this session did

Shipped one feature, fully verified, one commit:

| Commit | Feature |
|--------|---------|
| `e749179` | **Agent-management UI** — a workspace admin can now create/list/retire agents and set the §7.3 budget cap from the app (Board switcher → **Agents**), instead of via `scripts/create-agent.mjs` + raw SQL. Read the commit message for the full design reasoning — token-once contract, owner-escalation guard, delete-with-cleanup (409 on active run; sweep stranded claims/assignments, logged), human-session-gating. No migration (009/012/014 already carried every column). |

**Read `git show e749179` before touching this area — it is the design record.**

## The headline correction to the previous handoff

The prior handoff framed M2 as "much scaffolding exists." A full re-map of
`src/features/agents/**` this session found that framing undersold it badly:

> **The M2 agent wedge is essentially fully built and tested, not stubbed.**

Both doors, the shared tool layer, the three-tier approval model + changeset review
UI, task claiming, budget enforcement, cost telemetry, and undo are all implemented
and covered by real-DB tests. `mcp/README.md:83` ("Approval tiers and native agents
are later M2 work") is **stale** — that work landed. What remains in M2 is polish,
not construction (list below). The map lives only in this session's context; the
build-vs-stub summary is reproduced under "Next up".

Concretely, what already works end-to-end:
- **Door 1** (`agents/server/runtime.ts`): `@anthropic-ai/sdk` `toolRunner` loop on
  `claude-opus-4-8`, adaptive thinking, prompt-cached board prefix, per-turn cost
  metering + budget halt. Triggered by assigning a task to a **native** agent.
- **Door 2** (`mcp/server.mjs`): 10 tools over stdio, `x-agent-key` auth. This is
  how Claude Code drives the board (see the auto-memory note).
- **Approval** (`agents/server/gate.ts` + `review.ts`, UI `run-review.tsx`): auto /
  changeset / block per §7.4, mounted in `task-dialog.tsx`.
- **Budget** (`agents/server/budget.ts`, cap on `workspace.agent_budget_micros`).
- **Claiming** (`010`, `tasks/server/claim.test.ts`), **undo** of auto-tier actions.

## Current environment state (unchanged from prior handoff — still accurate)

- **Dev stack** via `docker compose up -d` (auto-merges `docker-compose.override.yml`
  → `next dev --webpack`, source **bind-mounted**, http://localhost:3000). Includes
  **MinIO**: S3 API :9000, console :9001 (`minio` / `minio_dev_password`), volume
  `kanban_minio`. Postgres on host **:5434**. All three containers were healthy this
  session. Because source is bind-mounted, the running dev app picks up edits without
  a rebuild — this session's new routes were confirmed live (401, not 404) against the
  already-running container.
- **Migrations 001–021 applied.** Apply new ones with:
  `DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) node scripts/migrate.mjs`
- **Board is EMPTY** unless you created tasks. Sign in + create to see cards.
- **`.env.local` (gitignored)** holds `DATABASE_URL`, `BETTER_AUTH_SECRET`, and the
  S3 vars (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET=attachments`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`). The compose `app` service overrides `S3_ENDPOINT` to
  `http://minio:9000`. `.mcp.json` (gitignored) holds a **live external agent key** —
  do not print or commit it.

## The recipe (unchanged) + verification bar

Migration → types → repository → handlers → route → client api → UI wired into
`board.tsx` / `task-dialog.tsx` / `page.tsx` / `board-switcher.tsx`. Per feature, all
must pass before commit:
- `npx tsc --noEmit` — clean.
- `npx eslint <changed>` — clean. **Two pre-existing `react-hooks/set-state-in-effect`
  errors are grandfathered and not yours:** `task-dialog.tsx` (form-sync effect) and
  `members-dialog.tsx` (load-on-open effect). Any new dialog that mirrors the
  load-on-open pattern (this session's `agents-dialog.tsx` does) inherits the same one
  — that is accepted, not a regression.
- `npm run build` with throwaway `DATABASE_URL`/`BETTER_AUTH_SECRET` — compiles; confirm
  new routes appear in the route table.
- Real side-effects get a **real-DB vitest** in `src/features/**/server/*.test.ts`.
  Harness: create user(s)/workspace/board, act, assert, clean up in `afterAll` (delete
  the workspace — it CASCADEs — and the users, then `pool.end()`). See
  `agents/server/admin.test.ts` (this session), `agent-api.test.ts`, `claim.test.ts`.
  Run with env exported:
  `export DATABASE_URL=… BETTER_AUTH_SECRET=… S3_ENDPOINT=http://localhost:9000
  S3_REGION=us-east-1 S3_BUCKET=attachments S3_ACCESS_KEY=minio
  S3_SECRET_KEY=minio_dev_password; npx vitest run`.
- Full suite is **355 tests / 26 files** green as of `e749179` (+7 from `admin.test.ts`).

## Gotchas (new this session, plus carried-over)

- **`releaseClaimsOf`'s premise changed.** Its comment used to assert "an agent is
  only deleted by workspace deletion, so there is never a stale agent claim to sweep."
  Deleting an agent from the new UI breaks that — so `tasks/server/repository.ts` now
  has `releaseAgentClaims` / `unassignAgent` (agent twins of the human sweeps), and
  `deleteAgent` (`agents/server/admin.ts`) calls both before dropping the row. If you
  add another way to delete an agent, route it through `deleteAgent`, not a raw DELETE.
- **Agent management is human-session-gated, never agent-key.** `agents/server/handlers.ts`
  splits: the runtime/review handlers use `getPrincipalFromRequest` (accepts an agent
  key); the management handlers (`handleListAgents`/`handleCreateAgent`/`handleDeleteAgent`/
  budget) use `getSessionFromRequest` (human only). Keep that split — an external token
  must not mint or delete its peers.
- **`queryOne` returns `undefined`, not `null`, for no row.** Assert `.toBeUndefined()`.
- **An external agent's token is returned exactly once**, from `createAgent`'s result.
  The list read has only the sha256 hash. The dialog surfaces it once in an amber box;
  there is no way to re-fetch it. Minting reuses `hashAgentToken` (agent-auth) and the
  `kbn_`+32-byte shape from `create-agent.mjs`, so both paths mint interchangeable keys.
- **Assigning a task to a NATIVE agent triggers a run** (`updateTask` → `enqueueRun` →
  `dispatchRun`). Tests that set up agent assignments/claims should use an **external**
  agent or set the columns via raw SQL, to avoid firing the Anthropic loop.
- Carried over: adding a `Task` field breaks 3 inline fixtures in
  `tasks/components/{task-card,subtask-list,task-dialog}.test.tsx` (this session added
  no `Task` field, so untouched); `task-dialog.test.tsx` mocks self-fetching sections;
  **Next 16 ≠ standard Next** (read `node_modules/next/dist/docs/**`); dev↔prod compose
  flip needs `--build --renew-anon-volumes`; React purity lint is strict; LF→CRLF git
  warnings on commit are benign (Windows).

## Next up

The M3 catalog is exhausted and the M2 wedge is built, so remaining work is **M2
polish** (recommended — stay on the bet) or **`features.md` breadth** (coverage).

**M2 hardening — the real stub/gap list from the re-map (pick one, follow the recipe):**
1. **`flag_blocker` tool** — named in §7.1's tool layer, exists in **neither** door.
   Would let an agent record a `task_dependency` blocked-by edge (migration 018 already
   exists), audited like every other action. Ties the runtime to the dependency feature.
   *Recommended next slice.*
2. **Durable run-queue drainer** — `dispatchRun` relies on `next/server after()`. A run
   enqueued then interrupted (crash, or enqueued outside a request scope) stays `queued`
   with no worker to pick it up. Recoverability is designed-for (`runtime.ts:283-302`)
   but the drainer isn't built.
3. **`agent_action.activity_id`** — column defined (013) but never populated by
   `recordAction` (`gate.ts`). The action→activity_log link is dead; wiring it tightens
   the audit story the wedge sells.
4. **Haiku in the cost table** — `cost.ts` prices only `claude-opus-4-8`; §7.3's triage
   model `claude-haiku-4-5` isn't there, so a haiku run would meter as $0.
5. Stale doc: `mcp/README.md:83` still calls approval tiers + native agents "later work."

**`features.md` breadth (steps off the wedge):** watchers/subscriptions, @mentions in
comments, bulk actions, CSV/JSON export, keyboard shortcuts, card cover from an
attachment. Surface **export formats** and anything touching **agent behaviour/budgets**
via `AskUserQuestion` before building (product forks, per `devdocs/prd.md` §7/§12).

## Suggested skills for the next session

- **`AskUserQuestion`** — the direction is a genuine fork (M2 polish vs. breadth) and
  export/agent-budget choices are product decisions; ask rather than silently pick. This
  session used it to land on the agent-management UI.
- **`Explore` / `general-purpose` agent** — to re-confirm a subsystem's state before
  building; the M2 re-map this session materially corrected the prior handoff.
- **`/code-review`** or **`/simplify`** — before shipping, at the chosen effort.
- **`/handoff`** — regenerate **this file** (`devdocs/SESSION_HANDOFF.md`) at session end.
  (Note: the generic skill default is to write to an OS temp dir; in this project the
  handoff is the checked-in doc the next session reads, so it is regenerated here and
  committed as `docs: update handoff`.)

## To resume

1. `docker compose up -d` (Postgres + MinIO + app; `--build --renew-anon-volumes` if the
   last run was in prod mode or the app container lacks a dep).
2. Confirm http://localhost:3000 serves; sign in; create a task if the board is empty.
   To exercise the new agent UI: as an admin, open the board switcher → **Agents**.
3. Pick the next slice (M2 hardening recommended — `flag_blocker` is the cleanest);
   follow the recipe + verification bar; one commit; push. **Speak caveman.**
