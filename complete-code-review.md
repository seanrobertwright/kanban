# Complete Code Review — Kanban

**Date:** 2026-07-25 · **Branch:** master · **Scope:** all 41 feature slices under `src/features/`, app shell, MCP server (Door 2), UI/UX vs. the comparison research in `docs/`.

**Method:** six parallel deep audits — four feature-completeness sweeps covering every slice, one UI/UX review against `docs/task_management_systems_comparison.md`, `docs/task_management_feature_summary.md`, and `docs/Kanban tool design synthesis/Kanban.dc.html`, and one MCP server review against `docs/agent-api.md` and `devdocs/prd.md` §7. Baselines: `devdocs/SPEC.md` (53 rocks, scoreboard 79✅/53❌/8⛔ as of 2026-07-22), `devdocs/TASKS.md` (claims Phases 1, 2, 3, 5 complete; 102✅/30❌/8⛔).

---

## 1. Executive summary

**The suspicion that "much of the functionality has not been implemented" is largely wrong — with important exceptions.** This codebase is not a stub farm. Across all 41 audited slices there are **zero mock-data arrays, zero "coming soon" placeholders, and zero empty server actions**. Every feature with UI has ≥1 real API route (165 route files) backed by real SQL repositories over 70 Postgres tables (migrations 001–073), and most have real-DB integration tests (84 `.test.ts` files, 689 tests passing per the last handoff).

The real problems fall into five buckets:

1. **Built but unreachable** — fully implemented, tested server capability with *no UI door*. Worst case: the entire sharing/public-links subsystem has no button anywhere in the app. Also: SSO login (providers configurable, no way to sign in with them), custom-field access policies (enforced in SQL, uncreatable), task-side SLA display, milestone editing, label editing, email intake address, repo tree/branch browsing.
2. **Honest-looking overclaims** — features whose scoreboard row is ✅ but whose implementation is materially weaker than the SPEC promise. Worst cases: knowledge "Q&A" is string concatenation, not RAG; the "AI workflow builder" is a four-phrase regex, not a model call; git repository browsing sends **no auth token** and would 401 on any real private repo.
3. **Half-wired subsystems** — chat has no mentions/notifications/DMs/replies despite the SPEC naming them; whiteboard realtime CRDT transport exists (for docs) but isn't connected; invitations are written to the DB but never emailed despite a working SMTP module.
4. **Test debt concentrated exactly where blast radius is highest** — `integrations` (17 routes, real crypto/JWT/HMAC code, **0 tests**), `admin` enterprise surface (retention, legal hold, eDiscovery, permission grants — untested), `checklists` (0), `templates` (0), `dependencies` (0), `knowledge` (0). Zero component tests for ~29 of 32 dialogs.
5. **UI clutter** — ~40 top-level entry points (10 sidebar tools + 28 toolbar controls), 32 modal dialogs totaling 15,176 lines, modal-in-modal stacking, a 12-field + 12-section task mega-modal, and a neon/cyberpunk theme that works against the "enterprise-ready" goal. The project's own design synthesis (`Kanban.dc.html`) already prescribes the fix; the app diverged from it.

The MCP server is solid but thin: 11 tools vs. 20 in the native (Door 1) toolset — violating the PRD's "same tools through both doors" principle — with no search, no pagination, unstructured errors, permanent claims, and Door 2 bypassing the §7.4 approval gate the PRD says applies to both doors.

---

## 2. Feature completeness audit

### 2.1 Status board

