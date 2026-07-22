# SPEC — Build-out plan for the remaining feature rocks

**Source of truth:** `../docs/task_management_feature_summary.md` (the 140-criterion
scoreboard) and its companion workbook `../docs/task_management_systems_comparison.xlsx`
(35 platforms × 140 weighted criteria). **Scored 2026-07-22:** 79 ✅ / 53 ❌ / 8 ⛔.

This document specs **the 53 buildable ❌ rocks** at implementation level — for each,
how the market leaders do it and how *this* app should, given its own architecture.
It is a companion to `TASKS.md` (which records what shipped) and inherits its
conventions: every feature is a `src/features/<name>/` slice, migrations are numbered
(the next is **045**), and each rock lands as its own tested commit.

## Out of scope (⛔ — omitted here by design)

Eight rocks cannot be delivered as application code in this repo and are marked ⛔
in the scoreboard rather than specced:

| Rock | Why it is not code |
|---|---|
| SOC 2 · ISO 27001 · HIPAA | Third-party audits / certification programs (+ a BAA for HIPAA). We can build the *primitives* an audit inspects — audit logs (done), retention, encryption, granular permissions (all specced below) — but the attestation itself is organizational. |
| Data residency | A deployment choice; self-hosting already puts the operator in full control of where Postgres and blob storage live. |
| Published uptime/SLA | An availability commitment made by whoever operates the deployment, not a feature. |
| Zapier · Make connectors | A first-party listing lives in the vendor's hosted catalog. Our generic outbound webhooks (025) + n8n-compatible REST already make the app usable from both; a native connector is their code, not ours. |
| Marketplace/apps | A central hosted app catalog is meaningless for a single-tenant self-hosted product. (A local **plugin/extension** framework *is* in scope — see Phase 8.) |

## Design principles (the guardrails every rock below honors)

These are the app's identity; the "best for our app" answer falls out of them.

1. **Feature-slice.** One `src/features/<name>/` per capability: `types.ts` (shapes +
   consts), `lib/` (pure, unit-tested), `server/repository.ts` (DB + authz),
   `server/handlers.ts` (HTTP), `client/api.ts`, `components/`. Thin `app/api/**/route.ts`
   delegate to handlers.
2. **Derive, don't store.** Scores, rollups, spend, flow metrics are computed in pure
   libs from stored facts (priority_score, budget, analytics). New rocks follow suit.
3. **Two doors for agents.** Anything an agent can do exists in both the runtime
   `tools.ts` and `mcp/server.mjs`, gated by the approval tiers in `gate.ts` (§7.4).
   New agent-touching surface goes through `AskUserQuestion` first (PRD §7/§12).
4. **RBAC tiers.** `owner > admin > member > viewer`, enforced by `requireWorkspaceRole` /
   `requireBoardRole`. Reads are viewer+; authoring is member; structural/blast-radius
   changes are admin (the §7.4 rule).
5. **Events already flow.** `logActivity` writes `activity_log` post-commit and fans out
   to webhooks (025). This is the tap the whole automation engine (Phase 1) subscribes
   to — no second event bus.
6. **Safe rendering.** User Markdown renders through `shared/ui/rich-text` (033) to React
   elements, never HTML — the rule every docs/comment surface below reuses.
7. **Three-valued nullable + SET NULL.** Optional fields are absent / null / value;
   cross-object FKs SET NULL so deletes un-link rather than cascade-destroy.

## Prioritized roadmap

Ordered by value × leverage × dependency. Earlier phases unblock later ones (the
automation engine is the spine of Phase 1 and the delivery arm of Phase 7).

