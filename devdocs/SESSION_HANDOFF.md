# Session Handoff — Kanban (2026-07-28)

**Repo:** `C:\Users\seanr\OneDrive\Documents\scrap\kanban` · **Branch:** `master` (pushed, clean)
**Head:** `bef98b5` · Session commits: `21be093`, `bef98b5` (plus the fast-forward that landed `9aa9731`)

---

## ⚠️ Read first

1. **`CLAUDE.md` says "You must always speak caveman."** Honour it in conversational prose to the user. Deliverables — code, commit messages, docs, this file — stay in normal precise English. (Last session drifted out of caveman partway; don't.)
2. **`AGENTS.md`: this is not the Next.js you know.** Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code.
3. **`devdocs/prd.md` §7/§12:** anything touching **agent behaviour/budgets** or **export/product forks** goes through `AskUserQuestion` *before* building. Both AI rocks and the extension capability change this session did exactly that — keep the practice.

## Where things stand

Phases 1, 2, 3, 5 complete; the code-review roadmap in `complete-code-review.md` §5 is now fully worked through. Durable records — read these rather than re-deriving:

| Doc | What it is |
|---|---|
| `devdocs/TASKS.md` | The task ledger. **Tail two sections are this session's work** and list what shipped and why. |
| `devdocs/SPEC.md` | The 53-rock build-out plan, phase by phase. |
| `complete-code-review.md` | 2026-07-25 audit; §5 is the priority roadmap (items 1–10). |
| `comprehensive-uat.md` | ~100-case UAT plan, **never executed**. User has explicitly deferred it until all other rocks are smashed. |
| `docs/task_management_feature_summary.md` | The 140-row scoreboard. Rows edited this session say what is *actually* true — keep it honest. |
| Prior handoffs (below in this file) | Phase 3 and feature-breadth eras. Useful for older gotchas only. |

## What this session did

Read the two commit messages — they are the design records and are deliberately detailed:

- **`21be093`** — truth pass on the two AI rocks the review called overclaims (4.4 workflow builder, 4.3 knowledge retrieval). New: `src/features/automations/server/{draft,validate}.ts`, `POST /api/board/[id]/automations/draft`, migration `084_knowledge_search_ranked.sql`.
- **`bef98b5`** — Phase 6/7/8 leftovers: eDiscovery (6.7) onto the real index with hold flags and reported truncation; extension capabilities (8.1) from one word to four read-only scopes.

**Survey result worth not repeating:** most Phase 6/7 rocks are genuinely shipped — SSO (6.1), SCIM (6.2), admin console (6.4), retention + legal hold (6.6), IP allowlist (6.8), all five Phase 7 integrations, and 6.3's `permission_grant` + central `can()`. 6.5 encryption already covers every secret the app stores itself (git tokens, integration OAuth, webhook signing keys); SCIM bearer tokens are owned by the better-auth plugin.

## Verification bar (met at handoff)

`npx tsc --noEmit` clean · `npm test` → **125 files / 998 passing / 1 expected fail** · `npm run build` clean · eslint clean except the grandfathered `react-hooks/set-state-in-effect` error in `src/features/admin/components/enterprise-controls.tsx:62` (pre-existing).

Hold the same bar per slice: migration → types → repository → handlers → route → client → UI, real-DB tests, one commit per feature.

## Gotchas learned this session

- **Migration 084 must be applied** (`npm run db:migrate`) before knowledge or eDiscovery tests pass. It adds STORED generated `search_tsv` columns and `pg_trgm`.
- **`word_similarity`, not `similarity`**, for the trigram fallback: whole-string `similarity` scores a one-word query against a multi-word title far below any usable threshold, so the fallback would look implemented and never fire.
- **`FROM t, q JOIN …` binds the JOIN to `q`.** Put a CTE cross-join *last* (`FROM task t JOIN … CROSS JOIN q`) or Postgres rejects the FROM-clause reference. Cost one debugging round in `ediscovery.ts`.
- **`label.color` is an enum** (`slate|red|amber|green|sky|violet|pink`), not a hex string.
- **Don't write template literals into test files via a bash heredoc** — the shell executes the backticks. Use the Write/Edit tools.
- `structured outputs` on `client.messages.create` typecheck fine as `output_config: { effort, format: { type: "json_schema", schema } }` with the installed SDK (`@anthropic-ai/sdk` ^0.112.1). Model id in use: `claude-opus-5`.
- Full-suite runs occasionally show one flaky `waitFor` timeout in a component test under load; it did not reproduce in three isolated runs. Watch, don't chase.

## Remaining rocks (verified against code, ranked)

Recommended order: **1 → 2 → 5 → 3/4 → 6 → 8 → 7**, then the UAT.

1. **GraphQL has no guard rails.** `/api/graphql` is live with two query fields, **no depth or complexity limit**, one test. Production hole, not test debt.
2. **Agent doors don't reach the new AI work.** `propose_schedule` (4.1) and risk scoring (4.2) exist as pure libs + `src/app/api/board/[id]/schedule` but are **agent tools in neither door**; SPEC 4.1 names the tool. Same for `set_objective` / `score_key_result` (open in `devdocs/TASKS.md`). Cheapest capability-per-line left — the hard half is built and tested.
3. **Public feedback portal** — SPEC 3.9's tokenized external intake. Public *forms* shipped (`/public/forms/[token]`); feedback did not.
4. ~~**Requests is a read-only dialog**~~ — shipped: `view_mode='requests'` lens (migration 086) with accept/decline/reopen triage; the dialog is retired.
5. **Attachments throw without S3 env** (`src/features/attachments/server/storage.ts`) — no local-disk fallback, so a fresh self-host has no attachments at all.
6. ~~**Test-debt tail**~~ — swept: ranked by *assertion* count rather than file count (chat/dependencies/checklists were fine; views and whiteboards had one assertion each). views, whiteboards, docs, milestones, sla, epics, sprints all lifted; +28 tests (1052 → 1080).
7. **Roadmap item 10, untouched** — theme pass (neon-grid vs "enterprise-ready", see `docs/Kanban tool design synthesis/`), keyboard chords, empty states applied everywhere (primitive exists).
8. **Small ones from the review's per-feature table** — epics name-only; dependencies `blocked_by` only (no FS/SS/FF/lag); reports forecast metric; docs `[[wiki links]]` + tree UI; capacity has no time-off model; extensions fire N fetches per card render.

**Explicitly decided, not forgotten:** embeddings/pgvector for 4.3 (needs an embedding vendor this self-hosted app doesn't otherwise depend on); `script` actions excluded from the AI drafter's DTO; extensions get **no write capability**.

## To resume

1. `docker compose up -d`; `npm run db:migrate`; `npm run dev` → http://localhost:3000. `npm run realtime` in a second terminal only for collaborative-editing work.
2. `git log -2` and read those two commit messages before touching automations, knowledge, admin, or extensions.
3. Pick rock 1 unless the user redirects. Ask via `AskUserQuestion` before any agent-behaviour or blast-radius choice.

## Suggested skills

| Skill | When |
|---|---|
| `/code-review` | Before committing a slice — hunts bugs, which `/simplify` deliberately does not. |
| `/simplify` | After a slice lands: reuse, altitude, and dead-code cleanups on the changed files only. |
| `/codex` (review or challenge mode) | Adversarial second opinion on rock 1 (GraphQL limits) and rock 5 (storage fallback) — both are "what breaks in production" questions. |
| `/tdd` | Rock 6 (test-debt tail) and rock 1, where the test *is* the deliverable. |
| `/diagnose` or `/investigate` | If the flaky component-test `waitFor` reappears — root cause before touching it. |
| `/design-review` or `/plan-design-review` | Rock 7 (theme pass) — the project's own design synthesis already prescribes the target. |
| `/browse` or `/run` | Verifying UI-shaped rocks (3, 4, 7) in the real app rather than in tests. |
| `/document-release` | After a batch lands, to sync `README`/`devdocs` with what shipped. |

Do **not** start `comprehensive-uat.md` — the user has deferred it until the rocks above are done.

---

# Prior Handoff — Phase 3 Complete

**Date:** 2026-07-23

## Phase 3 delivery

Phase 3 Knowledge & Collaboration is now delivered in migrations **056–061**:

- Docs, wiki hierarchy, meeting and decision templates, revisions, Markdown rendering,
  published full-text search, and promoting meeting action items into board tasks.
- A self-hosted Yjs + y-websocket service (`npm run realtime`) with HMAC-scoped,
  expiring document tickets, durable PostgreSQL update logs and snapshots, and guest
  object-share checks.
- Native polling chat channels/messages, private-channel membership enforcement, and
  threaded message storage.
- Self-hosted Excalidraw whiteboards persisted as scene JSON, including task-card
  elements linked with their task id.
- Guest workspace role plus per-doc/board/form object shares and revocable, expiring,
  unguessable public document/board read links.

## Verification

`npx tsc --noEmit`, targeted Phase 3 tests (8), `npm run build`, and the full suite
all pass: **91 test files / 689 tests**. The repository-wide eslint command remains
blocked by pre-existing errors in generated design-synthesis material and legacy
components; Phase 3 lint issues were cleaned where surfaced.

## Run notes

Apply migrations with `npm run db:migrate`; `npm run realtime` loads `.env.local`
automatically, or accepts the same `DATABASE_URL` and `BETTER_AUTH_SECRET` as the
Next app through its environment. Set
`NEXT_PUBLIC_REALTIME_URL` when the websocket service is not at `ws://localhost:1234`.

---

# Prior Handoff — Feature Breadth Sweep

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