| Feature | Status | Tests | Headline gap |
|---|---|---|---|
| activity | COMPLETE | 2 | Notifications derived, no rules/preferences/digest; `notify` action is a synthetic @mention comment |
| admin | **PARTIAL** | 1 | Field ACLs uncreatable; retention sweeper ignores 4 of 5 policy types; eDiscovery is ILIKE + full-workspace dump; no audit-log viewer |
| agents | COMPLETE | 4 | Door 1/Door 2 tool parity broken (20 vs 11); `propose_schedule` in neither door |
| attachments | COMPLETE | 1 | Dead without S3 env (no local fallback); single-file, no drag-drop/preview |
| auth | **PARTIAL** | 1 | **SSO configured but unusable — no SSO sign-in path exists**; GitHub OAuth is the only login method |
| automations | COMPLETE | 9 | "AI workflow builder" is a regex; sandbox self-documents as escapable |
| board | COMPLETE | 7 | Only 1 of 8 view components has a rendering test |
| budget | COMPLETE | 2 | Labour-cost only, board-level rate |
| capacity | COMPLETE | 2 | Weekly points only; no time-off model; no agent capacity despite claim |
| chat | **PARTIAL** | 1 | No mentions, no notifications, no DM/private-channel UI, no reply affordance, raw UUID authors |
| checklists | COMPLETE | **0** | Zero tests; no workflow-guard integration ("can't Done with unchecked items" not built) |
| comments | COMPLETE | 4 | Best-covered; depth-1 only by design |
| custom-fields | COMPLETE | 1 | Values missing from TaskSnapshot → no undo; policy admin UI missing (see admin) |
| dependencies | COMPLETE | **0** | Zero direct tests; `blocked_by` only — no FS/SS/FF/lag |
| discovery | COMPLETE | 2 | **No public feedback portal** — SPEC promises tokenized external intake |
| docs | **PARTIAL** | 2 | Doc tree server-only (flat UI, no parent picker); `[[wiki links]]` absent; realtime silently degrades if `npm run realtime` down |
| epics | COMPLETE | 1 | Name-only (no dates/state/owner); no agent tools |
| extensions | **PARTIAL** | 1 | Capability set is literally `["task.read"]`; raw-JSON install UX; untested postMessage bridge; N fetches per card render |
| forms | COMPLETE | 2 | **Submit is session-gated — no public/anonymous intake**; text/textarea/number fields only |
| git | **PARTIAL** | 9 | Browse proxy sends **no auth token** and has no UI consumer; no GitHub App install flow; branch "creation" is a name string |
| graphql | **PARTIAL** | 1 | Two query fields, zero mutations, no depth/complexity limits on a public endpoint |
| integrations | COMPLETE | **0** | Real Slack HMAC / Teams JWT / Google / M365 / SMTP code — **entirely untested**; email intake address never shown to users |
| knowledge | **PARTIAL** | **0** | "Answer" = top-3 excerpts concatenated behind a template string; no embeddings/RAG; board-level authz leak (viewer can see excerpts from boards they can't open) |
| labels | COMPLETE | 1 | `updateLabel` dead code — no rename/recolor UI |
| milestones | COMPLETE | 1 | No `updateMilestone` client fn — working PATCH endpoint unreachable; rename/re-date requires curl |
| objectives | COMPLETE | 1 | Agent tools (`set_objective`/`score_key_result`) still open |
| programs | COMPLETE | 2 | None material |
| releases | COMPLETE | 2 | No post-ship changelog editing (by design) |
| reports | COMPLETE | 2 | Forecast metric (spend-rate × remaining) missing; rate model board-level only |
| requests | COMPLETE* | 1 | Shipped as read-only dialog, not the specced `view_mode='requests'` board lens; no triage from the queue |
| sharing | **PARTIAL** | 1 | **Server-complete, zero UI** — no button anywhere mints a public link or guest share; no rate limiting on public tokens; `form`/`view` share types minifiable but unrenderable |
| sla | **PARTIAL** | 1 | No task-dialog SLA section (SPEC 1.6 promise); `fetchTaskSla` + `updateSlaPolicy` dead exports; policies buried inside Automations dialog |
| sprints | COMPLETE | 1 | Full lifecycle incl. rollover, velocity, burndown |
| tasks | COMPLETE | 13 | Reference implementation; bulk edit list-view-only |
| teams | COMPLETE | 2 | No standalone team list route |
| templates | COMPLETE | **0** | Zero tests; task templates can't be applied to boards (only picked at creation) |
| time | COMPLETE | 2 | No timesheet review/approval workflow |
| views | COMPLETE | 1 | No rename (delete + re-save); `requests` lens never added to `view_mode` CHECK |
| webhooks | COMPLETE | 1 | No PATCH (delete + re-mint to edit), no delivery log, no retry queue, no test-event button |
| whiteboards | COMPLETE | 1 | Single-writer last-write-wins; CRDT transport exists but unwired |
| workspaces | COMPLETE | 4 | No workspace rename/delete; **invitations never emailed** (SMTP module exists, uncalled) |

\* Requests is complete as-built but deviates from SPEC 1.8's board-lens shape.

### 2.2 The ten most damning findings (with evidence)

1. **Sharing has no UI at all.** `src/features/sharing/` has no `components/` or `client/` directory; grep for `public-links`/`object-shares` across all `.tsx` returns nothing. Yet `server/repository.ts` implements mint/revoke/grant with tests, and public render pages exist at `src/app/public/boards/[token]/page.tsx` and `src/app/public/docs/[token]/page.tsx`. A fully built, admin-gated subsystem a user can never reach.
2. **SSO login cannot happen.** `src/features/auth/components/sign-in-card.tsx:29` is the only sign-in surface and only calls `signIn.social({provider:"github"})`. Owners can register SAML/OIDC providers in `enterprise-controls.tsx`, but no user can log in through them. SPEC 6.1 JIT provisioning is untestable from the app.
3. **Git browsing is unauthenticated and orphaned.** `src/features/git/server/browse.ts:107-112` — `authHeaders()` returns no token ("Live-only — filled by the OAuth/App handshake"); nothing in the UI calls `/api/repo-connections/[id]/tree` or `/branches`. TASKS.md marks rock 2.10 ✅ against an unreachable proxy that 401s on real private repos.
4. **Knowledge "Q&A" is not Q&A.** `src/features/knowledge/server/repository.ts:66-71` returns `"Here is the most relevant evidence…"` + top-3 lexical excerpts. No pgvector, no synthesis, zero tests, and workspace-level authz means excerpts can leak from boards a viewer can't open (contra SPEC 4.3's "never leaks a board they can't read").
5. **The "AI workflow builder" is a regex.** `src/features/automations/lib/draft.ts:6-8` keyword-matches four literal phrases; no model call; its test suite is one assertion. The dialog sells it as "Describe an automation."
6. **Field ACLs are enforced but uncreatable.** `admin/server/repository.ts:29` `setCustomFieldPolicy` is exported and called by nothing — no handler, route, or UI — while `custom-fields/server/repository.ts:51,164,242` enforces the policies in SQL. SPEC 6.3 is unadministrable.
7. **Retention policies are 80% inert.** `admin/server/retention.ts:6-8` accepts policies for task/comment/attachment/doc; `retention-sweeper.ts:6` only ever purges `activity_log`. The UI accepts what the sweeper ignores.
8. **Invitations are never delivered.** `workspaces/server/members.ts` writes the invitation row and stops; `integrations/server/email.ts:39-43` (working SMTP send) is never called from the invite path. Invitees must spontaneously sign in with the matching address.
9. **Integrations: highest blast radius, zero tests.** Real Slack HMAC v0 verification, Teams JWT-vs-JWKS validation, token encryption at rest, OAuth state — no `.test.ts` anywhere under `src/features/integrations/`.
10. **Door 2 bypasses the approval gate.** `agents/server/gate.ts` tiers (auto/changeset/block) wire only into the native runtime; REST/MCP mutations from external agents are never held for review, contra PRD §7.1's "same approval policy" (`devdocs/prd.md:253`).