| Phase | Theme | Rocks | Why here |
|---:|---|---:|---|
| 1 | Workflow & Automation engine | 12 | One primitive (a rule engine on the existing event tap) closes a whole capability area and is the delivery arm for notifications, SLAs, routing, and integrations. Highest leverage. |
| 2 | Developer & DevOps / Git | 10 | The app is agent- and developer-native; tying work to commits/PRs/CI is the strongest identity fit and a category the workbook shows is wide-open for self-hosted tools. |
| 3 | Knowledge & Collaboration (Docs) | 10 | A docs/pages primitive (reusing 033's safe renderer) closes most of the collaboration area; Notion/ClickUp show this is table-stakes. |
| 4 | AI & Agentic | 5 | Leverages the existing agent runtime + analytics; the app's differentiator. |
| 5 | Reporting & Analytics | 2 | Small, high-value, reuses the analytics replay + the new Phase 1/financial data. |
| 6 | Enterprise & Security | 8 | Unlocks enterprise adoption (SSO/SCIM/granular perms/admin/encryption/retention/eDiscovery/IP). Larger, less differentiating, so mid-roadmap. |
| 7 | First-party Integrations | 6 | Vendor-specific Slack/Teams/email/Google/M365 adapters riding the Phase 1 engine + Phase 6 OAuth. |
| 8 | Extensibility | 1 | A local plugin/extension framework — lowest priority, highest blast radius. |

Per-feature entries use a fixed shape: **market leaders → Data → API → UI → Gates →
Agent → Tests → Effort** (S ≈ 1 migration + slice ≈ a 039-sized commit; M ≈ 2×; L ≈
multi-slice; XL ≈ multi-week spike).

---

## Phase 1 — Workflow & Automation engine (12 rocks)

**Leaders:** Jira, Azure DevOps, monday, ClickUp, Wrike, Asana, Smartsheet, Airtable
all converge on the same shape: a **trigger → condition → action** rule engine with a
no-code builder. Eleven of this phase's twelve rocks are *rule types or bundles on one
engine*; build the engine once (1.0) and the rest are thin.

### 1.0 Automation engine core *(the spine — not itself a scoreboard row, enables the 12)*

- **Insight:** `logActivity` already emits every state change post-commit and already
  fans out to webhooks. The engine is a *second subscriber* on that same sink, not a new
  bus — so a rule fires on exactly the events a webhook would.
- **Data (045):** `automation_rule` (board-scoped): `id, board_id, name, is_enabled,
  trigger JSONB, conditions JSONB, actions JSONB, created_at`. `trigger` = `{event}`
  (an `activity_log` action, e.g. `task.moved`, `task.created`, or the synthetic
  `schedule.tick`); `conditions` = an AND/OR predicate tree over the task/board snapshot;
  `actions` = an ordered list (`assign`, `move`, `set_field`, `add_label`, `notify`,
  `webhook`, `comment`, `create_task`). `automation_run` (audit): `rule_id, activity_id,
  status, detail JSONB, created_at` — every fire logged, reusing 013's `activity_id`
  linkage so an automated change is traceable to the rule that made it.
- **lib/ (pure, heavily unit-tested):** `evaluate(conditions, snapshot) → bool` and
  `planActions(actions, snapshot) → Effect[]`. The evaluator is the derive-don't-store
  heart; effects are applied by the repository, never in the lib.
- **Runner:** a `runAutomations(activityId, event, snapshot)` hook called from the same
  post-commit point as `dispatchWebhooks`. Actions reuse existing repositories
  (`updateTask`, `addLabel`, `createTask`, `dispatchWebhook`, `createNotification`) so
  the engine writes through the same gates a human would. Guards: a per-activity depth
  cap (a rule's action can trigger another rule — cap the cascade, like the webhook
  loop guard) and an idempotency key so a retried event does not double-fire.
- **API:** `GET/POST /api/board/[id]/automations`, `PATCH/DELETE /api/automations/[id]`,
  `POST /api/automations/[id]/test` (dry-run against the last N activities).
- **Gates:** rules are admin (they act *as* the workspace — blast radius); reads viewer+.
- **Agent:** deferred behind `AskUserQuestion` — a rule that an agent can author is
  agent-behaviour surface (§7).
- **Effort:** L (this is the phase's investment; 1.1–1.11 are S each on top).

### 1.1 No-code automations · 1.2 Conditional branching
*(WF: monday/ClickUp "when-then" recipe builder with if/else.)*
- These two rows **are** 1.0's builder UI + evaluator. **No-code automations** = the
  `AutomationsDialog` recipe builder (trigger picker, action list, enable toggle).
  **Conditional branching** = the `conditions` predicate tree (AND/OR groups, per-field
  operators) plus an optional per-action `onlyIf`.
- **UI:** a board **Automations** dialog (Forms-shaped, self-fetching): rule list, a
  builder (When [event] · If [conditions] · Then [actions]), and a run-log tab reading
  `automation_run`.
- **Effort:** S (UI only, on 1.0).

### 1.3 State transition rules
*(Jira workflow: an allowed-transition map + per-edge validators/conditions.)*
- **Data (046):** `board.workflow JSONB` — `{ allowed: {fromColumnId: [toColumnId...]},
  guards: {edge: conditions} }`. Absent = today's "any column → any column".
- **Enforcement:** `moveTask` consults the map before the write; a disallowed edge is a
  `409 conflict` (AuthzError's shape), a guarded edge evaluates `conditions` (reuse
  1.0's evaluator) — e.g. "can't enter Done with unchecked checklist items".
- **UI:** a matrix editor in the Automations dialog (columns × columns, tick allowed).
- **Gates:** admin. **Agent:** the `move_task` tool inherits the guard automatically.
- **Effort:** M.

### 1.4 Recurring automation rules
*(Scheduled actions — "every Monday", "3 days before due".)*
- **Reuse:** the durable run-queue drainer (030) in `instrumentation.ts` already wakes
  on a timer. Add a `schedule.tick` synthetic event it emits; rules with a
  `{event: "schedule.tick", cron}` trigger evaluate against the board on the tick.
- **Data:** a `next_run_at` column on `automation_rule` for cron rules; the drainer
  advances it (recurrence 020's date-advance logic, reused).
- **Effort:** S (on 1.0 + 030).

### 1.5 Notification rules
*(Configurable alert policies — who gets pinged on what.)*
- **`notify` action** on the engine + a `notification` write (016 exists: the bell).
  A rule `When task.assigned If assignee=me Then notify` is the whole feature.
- **Data:** none beyond 1.0; reuse `notification` + `notification_seen`.
- **UI:** presets in the builder ("Notify assignee", "Notify me on mention") over the
  raw action. **Effort:** S.

### 1.6 SLA management
*(Service timers, escalation, breach — ServiceNow/Jira SM.)*
- **Data (047):** `sla_policy` (board-scoped): `name, applies_when conditions, target_mins,
  action_on_breach JSONB`. `task_sla` (per task): `policy_id, started_at, due_at,
  breached_at`. Elapsed/remaining are **derived** (analytics rule), not stored.
- **Engine tie-in:** a `schedule.tick` rule scans open `task_sla` rows; crossing `due_at`
  writes `breached_at` and fires `action_on_breach` (notify/escalate/label).
- **UI:** an SLA section in the task dialog (target, remaining, breach flag) + a policies
  editor. **Gates:** policies admin; timers auto. **Effort:** M.

### 1.7 Forms routing
*(Send a submission to the right queue/assignee/column by its answers.)*
- **Extend Forms (039):** add `form.routing JSONB` — an ordered list of
  `{conditions, columnId?, assignee?, labelIds?}`. `submitForm` evaluates routing
  (1.0's evaluator over the answers) after compiling the task, overriding the default
  target column / setting assignee+labels.
- **UI:** a routing-rules panel in the FormsDialog builder. **Effort:** S (on 039 + 1.0).

### 1.8 Request management
*(A structured intake queue with statuses — Jira SM / ServiceNow.)*
- **Composition, not a new table:** a "request" is a Form (039) submission whose target
  is a dedicated board using custom statuses (already ✅) with routing (1.7) + SLAs (1.6).
  The rock is a **Requests view**: a filtered board lens (`view_mode='requests'`, the
  029 backlog precedent) showing intake tasks grouped by request-status with their SLA
  and requester, plus a lightweight requester field (reuse `feedback.source`'s free-text
  shape or a custom field).
- **Data (048):** widen the `view_mode` CHECK; a `task.request_meta` JSONB or a custom
  field set. **Effort:** M.

### 1.9 Workflow templates
*(Reusable process templates — a status set + rules + SLA, applied to a new board.)*
- **Reuse the templates pattern (019):** a `workflow_template` (workspace-scoped) bundling
  a column set, an `automation_rule` set, and SLA policies as JSONB. "Apply template to
  board" instantiates them.
- **Seed:** ship 2–3 (Kanban, Scrum, Incident) so the row demonstrates depth. **Effort:** M.

### 1.10 Incident/service workflows
*(Native incident/escalation processes.)*
- **Not a new engine — a seeded Workflow template (1.9):** an "Incident" template =
  incident/severity custom fields + an escalation SLA (1.6) + notify-on-breach rules +
  a postmortem checklist. Demonstrated by shipping the template + a "Declare incident"
  action (a `create_task` from the template). **Effort:** S (on 1.6 + 1.9).

### 1.11 Custom scripts/functions
*(Advanced scripted actions — Jira ScriptRunner / Airtable scripting.)*
- **A sandboxed `script` action type.** Run user JS in an isolated V8 context
  (`isolated-vm` or `node:vm` with a frozen, capability-scoped API surface — `task`,
  `board`, and a whitelisted mutation set) with a CPU/time budget, no network, no fs.
  The script returns an `Effect[]` the engine applies through the same repositories.
- **Gates:** admin-only authoring; **carefully** scoped — this is the highest-risk rock,
  so it ships last in the phase, behind a config flag, with the sandbox threat-modeled.
- **Effort:** L (the sandbox is the cost).

### 1.12 External automation connectors
*(First-class connect-out to n8n/Power Automate/etc.)*
- **Mostly done + one addition:** outbound is the engine's `webhook` action + 025's
  HMAC-signed stream (n8n ✅). Add **inbound**: a scoped `automation_trigger` webhook
  endpoint (`POST /api/board/[id]/triggers/[token]`) that raises a synthetic
  `external.trigger` event any rule can fire on — so an external tool can *drive* a
  board, not just listen. **Gates:** token minted by admin, per-board, revocable.
- **Effort:** S. **(Native Zapier/Make listings remain ⛔ — this makes the app
  connectable from them via generic webhooks.)**

---

## Phase 2 — Developer & DevOps / Git (10 rocks)

**Leaders:** Jira, Azure DevOps, GitHub Projects, Linear, GitLab, YouTrack all do the
same thing — tie a work item to the branch/PR/commit/pipeline/release that delivers it,
via a git-host App (OAuth + inbound webhooks) and "smart commit" text parsing. Per the
integration decision this phase is **vendor-specific** (real GitHub App, GitLab, Bitbucket),
but all three write through **one link model** (2.0) so PR/commit/branch/CI/release/browse
are provider-agnostic downstream.

### 2.0 Git provider connection + link model *(the spine)*
- **Data (049):** `repo_connection` (workspace-scoped): `id, workspace_id, provider
  (github|gitlab|bitbucket), external_repo (owner/name), install_id, secret (encrypted,
  see 6.5), created_at`. `task_git_link` (per task): `task_id, kind (branch|pr|commit),
  provider, external_id, url, state (open|merged|closed|—), title, updated_at`.
- **Insight:** the app already has HMAC-verified inbound *out* (webhooks 025); this is the
  mirror — an inbound *ingress* that verifies the provider's signature and upserts
  `task_git_link`. Task resolution reuses "smart commit" parsing: a `#123` reference or a
  `feature/123-slug` branch name maps to `task.id`, the mapping every leader uses.
- **Runner:** each provider's webhook (push, pull_request, pipeline, release) is verified,
  normalized to a link upsert, and — because it flows through `logActivity` — can *fire
  Phase 1 rules* (e.g. "PR merged → move task to Done"). Git and automation compose.
- **Gates:** connecting a repo is admin (OAuth consent + secret); links are auto.
- **Effort:** L (OAuth + signature verify per provider; the payoff is 2.1–2.10 ride it).

### 2.1 GitHub integration *(GitHub App)*
- A first-class **GitHub App** (not a PAT): installation flow, `X-Hub-Signature-256`
  verification, webhooks for `push`/`pull_request`/`check_suite`/`release`. Stores an
  installation id in `repo_connection`; calls the REST API with an installation token.
- **UI:** a Developer/Integrations settings panel: "Connect GitHub" → install → pick repos.
- **Effort:** M (on 2.0).

### 2.2 GitLab integration
- GitLab project webhooks + OAuth application; verify `X-Gitlab-Token`; same event
  normalization (push, merge_request, pipeline, release) into `task_git_link`.
- **Effort:** M.

### 2.3 Bitbucket integration
- Bitbucket Connect/OAuth + repository webhooks (`repo:push`, `pullrequest:*`); same model.
- **Effort:** M.

### 2.4 Pull request links · 2.5 Commit links
*(GitHub/Linear: the item shows its PRs/commits with live state.)*
- **These are 2.0's `task_git_link` rows surfaced.** A **Development** section in the task
  dialog lists linked branches/PRs/commits with state chips (open/merged, CI pass/fail);
  cards get a small PR-state glyph. No new data — the webhook already populated the links.
- **Gates:** viewer+ read. **Effort:** S each (UI on 2.0).

### 2.6 Branch linking/automation
*(Create/track a branch from an issue; branch → in-progress.)*
- **Two halves.** *Track:* branch-name parsing already links (2.0). *Create:* a
  "Create branch" action calling the provider API to open `feature/123-slug` from the
  default branch, recorded as a link. Plus a Phase-1 rule shipped as a preset:
  "branch created → move task to In Progress".
- **Effort:** M.

### 2.7 CI/CD integration
*(Build/deploy/pipeline status on the item — GitHub Checks / GitLab pipelines.)*
- **Ingest check/pipeline events** (`check_suite`, `pipeline`) into a
  `task_ci_status` (or a `kind='ci'` link): status, conclusion, url, ref. Surface as a
  pass/fail chip in the Development section and as a Phase-1 trigger
  (`ci.failed → notify assignee`). **Effort:** M.

### 2.8 Release management
*(Versions/releases grouping delivered work — Jira releases, GitHub Releases.)*
- **Data (050):** `release` (board-scoped): `name/version, state (planned|released),
  released_at, notes`. `task.release_id` SET NULL (milestone's twin). Ingest git-host
  `release`/tag events to flip state + stamp `released_at`; a release's scope rolls up
  its tasks (done/total) like a milestone. Export a release column; auto-generate release
  notes from linked tasks' titles (compile-note pattern, 043).
- **UI:** a Releases dialog (Milestones-shaped) + task picker. **Gates:** member.
- **Effort:** M.

### 2.9 GraphQL API
*(A GraphQL surface beside REST — GitHub/Linear/GitLab.)*
- **A read-first GraphQL endpoint** at `/api/graphql` over the existing repositories,
  reusing the same principal auth (agent token or session) and the same authz gates —
  GraphQL is a second *shape* over the model, not a second permission system. Schema
  covers boards/tasks/labels/milestones/sprints/objectives; mutations phase in behind the
  same gates as the REST routes. Use a lightweight schema-first server (graphql-yoga) so
  it stays self-contained.
- **Effort:** L (schema + resolvers over the whole read model).

### 2.10 Repository browsing
*(Navigate repo files/branches inside the platform — Jira code, Azure Repos.)*
- **A read-through file/branch browser** in the Developer panel: proxied, cached calls to
  the connected provider's contents API (tree, blob, branch list) rendered read-only, with
  the viewer's connection token — no repo data stored, honoring the self-hosted "we hold
  only what we must" stance. **Gates:** viewer+ (of a board whose workspace owns the
  connection). **Effort:** M.

---

## Phase 3 — Knowledge & Collaboration (10 rocks)

**Leaders:** Notion and Coda define the category (docs = first-class objects beside
tasks); ClickUp, Asana, Wrike, OpenProject, Basecamp all ship a docs/pages surface. The
app already has the hard part — a **safe Markdown→React renderer** (033) that escapes
hostile input by construction — so a docs primitive (3.0) is mostly storage + tree, and
seven rocks fall out of it.

### 3.0 Docs / pages primitive *(the spine)*
- **Data (051):** `doc` (workspace-scoped, board-optional): `id, workspace_id, board_id
  (nullable — a doc can be workspace-wide or pinned to a board), parent_id (self-ref,
  CASCADE — the page tree), title, body (Markdown), kind (page|meeting|decision),
  position, created_by, updated_at`. `doc_revision` (append-only history):
  `doc_id, body, edited_by, created_at` — the activity_log's spirit for long-form.
- **Render:** `body` stores raw Markdown; every read renders through `shared/ui/rich-text`
  (033) — no `dangerouslySetInnerHTML`, ever. Write is a textarea with Write/Preview
  (the 82cb2c1 pattern already in the task dialog).
- **API:** `GET/POST /api/workspaces/[id]/docs`, `PATCH/DELETE /api/docs/[id]`,
  `GET /api/docs/[id]/revisions`. **Gates:** read viewer+, author member, delete admin
  (a doc tree is structural). **Effort:** M (spine; 3.1/3.2/3.4/3.5/3.6 are S on it).

### 3.1 Docs/wiki
- **The `doc` tree itself is the wiki.** A workspace **Docs** dialog/section renders the
  `parent_id` tree in a sidebar with the page on the right; `[[wikilinks]]` resolve doc
  title → doc (a small extension to 033's link handling). **Effort:** S.

### 3.2 Rich text pages
- **The editor surface** — the Write/Preview page editor over `doc.body`, with the 033
  Markdown subset (headings, lists, code, tables, links, task-list checkboxes, and an
  embed of a task card by id). **Effort:** S (on 3.0).

### 3.3 Real-time co-editing
- **The one XL rock.** A CRDT (Yjs) document per `doc`, synced over a WebSocket provider;
  Postgres stores the authoritative Yjs update log + periodic snapshots into `doc.body`
  (so non-realtime reads and revisions still work). Presence cursors from the awareness
  protocol.
- **Why XL:** it needs a stateful WS server beside Next.js (a small `ws` service or a
  route-handler upgrade), conflict-free merge, and reconnection — the only rock that
  breaks the "stateless request → Postgres" shape. Ship 3.0–3.2 first; layer this on.
- **Effort:** XL.

### 3.4 Meeting notes
- **A `doc.kind='meeting'` template:** attendees, agenda, notes, and an **action-items**
  block whose checked lines can **promote to tasks** (reuse 043's promote→`createTask`
  pattern; see 4.5 for the AI extraction that fills it). **Effort:** S (on 3.0).

### 3.5 Decision logs
- **A `doc.kind='decision'` structured template** (context / decision / rationale /
  status), listable as a filtered decision index, each linkable to the tasks/objectives it
  governs (a `doc`↔object link, or a `decision_id` on task). ADR-style. **Effort:** S.

### 3.6 Knowledge base
- **A published, searchable doc collection.** A `doc.is_published` flag + a KB view
  listing published docs with full-text search over `title||body` (Postgres `tsvector`
  GIN index — the same index 4.3's AI search builds on). **Effort:** M.

### 3.7 Native chat
*(Built-in messaging — ClickUp/Teams-style channels.)*
- **Data (052):** `channel` (workspace-scoped: name, is_private), `channel_member`,
  `chat_message` (channel_id, author, body Markdown-via-033, parent_id for threads,
  created_at). Reuses the mention parser (024) and the notification bell (016); a DM is a
  two-member private channel.
- **UI:** a chat panel (channels sidebar + thread). **Realtime:** poll first (cheap, fits
  the stateless shape); upgrade to the 3.3 WS transport once it exists.
- **Gates:** channel create member; private-channel membership admin. **Effort:** L.

### 3.8 Whiteboards
*(Visual canvas — ClickUp/Notion/Miro-style.)*
- **Data (053):** `whiteboard` (board-scoped): `title, scene JSONB` (an Excalidraw/tldraw
  scene). Embed the open-source **Excalidraw** component (self-hostable, no SaaS) and
  persist its scene JSON; cards can be dropped as elements linking back to tasks.
- **Realtime:** single-writer autosave first; multi-user rides 3.3's CRDT transport later.
- **Effort:** L.

### 3.9 Guest/client access
*(Controlled external-collaborator access — Asana/Wrike guests.)*
- **A `guest` role below `viewer`** in the RBAC ladder (touches `WorkspaceRole` and every
  `requireRole` check) **plus per-object shares:** `object_share` (subject_type
  board|doc|form, subject_id, user_id, can_edit) so a guest sees *only* shared objects,
  not the whole workspace. Invitations (002) extend with a guest tier.
- **Why here, not Phase 6:** it is collaboration-shaped (a client on one project) but it is
  an authz change — spec it against the Phase 6 granular-permissions model (6.3) so the
  two share one object-scoped ACL. **Gates:** sharing is admin/owner. **Effort:** M.

### 3.10 Public sharing
*(Shareable public pages/boards/forms/portals.)*
- **A capability of unguessable read tokens.** `public_link` (subject_type
  board|doc|form|view, subject_id, token, scope (read|submit), expires_at, created_by). A
  tokened route renders a read-only (or submit-only, for a form/feedback portal) view with
  **no session** — the anonymous path, carefully scoped to exactly the subject and nothing
  adjacent. Rate-limited; revocable; off by default.
- **Ties a bow on 043:** a public feedback form + a public roadmap are the highest-value
  shares. **Gates:** minting a link is admin. **Effort:** M.

---

## Phase 4 — AI & Agentic (5 rocks)

**Leaders:** Linear, Asana, ClickUp, Wrike, Airtable, Notion. The app is *ahead* of the
market here (AI writing/task-creation/project-generation/prioritization, configurable
agents, agent+human capacity are all ✅) — these five extend that base. **Every rock in
this phase touches agent behaviour, so each goes through `AskUserQuestion` before build
(PRD §7/§12), and each writes proposals as a reviewable changeset (the accept-at-apply
pattern already in `gate.ts`), never a silent mutation.**

### 4.1 AI scheduling
*(Auto due-dates / sequencing — Motion/Asana/ClickUp.)*
- **Compose two things already built:** the CPM scheduler (`schedule.ts`, 036) and member
  capacity (041). An agent tool `propose_schedule(boardId)` runs the critical path,
  weighs each member's open point demand, and returns *proposed* `start_date`/`due_date`
  per task as a changeset the human accepts task-by-task. Deterministic core (the
  scheduler) + LLM only for tie-break narration.
- **Gates:** proposal reads viewer+; apply is member (rides `updateTask`). **Effort:** M.

### 4.2 Risk prediction
*(Flag at-risk/slipping work — Linear/Asana.)*
- **Derive, then narrate.** A pure `assessRisk(board)` over the analytics replay (a task's
  age in column, overdue slope, blocked-by edges 018, sprint burndown 9c5f7e0) yields a
  0–1 risk score + reasons — no model needed for the signal. An optional agent pass
  summarizes "why" and suggests a mitigation. Surfaced as a risk chip on cards + a
  "Risks" section in Insights.
- **Gates:** viewer+ read (derived). **Effort:** M (S for the heuristic, +S for narration).

### 4.3 AI search / Q&A
*(NL search + answers over workspace knowledge — Notion/ClickUp/Glean-style.)*
- **RAG over the workspace.** Full-text first: a `tsvector` GIN index across tasks,
  comments, and docs (3.6) for keyword recall. Then embeddings: `pgvector` columns +
  an ANN index; an `index_document` job (post-commit, beside webhooks) keeps them warm.
  A `POST /api/workspaces/[id]/ask` endpoint retrieves top-k, hands them to an agent, and
  returns an answer **with citations to the source objects** — and every retrieved row is
  authz-filtered to the caller (the search never leaks a board they can't read).
- **Gates:** viewer+, results ACL-filtered. **Effort:** L (embeddings pipeline + RAG).

### 4.4 AI workflow builder
*(NL → an automation/workflow — Asana/ClickUp "describe it and we build it".)*
- **Directly composes Phase 1.** An agent tool takes "when a bug is set to high, assign it
  to the on-call and post to #incidents" and emits a **valid `automation_rule`** (trigger
  + conditions + actions JSON validated by 1.0's schema), presented in the builder for the
  admin to review and enable — generation, not silent activation.
- **Depends on:** Phase 1. **Gates:** admin (a rule acts as the workspace). **Effort:** M.

### 4.5 Meeting notes to tasks
*(Extract action items from a transcript/notes — Asana/Notion/Fireflies-style.)*
- **Reads a meeting doc (3.4)** (or a pasted transcript), extracts action items with owner
  + due hints via an agent, and returns a **changeset of proposed tasks** the human
  accepts — each created through `createTask` (member gate, logged), linked back to the
  source doc. **Depends on:** 3.4. **Gates:** member on apply. **Effort:** M.

---

## Phase 5 — Reporting & Analytics (2 rocks)

**Leaders:** Jira, Azure DevOps, GitLab, monday, ClickUp, Wrike, Smartsheet. The app
already has dashboards, charts, flow metrics, workload, portfolio rollups, timesheets,
and export ✅ — these two close the area by making reporting *user-defined* and
*financial*.

### 5.1 Custom reports
*(User-defined reports across projects/fields — Jira/monday report builders.)*
- **A saved report over the existing read model.** `report` (workspace-scoped): `name,
  source (tasks|time|flow), filter JSONB (reuse the saved-view 015 predicate), group_by,
  metric (count|sum:estimate|sum:minutes|avg:cycle), viz (bar|line|table)`. A pure
  `runReport(report, rows)` aggregates; the same SVG chart components the Insights dialog
  uses render it. Cross-board via the portfolio query.
- **API:** `GET/POST /api/workspaces/[id]/reports`, `PATCH/DELETE /api/reports/[id]`.
  **Gates:** report defs member (private like saved views) or admin (shared). **Effort:** M.

### 5.2 Financial reports
*(Budget/spend/profitability — the ⛔-adjacent business layer, but buildable from our data.)*
- **Compose budget (042) + time (027).** A financial report rolls logged minutes ×
  member/role rate into spend, burn vs `board.budget_amount`, and a simple forecast
  (spend-rate × remaining scope), per board and across the portfolio. Pure
  `financials(boards, entries, rates)` (042's `costOf`/`remainingOf` generalized to a
  time series). Export to CSV rides the existing export.
- **UI:** a Financials report type in 5.1's builder + a portfolio spend rollup.
  **Gates:** viewer+ read, rates admin (042's rule). **Effort:** M.

---

## Phase 6 — Enterprise & Security (8 rocks)

**Leaders:** Jira, Azure DevOps, GitLab, Asana, monday, Wrike, Smartsheet, Airtable.
The app has RBAC, audit logs, and self-hosting ✅. These eight are the buildable enterprise
gaps (the five certification/hosting rocks are ⛔). Auth already runs on **better-auth**,
which carries most of the identity load.

### 6.1 SSO/SAML
- **better-auth SSO plugin** (SAML 2.0 + OIDC): per-workspace IdP config
  (metadata URL, entity id, cert), JIT provisioning into the workspace on first login.
  Config lives in the admin console (6.4). **Effort:** M (mostly wiring + config UI).

### 6.2 SCIM / user provisioning
- **SCIM 2.0 endpoints** (`/api/scim/v2/Users`, `/Groups`) with bearer-token auth per
  workspace, mapping SCIM users/groups to `workspace_member` rows + roles — automated
  deprovisioning (a removed SCIM user loses membership). Follows the RFC 7644 shapes.
  **Effort:** L.

### 6.3 Granular permissions
- **An object-scoped ACL generalizing 3.9's `object_share`.** Beyond workspace roles: a
  per-board role override, per-field visibility (which custom fields a role can see/edit),
  and per-action grants. Modeled as `permission_grant (subject_type, subject_id,
  principal, capability)` consulted by a central `can(actor, capability, object)` the
  repositories call. The big design rock — it threads one predicate through every gate.
  **Effort:** L.

### 6.4 Admin console
- **A centralized workspace-admin surface** gathering what exists (members/roles 002,
  agents 009, audit log 003, webhooks 025, capacity 041) plus the new config (SSO 6.1,
  SCIM tokens 6.2, retention 6.6, IP allowlist 6.8, integrations Phase 7). A settings
  section, admin/owner only — mostly composition of existing repositories behind one
  navigation. **Effort:** M.

### 6.5 Encryption
- **Application-level encryption of secrets at rest** + documented transport. Stored
  secrets (git-host tokens 2.0, webhook signing keys 025, SCIM/IdP secrets, OAuth refresh
  tokens Phase 7) are encrypted with a KMS/`ENCRYPTION_KEY`-derived key via `pgcrypto` or
  an app-side AEAD, never stored plaintext. TLS-in-transit is a deployment concern
  (documented, reverse-proxy terminated). **Effort:** M.

### 6.6 Retention / legal hold
- **Data (nnn):** `retention_policy` (workspace-scoped: object_type, max_age_days) drives
  a scheduled purge (the 030 drainer) of aged soft-deleted rows; `legal_hold`
  (subject_type, subject_id) **exempts** matching objects from purge. Reuses the
  soft-delete/snapshot machinery already behind undo. **Gates:** admin/owner, audited.
  **Effort:** M.

### 6.7 eDiscovery
- **An admin-only, audited search-and-export across the whole workspace** — including
  content still within retention and under legal hold — over the 4.3 index, exporting a
  bundle (JSON/CSV + attachments manifest) for a compliance request. Builds on 4.3 + the
  existing export; every eDiscovery run itself logs to the audit trail. **Effort:** M.

### 6.8 IP allowlisting
- **A per-workspace allowed-CIDR list enforced in middleware** (`ip_allowlist` rows;
  Next.js `middleware.ts` checks the request IP against the caller's workspace before the
  route runs). Empty = open (today's behavior); off by default. **Gates:** owner.
  **Effort:** S.

---

## Phase 7 — First-party Integrations (5 rocks)

**Leaders:** near-universal (Slack scored 3 on 30/35 platforms). Per the integration
decision these are **vendor-specific**, but each delivers *through the Phase 1 engine*
(a `notify`/`webhook` action gains a channel target) and *authenticates through Phase 6*
(OAuth token storage encrypted by 6.5), so they are adapters, not parallel stacks.

### 7.1 Slack integration
- **A real Slack app.** OAuth install per workspace; **outbound** = a Slack delivery target
  on the 1.5 notification action (post to a channel on assignment/mention/SLA breach);
  **inbound** = a slash command (`/task create …`) + an Events API subscription and link
  unfurling for board URLs. Bot token encrypted (6.5).
- **Depends on:** Phase 1. **Gates:** admin installs. **Effort:** L.

### 7.2 Microsoft Teams integration
- **A Teams app** (bot + message extension + Incoming Webhook connector): the same
  outbound notifications and inbound "create from message" as Slack, over the Bot
  Framework. Shares the 7.1 delivery abstraction. **Effort:** L.

### 7.3 Email integration
- **Two directions.** *Outbound:* notifications (016) delivered by SMTP (a `notify` channel
  target). *Inbound:* a per-board mail-in address; an inbound-parse webhook (or IMAP poll)
  turns an email into a task or a comment reply (thread-id → task), reusing the Forms
  compile pattern (039) and the 033 renderer for the body. **Effort:** M.

### 7.4 Google Workspace
- **OAuth (Google as an IdP option via 6.1)** + content: attach Google Drive files to
  tasks (store a link + metadata, not the blob), and a Calendar sync that mirrors task
  due-dates/start-dates (032) as events. **Effort:** M–L.

### 7.5 Microsoft 365
- **OAuth via Entra ID** (feeds 6.1 SSO) + Outlook Calendar sync (as 7.4) and
  OneDrive/SharePoint file attachment-by-link. Shares 7.4's calendar-sync and
  attachment-link abstractions. **Effort:** M–L.

---

## Phase 8 — Extensibility (1 rock)

### 8.1 Plugin / extensions
*(An extension model — Jira power-ups, GitHub Apps, ClickUp integrations.)*
- **A local extension framework (no hosted marketplace — that's ⛔).** Named extension
  points — card badges, task-dialog panels, board actions, custom field renderers — that
  a workspace-installed **manifest** can register, with the extension's UI sandboxed in an
  iframe and its data access mediated by a scoped, capability-gated bridge (the two-door
  discipline, applied to third-party UI). Ships with the app's own dialogs re-expressed as
  the first consumers of the API, to prove the surface.
- **Why last:** highest blast radius (arbitrary third-party code near the workspace) and
  it wants a stable internal API to extend — so every prior phase informs its shape.
- **Gates:** owner installs; per-extension capability grants (6.3). **Effort:** XL.

---

## Build sequence & dependencies

The phases are already value-ordered, but the hard **dependency edges** are:

- **Phase 1 (engine) → 1.5 notify, 1.6 SLA, 1.7 routing, 4.4 workflow-builder, and all of
  Phase 7** (every notification/integration delivers through the engine's action list).
- **Phase 3.0 (docs) → 3.1/3.2/3.4/3.5/3.6**, and **3.3 (CRDT WS) → 3.7 chat realtime,
  3.8 whiteboard realtime** (one WebSocket transport, built once).
- **Phase 2.0 (git link model) → 2.1–2.10**; **2.0 also feeds Phase 1** (a merged-PR event
  can fire a rule).
- **Phase 4.3 (search index) → 6.7 eDiscovery**; **3.6 KB search** shares the same tsvector
  index.
- **Phase 6.3 (granular perms / object ACL) ← 3.9 guest access** (one shared object-scoped
  ACL — build 3.9's `object_share` as the first slice of 6.3's model, not a throwaway).
- **Phase 6.5 (secret encryption)** should land **before** Phase 2/7 store any third-party
  token — pull it forward if git/Slack ships first.

**Recommended first three commits** (highest leverage, low regret): **1.0 automation
engine → 1.1/1.2 builder → 2.0 git link model.** They are the two spines the rest of the
roadmap hangs from.

## Effort roll-up

| Phase | Rocks | Rough size |
|---:|---|---|
| 1 Automation | 12 | 1×L (engine) + 1×L (scripts) + ~6×S + ~4×M |
| 2 Git/DevOps | 10 | 2×L (link model, GraphQL) + ~6×M + 2×S |
| 3 Knowledge | 10 | 1×XL (co-editing) + 2×L (chat, whiteboard) + ~4×S + ~3×M |
| 4 AI | 5 | 1×L (RAG) + 4×M |
| 5 Reporting | 2 | 2×M |
| 6 Enterprise | 8 | 3×L (SCIM, granular, — ) + ~4×M + 1×S |
| 7 Integrations | 5 | 2×L (Slack, Teams) + 3×(M–L) |
| 8 Extensibility | 1 | 1×XL |

Legend: **S** ≈ a 039-sized commit (1 migration + slice + tests); **M** ≈ 2× S; **L** ≈
multi-slice; **XL** ≈ multi-week spike that breaks the stateless-request shape.

## How to consume this SPEC

Each entry is a commit brief in the shape 039–044 were built: a migration (numbered from
045), a `src/features/<name>/` slice, both agent doors where relevant, DB + pure tests,
and a scoreboard row flipped ❌→✅ in the same commit. Take them **in roadmap order** —
start at 1.0 — and re-tally the header (`../docs/task_management_feature_summary.md`) plus
`TASKS.md` per commit, exactly as the rocks sweep did. The ⛔ rows stay ⛔ unless the
product's hosting/compliance posture changes (they are not code).