### 2.3 Systemic patterns

- **Dead client exports mark missing UI**: `labels.updateLabel`, `sla.fetchTaskSla`, `sla.updateSlaPolicy` have zero call sites; `milestones` lacks an update fn entirely against a live PATCH route. Grep for exported-but-unimported client fns is a cheap recurring audit.
- **"Live-only" is the recurring euphemism for unimplemented** (git browse auth, branch creation, GitHub App install). Scoreboard rows flipped ✅ on code that cannot authenticate against a real provider.
- **No public/unauthenticated intake exists anywhere** (forms submit, feedback portal, discovery) despite SPEC §3.9 and the intake rocks depending on it — only public doc/board *read* links exist.
- **Minified one-liner modules resist review**: `docs-dialog.tsx:52` (entire dialog, one JSX statement), `task-integrations-section.tsx:20`, `extensions/server/*.ts`. Functional, but untestable and undiffable by construction.
- **Component test coverage ≈ 3 of 32 dialogs.** The 1,427-line automations dialog, 969-line task dialog (has tests), 595-line discovery dialog, and 428-line objectives dialog are otherwise unguarded against render regressions.
- **`src/middleware.ts` does not exist.** SPEC 6.8 specs IP allowlisting in middleware; it actually lives inside `requireWorkspaceRole` and is off unless `IP_ALLOWLIST_ENFORCEMENT=1` + trusted proxy header. Any code path not passing through workspace authz is unprotected by it.

### 2.4 Recommended completion order (highest value ÷ effort first)

1. **Wire the dead doors** (days, not weeks — server code already exists): sharing UI (share button on board/doc → mint/revoke dialog), SSO button + email-domain routing on sign-in, milestone/label edit affordances, task-dialog SLA section, custom-field policy admin UI, surface the email intake address, invitation email send.
2. **Close the overclaims or re-mark the scoreboard**: git App-install handshake + authed browse (or flip 2.10/2.6 back to ❌), knowledge answer synthesis via the existing agent runtime + per-board authz filter, AI workflow draft via a model call behind the existing review-then-apply gate.
3. **Public intake**: tokenized public form submit + feedback portal reusing the public-link machinery from sharing.
4. **Chat completion**: mentions (parser exists), bell integration, DM/private-channel UI, reply affordance, display names.
5. **Test debt, ordered by blast radius**: integrations → admin (retention/legal hold/eDiscovery/grants) → extensions bridge → dependencies → checklists → templates → knowledge.
6. **Durability**: webhook delivery log + retry, claim lease TTL (see §4), workspace rename/delete, timesheet approval.

---

## 3. UI/UX review

### 3.1 Current-state clutter inventory

- **~40 top-level entry points across three zones.** Sidebar "Tools" cluster: 10 dialog-opening buttons (`src/app/page.tsx:133-161`); on mobile all 10 dump inline into the header (`page.tsx:264-266`).
- **One toolbar row with 28 controls** (`board.tsx:647-860`): an 8-way view ToggleGroup, SavedViews, **17 flat ghost buttons** (Templates, Labels, Sprints, Milestones, Releases, Epics, Objectives, Fields, Insights, Schedule, Timesheet, Forms, Automations, Requests, Capacity, Budget, Discovery), an Export dropdown, plus the filter bar (search + 3 facet dropdowns).
- **32 `*-dialog.tsx` files, 15,176 lines.** Every feature is a modal. `board.tsx` alone holds 22 open-flag `useState`s and mounts 17 dialogs. Modal-in-modal stacking: the admin console opens Members/Agents/Webhooks dialogs on top of itself (`admin-console-dialog.tsx:49`).
- **Task mega-panel**: the task dialog is already a 560px right slide-over per the design synthesis (`task-dialog.tsx:403-406`, an uncommitted working-tree change), but it still stacks 12+ form fields and 12 sections (Subtasks, Checklist, Dependencies, Attachments, Time, Custom Fields, Extension panels ×2, Development, Integrations, Run Review, Comments, Activity) in one scroll (`task-dialog.tsx:57-92`, `:861-942`).
- **Theme fights the "enterprise" goal**: perpetually animated grid floor (`globals.css:165-181`), `glow`/`text-glow` utilities, cyan-alpha borders everywhere, **three display fonts** (Rajdhani/Share Tech Mono/Orbitron), decorative `"// Tools"` comment-labels in production UI (`page.tsx:183,195`), ad-hoc sizes (`text-[13px]`, `text-[10px]`) with no spacing/type tokens.
- **Already good**: the ⌘K command palette exists and already registers views/panels/tasks (`command-palette.tsx`, `board.tsx:570-625`); the sidebar shell exists; list view has real columns.

### 3.2 What the comparison references actually say

- **Trello** earns the docs' only explicit UX praise ("accessible UX") — minimal surface wins perception. **ClickUp** carries the warning label — "breadth can create complexity" — which is precisely this app's current failure mode: all 140 criteria surfaced at the top level. **Jira** is dinged for configuration complexity; **Linear** praised as "fast… opinionated."
- **The project's own design synthesis** (`docs/Kanban tool design synthesis/Kanban.dc.html`) already prescribes the enterprise shape the app abandoned: sidebar as *navigation* (My Work / Inbox / Goals / workspace list), header with breadcrumb + one primary **New** button + Ask AI, **four** visible view tabs (Board/List/Timeline/Dashboard) with the rest tucked away, task detail as a **560px right slide-over panel** with sticky comment composer, and a Linear-style palette ("Ask AI or type a command…", `C` / `G B` chords).
- `docs/task_management_feature_summary.md:179` endorses a centralized admin console as the settings home; `:234-239` endorses AI-as-reviewable-changeset (which the app's agent gate already does well).

### 3.3 Prioritized redesign proposals

**P0 — Kill the 17-button toolbar.** Keep: search/filter, view switcher, SavedViews, one primary "New task," one `⋯` overflow. The palette already registers all 17 panels — make it the primary access path, with a single "Configure board" surface as the mouse path. Files: `board.tsx:702-832` (remove), `command-palette.tsx` (keep). *This one change removes 17 of 28 toolbar controls using infrastructure that already exists.*

**P0 — View switcher: 8 tabs → 4 + "More views" dropdown** (Board / List / Timeline / Dashboard visible; Calendar, Gantt, Backlog, Roadmap behind the dropdown or SavedViews), per the synthesis. Files: `board.tsx:669-701`.

**P1 — Task panel internal restructure.** The slide-over shell already landed (`task-dialog.tsx:403-406`); the remaining problem is density inside it. Move to: main column = title, description, subtasks, comments; compact property rail = assignee, priority, estimate, dates, sprint/epic/milestone/objective as inline pickers instead of a 12-field form; Development/Integrations/Time/Extensions behind collapsed sections. Files: `task-dialog.tsx` restructure.

**P1 — One Settings surface replaces ~15 config dialogs.** Left-nav sections — Workspace (members, agents, webhooks, enterprise, IP), Board (columns, fields, labels, templates, automations, forms), Planning (sprints, milestones, releases, epics, objectives) — as a routed `/settings` page or full-height panel. Kills the modal-in-modal stack. This is also where the missing admin UIs from §2 (field ACLs, sharing, SSO) should land, fixing clutter and completeness in one motion.

**P2 — Sidebar becomes navigation, not a tool dump**: My Work / Inbox (notifications + requests) / Goals (objectives + portfolio) / boards; Docs, Chat, Whiteboards, Knowledge under one Workspace group; Reports + Insights merged under Analytics; Settings entry at bottom. Files: `page.tsx:133-200`.

**P2 — Enterprise theme pass.** Keep dark-first + cyan identity, but: remove/gate the animated grid, restrict glow to the brand mark, collapse three fonts to one UI face (Inter/Geist) + one mono for data, delete `"// Tools"` labels, neutral gray-alpha borders, and define real type/spacing tokens (12/13/14/16 on a 4px grid) replacing `text-[13px]`-style ad hoc values. Files: `globals.css`, `layout.tsx`, `page.tsx`.

**P3 — Keyboard chords + palette hints** (`C` create, `G B`/`G L` navigation, Esc closes panel; hints shown in palette rows) and **density toggle + designed empty states** (list view first) — low cost, high enterprise-perception value.

---

## 4. MCP server (Door 2)

### 4.1 Current state

11 tools in `mcp/server.mjs` (204 lines): list_board, get_task, task_history, create_task, update_task, move_task, claim_task, release_task, comment_on_task, create_subtask, flag_blocker. Good zod schemas; solid server-side authz story (workspace-scoped 404s, role 403s, claim 409s).

Weaknesses (file:line):

- Every error collapses to a bare string — a 409 claim conflict and a 500 look identical to the model (`server.mjs:66-74`).
- `JSON.parse` on any non-empty body — an HTML 502 page becomes `SyntaxError: Unexpected token '<'` (`server.mjs:42`).
- No timeout, no retry (`server.mjs:32-47`); no pagination on any tool; no size guard — a big board blows the model's context (`server.mjs:61-63`).
- `me()` caches a rejected promise forever (`server.mjs:51-52`); default board is silently `boards[0]` (`server.mjs:53-57`) — wrong-board hazard in multi-board workspaces.
- Date fields are unvalidated strings (`server.mjs:117-118, 138-139`).
- **Door 2 bypasses the §7.4 gate entirely** — `gate.ts` wires only into the native runtime, so external-agent mutations are never held for changeset review despite `prd.md:253`.
- Tool parity broken: Door 1 has 20 tools, Door 2 has 11. Missing: assign_task, rename_task, set_priority, set_labels, set_due_date, set_estimate, set_type, score_task, aim_at_milestone, list_subtasks.

### 4.2 Gaps vs. the app's own REST API

30+ feature handler files already accept agent principals via `getPrincipalFromRequest` — most new tools need **zero backend work**, only MCP wiring. Documented-for-HTTP-but-missing-from-MCP: comments list, subtasks list, labels, assignees (`docs/agent-api.md:63-70`). Also unexposed: bulk ops, dependencies list/remove, checklists, sprints, milestones, epics, custom fields, time, attachments, analytics, export, boards/columns, webhooks, objectives, notifications, git links/CI status, knowledge query. **No search endpoint exists anywhere in the app** — a true backend gap.

### 4.3 Proposed tools (prioritized)

**P0 — closes documented surface, zero backend work:**
| Tool | Backs onto |
|---|---|
| `list_comments` | GET /tasks/:id/comments |
| `list_subtasks` | GET /tasks/:id/subtasks |
| `list_labels` | GET /workspaces/:id/labels |
| `list_assignees` | GET /workspaces/:id/assignees |
| `list_dependencies` / `unflag_blocker` | GET/DELETE /tasks/:id/dependencies[/:depId] |
| `whoami` | GET /api/agent/me |

**P1 — core workflow power:**
| Tool | Notes |
|---|---|
| `search_tasks` | Biggest single win; **needs new endpoint** (`GET /api/board/:id/tasks?query=…`) — today an agent pages whole boards |
| `bulk_update_tasks` | POST /api/tasks/bulk, excluding `delete` to preserve the non-destructive cut |
| `list_sprints` / `add_task_to_sprint` | existing sprint routes |
| `list_milestones` | GET /board/:id/milestones |
| `get_checklist` / `add_checklist_item` / `check_item` | checklist routes |
| `log_time` / `get_time_entries` | time routes (note: agent time logging was deliberately dropped — revisit or scope to read-only) |
| `set_custom_field` / `list_custom_fields` | custom-field routes |
| `board_analytics` | GET /api/board/:id/analytics — standup reports |
| `list_boards` / `list_columns` | replaces the `boards[0]` guess |
| Parity set: `assign_task`, `set_priority`, `set_labels`, `set_due_date`, `set_estimate`, `set_type`, `aim_at_milestone` | mirrors Door 1's `server/tools.ts` |

**P2 — reach:**
`get_notifications`/`mark_seen` (agent inbox), `list_attachments`/`get_attachment` (size-capped), `dependency_graph` (transitive closure — needs endpoint or client-side composition), `get_git_context` (git links + CI status; high value for coding agents), `export_board`, `create_webhook` (admin-role agents), `knowledge_query`, `list_epics`/`assign_to_epic`.

### 4.4 Robustness proposals

1. **Structured errors**: `{code, status, message, retryable}` — 409→`CONFLICT_CLAIMED`, 429→`RATE_LIMITED`, 401→`AUTH_INVALID`; keep `res.status`; try/catch the JSON parse and surface status + first 200 chars of non-JSON bodies.
2. **Timeout + bounded retry**: `AbortSignal.timeout(15s)`; retry idempotent GETs ×2 with jitter; never auto-retry mutations.
3. **Idempotency keys** on create endpoints (server dedupe table; MCP generates one per create call) so network retries can't double-create.
4. **Pagination cursors** (`limit`/`cursor` + `nextCursor`) on history, comments, search; a `summary` mode on `list_board` to bound context.
5. **Claim lease TTL**: claims currently live until released — a crashed agent wedges a task. Add `expires_at` (default 30–60 min), `ttlMinutes` param, renewal via re-claim; expired holds claimable.
6. **Door-2 gate parity**: route external-agent mutations through `tierFor` (`gate.ts:80-82`) at the handler layer so changeset-tier actions from MCP are held too — or explicitly document Door 2 as auto-tier-only and fix `prd.md:253`.
7. **MCP resources** (`kanban://board/{id}`, `kanban://task/{id}`) and **MCP prompts** (`work_task` claim→history→act→comment→release loop from `agent-api.md:97-107`; `triage_board`).
8. **Change feed**: `GET /api/board/:id/events?since=<seq>` long-poll over `activity_log` + a `wait_for_changes` tool — cheaper than webhooks for stdio agents.
9. **Dry-run mode** on mutating tools returning the would-be diff (reuse the gate's `before` snapshot machinery).
10. **Rate limiting** per agent key (token bucket, 429 + Retry-After) at the principal layer.
11. **Misc**: regex-validate dates; reset `mePromise` on rejection; `KANBAN_BOARD_ID` env pin; version from package.json instead of hardcoded `0.1.0`; `structuredContent` in responses.

---

## 5. Consolidated priority roadmap

| # | Work | Why | Size |
|---|---|---|---|
| 1 | Wire dead doors: sharing UI, SSO sign-in, milestone/label edit, SLA section, field-ACL admin, invite emails | Server code exists; days of UI unlock months of built work | S–M |
| 2 | P0 UI cuts: toolbar 28→~8 controls, views 8→4 tabs | Single biggest clutter win; palette infra already exists | S |
| 3 | MCP P0/P1 tools + structured errors + claim TTL | Restores two-door parity; unblocks agent workflows | M |
| 4 | Truth pass on the scoreboard: git browse/branch/App-install, knowledge RAG, AI workflow draft — build or re-mark ❌ | Credibility of TASKS.md; three "live-only" ✅s currently fail against real providers | M–L |
| 5 | Public intake: tokenized form submit + feedback portal | SPEC §3.9; unlocks requests/discovery for external users | M |
| 6 | Settings consolidation + task slide-over panel | Kills modal-in-modal + mega-modal; enterprise IA | L |
| 7 | Test debt by blast radius: integrations → admin/enterprise → extensions bridge → dependencies/checklists/templates/knowledge | Highest-risk untested code | M (ongoing) |
| 8 | Chat completion (mentions, bell, DMs, replies, names) | SPEC 3.7 names each; parser + bell already exist | M |
| 9 | Durability: webhook retry + delivery log, workspace rename/delete, timesheet approval | Operational maturity | M |
| 10 | Theme pass + keyboard chords + empty states | Enterprise perception | S–M |

---

*Full per-feature evidence (file:line citations) is preserved in the section 2 tables and findings above; audits were conducted read-only and no code was modified.*
