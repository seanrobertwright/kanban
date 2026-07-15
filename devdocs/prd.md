# PRD — Agent-Native Kanban

**Status:** Draft v2 · **Date:** 2026-07-15 · **Source:** derived from `devdocs/features.md` (140-criteria reference model)
**Shape:** Phased roadmap with milestones

> **v2 changes:** open questions reviewed and mostly resolved (§12). The approval model is now designed rather than deferred (§7.4). The wedge is reframed around agent **coordination** rather than agent **execution** (§4.3, §3.3) — this is the substantive change and it reshapes M2. One v1 claim was retracted as wrong (§12, Q5).

---

## 1. Thesis

`features.md` closes with the market observation this product bets on:

> The next generation of task management appears to be moving from "track tasks humans create" toward "coordinate intent, context, agents, humans, workflows, and outcomes."

Every incumbent in that document treats AI as a **feature bolted onto a human tracker** — AI drafts a task, a human executes it. This product inverts that: **agents are first-class actors on the board.** They hold work items, move them, update them, and report back, under explicit permissions and a full audit trail. The board becomes the coordination surface between human and agent capacity rather than a human to-do list with an AI sidebar.

That is the entire reason to exist. Every scoping decision below defers to it.

---

## 2. Decisions locked

These were decided by the product owner and are treated as fixed inputs, not open questions.

| # | Decision | Value |
|---|---|---|
| 1 | Product intent | Commercial SaaS product |
| 2 | Capability areas in scope | Core Work Items + Planning & Views · Agile & Product · Workflow & Automation · AI & Agentic |
| 3 | Tenancy model | Workspaces → boards → members |
| 4 | Differentiator (wedge) | AI/agent-native execution — agents own tasks, do work, report back; board tracks human + agent capacity as peers |
| 5 | Target customer | Mid-market teams (15–100) |
| 6 | AI depth | Agents that **act on the board** — autonomously move/update/create under rules, with permissions, audit trail, undo, human-in-the-loop |
| 7 | Resourcing | Solo, part-time, no deadline |
| 8 | Deliverable shape | Phased roadmap with milestones |
| 9 | Agent scope (v2, resolved) | **Both** — board-native agents *and* an MCP surface for external agents. See §4.3. |

---

## 3. Flagged conflicts — decisions made under protest

Two pairs of the answers in §2 are in direct tension. Resolutions here are **mine, not the owner's**, and are the first thing to overturn if they're wrong.

### 3.1 Mid-market (15–100) vs. Enterprise & Security out of scope

**The conflict.** Enterprise & Security was not selected as a scope area. Teams of 15–100 do not buy software without SSO, role-based access control, and audit logs — that is the floor for a security review at that size, and `features.md` scores every serious mid-market competitor 2–3 across those criteria. A product with none of them cannot close the stated customer.

**Resolution (v1):** Fold a **minimal enterprise slice** in as a *dependency of the chosen scope*, not as new scope:

- **RBAC and granular permissions** are unavoidable — they are entailed by decision #3 (workspaces → boards → members) and doubly by decision #6 (an agent that acts needs a permission model defining what it may touch). These are in scope at M0 and M2 respectively, as dependencies.
- **Audit logs** are likewise entailed by #6 — "agents that act" is unsellable without an immutable record of what the agent did. In scope at M1.
- **SSO/SAML, SCIM, SOC 2** are deferred to a **commercialization gate (M6)** and treated as a go-to-market blocker, not a product feature. They are cheap to add late and expensive to add early.

**What this means:** you get mid-market's *technical* prerequisites early because the wedge needs them anyway, and its *compliance* prerequisites only when you actually try to sell. If the intent was genuinely "no enterprise surface at all," then the target customer must move down-market to small teams, and decision #5 should change.

### 3.2 Solo + part-time vs. the full scope

**The conflict.** Four capability areas + full workspace hierarchy + agents that act + commercial SaaS, built solo at evenings-and-weekends pace. Section 6 scores the current codebase at **~2% of the selected criteria**. The roadmap in §9 totals **48–66 weeks of part-time effort** to reach the commercialization gate — call it **12–18 months**, and that estimate is optimistic (it excludes SOC 2, support, marketing, and the first ten customers' feature demands).

**Resolution:** The roadmap is sequenced so that **each milestone is independently shippable and useful**, and a **hard cut line** is drawn after M2. Everything through M2 constitutes the wedge — the smallest thing that is genuinely differentiated and demoable. M3–M6 are the build-out to a sellable product, and should only be started if M2 proves the bet.

**Recommendation:** treat M0–M2 as the real plan and M3–M6 as a sketch. Do not commit to the full scope on this budget. Revisit after M2 with evidence.

---

## 4. Product definition

### 4.1 The problem

Mid-market teams are already running AI agents (coding agents, research agents, support triage) alongside humans. That work is invisible to their tracker: an agent's output arrives as a PR, a doc, or a Slack message, and a human then hand-copies status into Jira. The tracker models only human capacity, so planning, standups, and reporting are all systematically blind to a growing share of the work being done.

### 4.2 Target user

**Buyer:** engineering or ops leader at a 15–100 person company.
**User:** team members and team leads on delivery teams that already use agents.
**Purchase motion:** self-serve trial → team adoption → security review at expansion (this is why §3.1's compliance gate exists).

### 4.3 The wedge

**Agents are board citizens** — ours *and* theirs. The product is the **coordination layer**, not the execution engine. Concretely:

1. An agent has an **identity** on the board — an avatar, an assignee slot, a capacity.
2. An agent can be **assigned a task** the same way a person can, and **claims** it exclusively while working.
3. The agent **acts**: it moves the task through statuses, updates the description, comments its findings, and flags blockers — under a permission policy its workspace admin configured.
4. Every action is **attributed, audited, reversible, and gateable** (§7.4).
5. Planning views count **human and agent capacity as peers**.
6. **Any agent can be a citizen** — not just ours. An MCP surface lets the team's *existing* agents (Claude Code on a developer's laptop, a support triage bot, anything that speaks MCP) claim tasks, report progress, and close work.

**Why both (decision #9).** These two halves do different jobs. The board-native agent is the demo — it proves the runtime and sells the idea in thirty seconds. The MCP surface is the strategy, and it rests on an observation about the market:

> **"Agents that do the work" is already solved — by other people.** Claude Code, Codex, Cursor, and Devin write the code and open the PR today. Building an execution agent into a kanban means fighting dedicated coding agents on their turf with a fraction of the focus. That loses.

But look at what those tools leave behind: an agent finishes a task on someone's laptop and **no tracker on earth knows it happened.** That's the coordination gap, and it is precisely the gap the thesis quote (§1) describes. So the durable claim is not "our agents are the best" — it is **"our board is where everyone else's agents get coordinated."** We supply identity, permissions, claiming, audit, undo, and capacity planning. We do not supply the execution.

This rides the market rather than fighting it: every new agent vendor is demand for us, not a competitor.

### 4.4 Positioning against `features.md` clusters

The document sorts the market into six clusters. This product is deliberately none of them: it is **not** a developer-native tracker (that's the GitHub-projection wedge I did not pick), **not** a general work-management suite, **not** an enterprise portfolio system. The closest cluster is "AI-native/AI-forward" (Motion, Taskade, Fibery, ClickUp) — but every product listed there implements AI as *assist*: generate, summarize, suggest. **None of them let an agent hold and execute a work item.** That gap is the wedge.

**Defensibility.** Agent identities alone are thin — any incumbent ships those in a quarter. Two things are harder to copy:

1. **The execution substrate.** The permission model, audit trail, undo semantics, and human/agent capacity planning are genuinely hard to retrofit onto a tracker whose data model assumes a human actor. Worth a 12–24 month lead at best.
2. **The coordination position.** Being the neutral layer where heterogeneous agents from different vendors are identified, permissioned, and tracked is a *position*, not a feature — and it strengthens with every agent vendor that ships. An incumbent can copy the feature; copying the position means being the tracker teams already point their agents at.

This is still a bet on execution speed more than on a secret. But (2) is the part that compounds, which is why decision #9 keeps it in v1 rather than deferring it.

---

## 5. Non-goals (v1)

Explicitly out of scope, from the six capability areas not selected:

- **Collaboration & Knowledge** — no docs, wiki, whiteboards, chat, or knowledge base. Integrate with what teams have.
- **Reporting & Analytics** — no dashboards, custom reports, time tracking, or timesheets beyond what the agile phase (M4) strictly requires.
- **Developer & DevOps** — no deep Git/PR/CI integration. *Downgraded in v2:* the MCP surface (§4.3) largely dissolves this. We don't need to scrape GitHub to learn what a coding agent did — the agent **reports in** via MCP. What remains is a `pr_url` field on a task plus a webhook receiver, for the engineering buyer's sanity. That's a small M3 item (~1 week), not the integration project v1 feared.
- **Integrations & Extensibility** — no Slack/Teams/marketplace/Zapier. A webhook (M5) is the escape hatch.
- **Enterprise & Security** — beyond the minimal slice in §3.1.
- **Portfolio, resource, capacity, and financial planning** — beyond human/agent capacity, which the wedge requires.

Also out of scope: mobile apps, on-prem, i18n, public API (until M5).

---

## 6. Current state baseline

### 6.1 What exists

A working single-board kanban app: Next.js 16.2 (App Router, vertical slice architecture under `src/features/*`), better-sqlite3, better-auth with GitHub OAuth, @dnd-kit drag-and-drop, shadcn/ui with a custom theme. API: `GET /api/board`, `POST /api/tasks`, `PATCH|DELETE /api/tasks/:id`, all session-gated. Tables: `columns`, `tasks`, `user`, `session`, `account`, `verification`.

**Every signed-in user sees the same single board.** There is no tenancy — auth is a gate, not a model.

### 6.2 Scored against the selected criteria (`features.md` 0–3 scale)

| Area | Criteria | Score | Notes |
|---|---:|---:|---|
| Core Work Items | 14 | 2 / 42 | Task creation = 2. Everything else = 0: no subtasks, checklists, recurring, custom fields, templates, bulk edit, forms, attachments, priority, labels, due dates, activity history. |
| Planning & Views | 16 | 2 / 48 | Kanban board = 2. No list, calendar, timeline, Gantt, roadmap, milestones, dependencies, workload, portfolio, goals. |
| Agile & Product | 14 | 0 / 42 | Nothing. |
| Workflow & Automation | 15 | 1 / 45 | Columns exist but are seeded and not user-editable (= 1, limited). No rules, approvals, SLAs, webhooks. |
| AI & Agentic | 13 | 0 / 39 | Nothing. |
| **Total** | **72** | **5 / 216 (~2%)** | |

This number is the honest starting line, and it is the evidence behind §3.2.

### 6.3 Architectural findings that block the roadmap

1. **SQLite is a hard blocker for multi-tenant SaaS.** `better-sqlite3` is synchronous and single-writer, and the connection is cached on `globalThis` for one process. It cannot serve concurrent writes from many workspaces, will not survive a multi-instance deploy, and has no managed-hosting story. **Migrate to Postgres at M0** — before there is data worth migrating. (better-auth supports Postgres; the repository layer in `src/features/*/server/repository.ts` is the only code that touches the DB, so the blast radius is contained. The vertical slice architecture pays off here.)
2. **No tenancy scoping anywhere.** Every query is unscoped. Adding `workspace_id` after data exists is a painful migration; do it first.
3. **`getBoard()` reads every task in one query.** Fine for one board, not for a workspace with thousands. Needs pagination/filtering by M3.
4. **Position handling is O(n) per move** (integer positions, shifted on every reorder). Acceptable now; revisit with fractional indexing if boards get large.

---

## 7. Agent runtime (the M2 core)

The wedge's technical heart. Specified here because it drives §9's sequencing.

### 7.1 Architecture

One set of board-mutation tools, exposed through **two front doors**.

**The tool layer (shared).** `claim_task`, `move_task`, `update_task`, `comment_on_task`, `create_subtask`, `flag_blocker` — exactly the mutations the REST API already exposes, each RBAC-checked and audit-logged. This layer is the product; both doors below are thin adapters over it.

**Door 1 — board-native agents (Claude API + Tool Runner), hosted by us.** Using the TypeScript SDK (`@anthropic-ai/sdk`), already compatible with the Next.js stack:

- Tools defined via `betaZodTool` (Zod schemas → typed inputs, no hand-written JSON Schema) with `strict: true`.
- The loop runs via `client.beta.messages.tool_runner()` — the SDK drives request → execute → repeat; we supply only the tool functions.
- **Not Managed Agents.** That surface exists to host a sandboxed container for bash/file/code execution. Our agents act on *our database via our tools* — there is no sandbox to host, so its value doesn't apply and it would add a hosted dependency for nothing. This stays true as long as our agents manage the board rather than produce artifacts; per decision #9, producing artifacts is explicitly someone else's job.

**Door 2 — external agents (MCP server).** The same tools published as an MCP server, so any MCP-speaking agent the customer already runs becomes a board citizen. The external agent authenticates as a workspace-scoped agent identity and is subject to the *same* RBAC, claiming, approval policy, and audit trail as a native one. **It is not a privileged back door** — that equivalence is the whole point, and it's why both doors must sit on one tool layer rather than two parallel implementations.

Because door 2 is an adapter over tools door 1 already needs, it's roughly two additional weeks — the reason decision #9 is affordable.

### 7.2 How the runtime satisfies the wedge's requirements

| Requirement (§4.3) | Mechanism |
|---|---|
| Permission model | Each tool checks the agent's workspace role before mutating — the same RBAC layer humans use (M0). An agent is a principal, not a bypass. |
| Human-in-the-loop approval | Per the model in §7.4. Mechanically: the Tool Runner yields the assistant message *before* tools execute, so a pending call can be held, surfaced, or batched. This is exactly why the Tool Runner is preferred over a hand-written loop. |
| Audit trail | Every tool invocation writes an `activity_log` row with the agent identity, inputs, and result — before returning to the model. Same table humans write to (M1). |
| Undo | Because tool calls are discrete and logged with prior state, each is individually invertible. Undo replays the inverse mutation. |
| Deterministic params | `strict: true` on tool definitions guarantees `tool_use.input` validates against the schema — no defensive parsing of model output. |

### 7.3 Model and cost

Per the Claude API reference (cached 2026-06-24):

| Use | Model | Input / Output per MTok |
|---|---|---|
| Agent execution loop (default) | `claude-opus-4-8` | $5 / $25 |
| Cheap classification (triage scoring, labeling) | `claude-haiku-4-5` | $1 / $5 |

Configuration: adaptive thinking (`thinking: {type: "adaptive"}`) with `output_config: {effort: "high"}` for agent runs; `xhigh` only for the hardest. **Prompt caching is load-bearing** — the board snapshot is a large, stable prefix reused across every turn of a run, so `cache_control` on the board context cuts repeat-turn input cost to ~10%.

**Cost implication for the business model:** a single agent run over a board is roughly 10–30k input tokens and a few thousand output — on the order of **$0.15–0.30 per run**, before caching. Agent actions therefore have a **real marginal cost**, which means:

1. Per-workspace **budget caps and metering are a product requirement, not an afterthought** (M2). A runaway agent loop is a financial incident.
2. **Pricing cannot be pure per-seat.** It needs a usage component or a generous-but-capped allowance. This is a live open question (§12).

### 7.4 The approval model

v1 deferred this as "unsolved — the core design problem of M2." It is now designed. Two reframings did the work:

**Reframe 1 — approval is a trust mechanism, not a capability ceiling.** v1 worried that requiring human approval "retreats to the assistive tier." That was wrong (retracted in §12, Q5). What separates agent-native from assistive is *who holds the work item*, *who decides what to do*, and *whether it's tracked as capacity* — not whether a human signs off. Code review doesn't make a junior engineer assistive. This frees us to be conservative about autonomy without weakening the wedge.

**Reframe 2 — the cost of an ask is the interrupt, not the decision.** Twenty approvals across an afternoon is twenty context switches. Twenty approvals in one review is one. So per-action synchronous approval is the *wrong default*, and "auto vs. always_ask" was a false axis.

The design:

| Tier | Applies to | Behavior |
|---|---|---|
| **Auto + undo window** | Cheap, internally reversible, **externally silent** actions — label, prioritize, comment, claim | Executes immediately. Reversible for a window. No interrupt. |
| **Changeset review** (default for consequential work) | Status moves, reassignment, decomposition, bulk edits | The agent works the task to completion and proposes a **changeset**; the human reviews the whole diff at once and accepts all / some / none. **A pull request for the board.** |
| **Block** | Destructive or irreversible — delete, archive, anything with external side effects | Never autonomous. Explicit approval, always. |

Gating is **per-tool**, set by workspace policy, defaulted by blast radius.

**Rejected: confidence thresholds.** Models are poorly calibrated, and "0.85 confidence" is not something a user can reason about or write a policy against. Blast radius is objective, legible, and settable. Gate on the *action*, not on the model's self-report.

**Design constraint on the auto tier — externally silent.** An undo window is honest only for actions with no downstream effects. If moving a task to Done fires a webhook or a notification, undo doesn't unring that bell. So the auto tier is restricted to actions that are internally reversible **and** trigger nothing outside the board. This constraint tightens at M5, when the rules engine makes more actions externally audible — revisit the tier assignments there.

> **Why the tool design makes this possible.** Each mutation is a narrow, typed tool, so the harness sees `delete_task(id=47)` and can make a policy decision about it. Had agents been given one general "call the API" or "run SQL" tool, every action would look identical at the gate and we'd be forced into all-or-nothing trust. `strict: true` matters for the same reason: a gate can only apply policy to arguments it can trust are well-formed.

---

## 8. Data model (target, M0–M2)

```
workspace ──< workspace_member >── user
    │                                │
    └──< board ──< column            │
           │         │               │
           └──< task ┘               │
                 ├── assignee_id ────┘   (nullable FK → user)
                 ├── agent_id ───────────(nullable FK → agent)  ← peer to assignee
                 ├── claimed_by / claimed_at                    ← exclusive hold; prevents collisions
                 ├──< comment
                 └──< activity_log       (append-only: actor_type human|agent, actor_id, action, before, after)

agent ──> workspace          (identity: name, avatar, kind native|external,
   │                          model + system prompt + tool allowlist [native only],
   │                          credential [external only], per-tool approval policy)
   └──< agent_run            (one execution: task_id, status, token usage, cost, approval state)
        └──< agent_action     (one tool call: tool, input, result, tier, approved_by, reverted_at)

changeset ──> agent_run      (a batch of proposed actions awaiting one human review — §7.4)
```

Key shapes:

- **`task.assignee_id` and `task.agent_id` are peers** — the schema-level expression of the wedge. Exactly one is set.
- **`agent.kind` distinguishes native from external, and that is the only difference.** Both get the same RBAC, claiming, approval policy, and audit trail (§7.1, door 2). A native agent carries a model and prompt; an external one carries a credential. Everything downstream treats them identically.
- **`task.claimed_by` / `claimed_at` — cheap insurance, paid now.** Multi-agent coordination isn't a real problem until M5, but exclusive claiming is expensive to retrofit and costs about a day today. It is also **not optional** under decision #9: the moment external agents can act, two agents on one board *will* collide.
- **`activity_log` is append-only and actor-typed.** It serves the audit requirement (§3.1), the undo requirement (§4.3), and the "activity history" criterion from Core Work Items simultaneously. This is why it lands at M1 rather than being an enterprise afterthought.
- **`agent_action` stores `before`/`after`** — the undo substrate — and `tier`, recording which §7.4 gate the action passed through.

---

## 9. Phased roadmap

**Sequencing principle:** features are ordered by **what the wedge needs**, not by feature-list completeness. Core Work Items depth (M1) is included *specifically because agents need something meaningful to act on* — an agent moving a title-and-description card between three columns is a toy. Everything before M2 is the minimum substrate for the differentiator.

Estimates assume **~8–12 hrs/week solo**.

---

### M0 — Tenancy foundation · *4–6 weeks* · **built**

**Goal:** the app models workspaces, boards, and members, on infrastructure that can serve more than one of them.

- ✅ Migrate SQLite → **Postgres** (repository layer only; better-auth schema migrates too). Do this before there is data to lose.
- ✅ `workspace`, `workspace_member`, `board` tables; scope every query by `workspace_id`.
- ✅ **RBAC**: owner / admin / member / viewer, enforced in the repository layer.
- ✅ Workspace creation (auto-provisioned per user on first sign-in), board creation (admin+), member invite (by email, with redemption on first sign-in).
- ✅ Board switcher UI, plus a members dialog (invite, change role, remove, leave).

**Ships:** a real multi-tenant kanban. Independently useful.
**Acceptance:** ✅ two workspaces cannot see each other's boards, verified by test (`tenancy.test.ts`, 13 cases against a real Postgres); ✅ a viewer cannot mutate; ◐ drag-and-drop is covered at the repository level — the browser path needs one manual pass after sign-in.
**Risk:** low. Mechanical work; blast radius contained by the vertical slice architecture.

**Invite design, as built:** invitations are addressed by **email**, not user id — inviting by id is unusable, since nobody knows their own. A `workspace_invitation` row waits for someone who has never signed in, and `redeemInvitations` converts it to a membership on their next page load. **No email is sent** — there is no provider wired up, so an invite is silent until the invitee signs in with a matching address. Wiring one (Resend or similar) belongs with M6; until then the UI says so plainly rather than implying delivery.

**Invariants worth not breaking later** (each has a test in `members.test.ts`):

- **Only an owner may create or modify an owner.** Otherwise "admin" is just "owner" with an extra step: an admin could self-promote or demote the real owner and take the workspace.
- **The last owner cannot be demoted or leave.** A workspace with no owner cannot be administered or deleted by anyone — unreachable state, so the step that creates it is refused (409, not 403: it is an invariant, not a permission).
- **Redemption never changes an existing role** (`ON CONFLICT DO NOTHING`). A stale invite must not silently downgrade an admin who was invited as a viewer months ago.
- **Leaving is not an admin action.** Anyone may remove themselves; removing someone else takes admin.
- **Pending invitations are admin-only to read** — the list is a list of people's email addresses.

**Remaining M0 gap:** ✅ closed. Workspace and board creation are now reachable from the board switcher (`POST /api/workspaces`, `POST /api/workspaces/:id/boards`). The switcher lists every workspace the user belongs to rather than only the current one — without that, a second workspace would have been unreachable the moment it was created. `createWorkspace` returns the seeded board alongside the workspace, so the client can navigate straight to it instead of making a second round trip to discover it.

**Decisions taken while building, worth knowing:**

- **No data migration.** The pre-existing SQLite database held 4 throwaway test tasks and 1 user row, all recreated by signing in again. The `data/` directory is gone.
- **`columns` → `board_column`, `tasks` → `task`.** `column` is reserved in Postgres, and `columns` shadows `information_schema.columns`.
- **Tenancy is resolved by join, not a denormalized `workspace_id` on `task`.** A denormalized column would make each check a single lookup, but lets a task's workspace drift from its column's board. On a tenancy boundary, the join is worth it.
- **Missing resources report 404, never 403.** "Board does not exist" and "board belongs to another workspace" return the identical answer, so the id space cannot be enumerated by reading the status code. 403 is reserved for members who lack the rank — that leaks nothing they cannot already see.
- **Raw `pg`, no ORM.** The repositories were already raw SQL. Bundling an ORM adoption into a database migration would make two orthogonal changes in one diff. Drizzle can come later; the repository layer is the only thing that would change, which is the point of the architecture.

---

### M1 — Agent substrate · *4–6 weeks*

**Goal:** the board has enough structure for an agent's actions to be meaningful, attributable, and reversible.

Chosen from Core Work Items **for agent-readiness**, not for coverage. Ordered so the log comes first — see below:

- ✅ **`activity_log`** (append-only, actor-typed) — audit + undo substrate + the "activity history" criterion.
- **Assignees** — the slot an agent will later occupy.
- **Comments** — the agent's reporting channel.
- **User-editable statuses/columns** — agents move tasks *between* states; those states must be user-defined.
- **Priority, labels, due dates** — the fields an agent reasons over when triaging.
- **Subtasks** — an agent decomposing work needs somewhere to put the pieces.

**Sequencing correction (built):** v2 listed `activity_log` third. It is built **first**, because its acceptance criterion is that *every* mutation writes a row — so anything built before it must be reopened and retrofitted with logging. Built first, it establishes a logged-mutation path that every later M1 feature is born writing through. Same work, done once.

Deferred from this area: checklists, recurring, custom fields, templates, bulk edit, forms, attachments — none are needed for the wedge.

**Ships:** a competent team kanban. Genuinely usable, still undifferentiated.
**Acceptance:** ◐ every task mutation (create/update/move/delete) writes an `activity_log` row with actor attribution, verified by 14 cases against real Postgres; ✅ history renders on a task. The criterion re-opens as each remaining M1 feature adds mutations.
**Risk:** low.

**`activity_log` design, as built** (§8's shape, with the reasoning that survived contact):

- **The log outlives what it describes.** `task_id` carries **no foreign key** — `ON DELETE CASCADE` would destroy the record of a deletion, the row an audit trail most needs, and `SET NULL` would erase which task it was. Safe because `SERIAL` never reuses ids, so a dangling id can never come to mean a different task. `actor_id` is unconstrained for the same reason (and because it turns polymorphic at M2): a user's actions survive their account.
- **Tenancy is denormalized here, and only here.** M0's rule — resolve workspace by join, never store it — holds only while the parent outlives the child. An audit row may have no task, column, or board left to join through, so `workspace_id` lives on the row.
- **`board_id` is recorded now** though M1 renders per-task history only. It cannot be added later: backfilling means joining through tasks that may be gone. On an append-only table, a column skipped is a window of history lost permanently.
- **Append-only is enforced by a trigger, not convention** — but on `UPDATE` only. `UPDATE` rewrites history and has no legitimate caller. `DELETE` must remain possible because workspace deletion cascades through the table; blocking it would make tenants undeletable. Row-level delete protection is a database grant, and belongs with retention/export at M6.
- **Full snapshots, not diffs**, in `before`/`after` — undo replays an inverse mutation, and reconstructing a task from chained partial diffs is strictly harder than reading one row.
- **`action` is TEXT, not an enum** (unlike `workspace_role`): roles are a closed set, actions grow every milestone. The TS union in `features/activity/types.ts` is the source of truth, and readers tolerate unknown values — a row written by newer code can always reach older code.
- **No-ops are not mutations.** An update or move that changes nothing writes no row. The dialog PATCHes on close regardless of edits, so without this the history fills with entries whose before and after are identical — noise that undo would later replay as confusing no-ops.
- **`logActivity` requires a transaction client**, rather than accepting an optional one. A mutation and its log entry must commit together: logging outside the transaction records writes that rolled back, and a crash between them loses writes that happened. Taking a `PoolClient` makes the atomicity structural rather than a rule callers must remember. This is the same guarantee §7.2 states from the agent side.
- **Agents are not plumbed in, deliberately.** Callers are human-only until M2; `actor_type` exists from the first row so agents need no migration, and `logActivity` already takes an `Actor`, so M2 changes callers rather than the log.

---

### M2 — Agent v1 · **THE WEDGE** · *10–14 weeks*

**Goal:** an agent — ours or theirs — holds a task, acts on it, and reports back, under permission, audit, and undo.

**Shared substrate**

- **Agent identity**: create an agent in a workspace (name, avatar, kind, per-tool approval policy). It appears in the assignee picker beside humans.
- **Tool layer** (§7.1): board mutations via `betaZodTool` with `strict: true`, RBAC-checked per tool, `activity_log` written before returning to the caller.
- **Task claiming**: exclusive hold; a second agent cannot grab a claimed task.
- **Approval model** (§7.4): per-tool tiers — auto+undo / changeset review / block.
- **Changeset review UI**: an agent's proposed actions reviewed as one diff — accept all, some, or none.
- **Audit + undo**: every action logged with before/after; one-click revert.
- **Budget caps + cost telemetry** per workspace (§7.3). Caps are non-negotiable — a runaway loop is a financial incident. Telemetry is what makes the M6 pricing decision evidence-based rather than a guess (§12, Q1).

**Door 1 — board-native agent** *(the demo)*

- Tool Runner loop on `claude-opus-4-8`; adaptive thinking at `effort: "high"`.
- Trigger: assign a task to an agent → run starts.
- Prompt caching on the board-context prefix.

**Door 2 — MCP surface** *(the strategy, ~2 weeks on top)*

- Board tools published as an MCP server; workspace-scoped agent credentials.
- External agents subject to the identical RBAC / claiming / approval / audit path — **no privileged back door**.

**Ships: the demo that justifies the company, plus the position that defends it.** This is the cut line — evaluate everything after it against what M2 teaches.

**Acceptance:**
1. An agent assigned "triage these 20 inbound bugs" labels, prioritizes, and comments its reasoning on each; every action is attributable and revertible.
2. Consequential moves arrive as **one changeset review**, not twenty interrupts.
3. A locally-running Claude Code instance connects over MCP, claims a task, comments progress, and closes it — appearing on the board indistinguishably from a native agent.
4. Two agents cannot claim the same task.
5. Exceeding the workspace budget cap halts the run cleanly.

**Risk: high — this is the bet.** Failure modes: agents make plausible-but-wrong moves and erode trust; changeset review turns out to be as fatiguing as per-action approval; per-run cost doesn't fit any workable price point; nobody connects an external agent because the setup friction exceeds the payoff.

---

> ## ✂️ CUT LINE
> **Everything above is the wedge — roughly 4–6 months part-time. Everything below is the build-out to a sellable product — roughly another 8–10 months.**
> Do not start M3 until M2 has been in real use and the bet has evidence behind it. If M2 fails, the phases below are the wrong phases.

---

### M3 — Views · *6–8 weeks*

- List/table view, calendar view, timeline view; saved filters; task search.
- Board pagination/filtering (fixes §6.3.3).
- **Human + agent capacity in the workload view** — the wedge extended into planning, now counting external agents too.
- **`pr_url` field + webhook receiver** (~1 week). The full GitHub integration stays a non-goal — external agents report in over MCP rather than us scraping GitHub state (§5).

Deferred: Gantt, critical path, portfolio, goals/OKRs, budget — enterprise-portfolio surface the target customer doesn't need yet.

---

### M4 — Agile & Product · *8–10 weeks*

- Backlog, epics, sprints/iterations, story points, WIP limits, velocity, burndown, release planning.
- **Sprint planning counts agent capacity alongside human capacity** — the wedge's payoff in the agile surface, and the thing no competitor can express.

Deferred: SAFe, product discovery, feedback portal, prioritization scoring.

---

### M5 — Workflow & Automation · *8–10 weeks*

- Custom statuses with transition rules; no-code automation rules with conditional branching; notification rules; webhooks; workflow templates.
- **Agents become automation targets**: "when a bug is labeled P0, assign to the triage agent." This is where the wedge and the rules engine compound — agents stop being manually assigned and start being *triggered*.

Deferred: approvals, SLAs, request management, forms routing, incident workflows — service-desk surface, wrong customer.

---

### M6 — Commercialization gate · *8–12 weeks + SOC 2 lead time*

Everything required to actually charge money and pass a mid-market security review (§3.1):

- **Billing** (Stripe): seats + agent-usage metering (§7.3).
- **SSO/SAML**, SCIM provisioning.
- **Audit log export**; retention policy.
- **SOC 2 Type I** — months of calendar lead time, largely non-engineering. Start the paperwork during M4, not here.
- Onboarding, docs, marketing site.

---

### Totals

| | Effort |
|---|---|
| Wedge (M0–M2) | **18–26 weeks** (~4–6 months part-time) |
| Build-out (M3–M6) | **30–40 weeks** (~8–10 months part-time) |
| **To commercialization** | **48–66 weeks — 12–18 months, optimistic** |

Excluded from the estimate: SOC 2 execution, support, marketing, and the feature demands of the first ten customers. **A realistic figure is closer to two years.**

---

## 10. Risks

| Risk | Severity | Notes |
|---|---|---|
| **Agent trust collapse** | Critical | One bad autonomous move on a real board and the team turns the agent off forever. Undo and gating are mitigations, not solutions. The product lives or dies on agent judgment quality. |
| **Scope vs. resourcing** | High | §3.2. The most likely failure mode is not a bad product but an unfinished one. |
| **Unit economics** | High | $0.15–0.30/run against a seat price nobody has validated. Pricing deferred to M6, but instrumented at M2 (§12, Q1). |
| **Approval fatigue** | Medium *(was High)* | Downgraded: §7.4 replaces per-action approval with blast-radius tiers + batched changeset review. **Not eliminated** — the residual risk is that changeset review is itself fatiguing at volume, or that reviewers rubber-stamp. That's an M2 acceptance question. |
| **MCP adoption** | Medium *(new)* | Door 2 is worthless if nobody connects an agent. Chicken-and-egg: it needs a customer already running agents, and setup friction must stay below the payoff. Mitigated by door 1 carrying the demo alone. |
| **Incumbent fast-follow** | Medium | Linear or ClickUp ships agent identities in a quarter. The coordination position (§4.4) is the part that compounds; the feature is not defensible. |
| **Mid-market compliance wall** | Medium | Deferred to M6 by decision; if a deal needs SOC 2 at month 6, it's dead. |
| **Solo bus factor** | Medium | Inherent to the resourcing decision. |

---

## 11. Success criteria

**M2 (the only one that matters near-term):** on a real board with real work, an agent completes a triage or grooming task end-to-end, a human reviews the audit trail, and **does not turn the agent off.** Trust retention over two weeks of daily use is the metric. Everything else is vanity until that holds.

**M2, door 2:** at least one team connects an agent *they already run* and leaves it connected for two weeks. This is the earliest real signal on the coordination bet — cheap to measure, and negative here means decision #9 was wrong and the MCP surface should be cut rather than extended.

**M6:** three paying mid-market workspaces where agent-assigned tasks are ≥20% of board volume. Below that share, the wedge isn't the reason they bought, and the product is a kanban clone with a worse feature list than Jira.

---

## 12. Question log

Reviewed 2026-07-15. Five of six resolved; one deferred with a date. Kept as a record of *why*, since several resolutions are load-bearing.

**Q3 — Do agents do the work, or just manage the board? → RESOLVED: neither, exactly. Both doors.**
*Owner decision #9.* The framing was too narrow. "Agents that do the work" is already solved by Claude Code, Codex, and Cursor — building an execution agent means losing to specialists. But those tools leave a coordination gap: an agent finishes work and no tracker knows. So we ship board-native agents (the demo) **and** an MCP surface for external agents (the strategy), and we don't build an execution agent at all. This reshaped §4.3, §4.4, §7.1, §8, and M2. Managed Agents stays rejected — with execution explicitly out of scope, there is no sandbox to host.

**Q2 — The approval middle ground → RESOLVED. See §7.4.**
There was no middle ground to find, because "auto vs. always_ask" was a false axis. Gate on **blast radius** (objective, legible, settable), not confidence (uncalibrated, unreasonable-about). Default consequential work to **batched changeset review**, because the cost of an ask is the interrupt, not the decision. Confidence thresholds explicitly rejected.

**Q5 — Is `always_ask` shippable as v1? → RESOLVED, and the question was wrong. Claim retracted.**
v1 said batch-propose "arguably retreats to the assistive tier the wedge exists to escape." **That is wrong and is hereby retracted.** Agent-native vs. assistive is about who holds the work item, who decides what to do, and whether it's tracked as capacity — *not* about whether a human signs off. Code review doesn't make a junior engineer assistive. Approval is a trust mechanism, not a capability ceiling. With that corrected, Q5 collapses into Q2 and the answer is §7.4's changeset review.

**Q4 — GitHub integration → RESOLVED by Q3. Downgraded.**
Q3's MCP surface means coding agents report in rather than us inferring their work from GitHub. Remaining: a `pr_url` field and a webhook receiver at M3 (~1 week). No longer flagged as the likeliest wrong non-goal.

**Q6 — Multi-agent coordination → DEFERRED to M5, insurance paid at M2.**
The *question* (how do agents negotiate, hand off, avoid duplicating work?) isn't real until M5 triggers agents from rules. The *schema* can't wait: `claimed_by` / `claimed_at` costs a day now and a migration later (§8). Decision #9 makes claiming mandatory rather than prudent — external agents guarantee collisions.

**Q1 — Pricing model → DEFERRED to M6. Instrument now, decide later.**
Any answer today is a guess. What's actionable now: M2 logs **cost-per-run**, so M6 prices against a distribution instead of a hunch. Directional read — agent-seat pricing is the most interesting option (it prices the wedge directly and matches "agents as peers"), but a flat agent seat has a margin blowup: an agent running 1,000 tasks/month costs real inference money, one running 10 costs nothing. So it likely needs an agent seat with an included run allowance and metered overage. Note the price anchor is **what the agent replaces**, not a $20 tracker seat.

### Still genuinely open

- **Does changeset review actually beat per-action approval?** §7.4 argues it does from first principles. Unvalidated. M2 acceptance criterion #2 is the test.
- **What's the undo window?** Minutes? Until reviewed? Per-tool? Needs a real board to answer.
- **Will anyone connect an external agent?** The M2 door-2 success criterion (§11). If not, decision #9 was wrong.

---

## Appendix — Traceability to `features.md`

Criteria addressed by milestone, across the 72 in the four selected areas. *(Recounted in v2 — v1's figures were rough.)*

| Area | Now | M1 | M2 | M3 | M4 | M5 | Deferred |
|---|---:|---:|---:|---:|---:|---:|---:|
| Core Work Items (14) | 1 | 5 | — | 1 | — | — | 7 |
| Planning & Views (16) | 1 | — | — | 4 | 4 | — | 7 |
| Agile & Product (14) | — | — | — | — | 10 | — | 4 |
| Workflow & Automation (15) | — | 1 | 1 | — | — | 7 | 6 |
| AI & Agentic (13) | — | — | 6 | 1 | — | 1 | 5 |
| **Total (72)** | **2** | **6** | **7** | **6** | **14** | **8** | **29** |

**Projected coverage at M5: 43 / 72 (60%) of the selected criteria** — deliberately. The strategy is depth on the wedge over breadth against incumbents; 29 criteria are deferred or non-goals on purpose. Coverage is not the goal.

Two things worth noting in the distribution:

- **M2 scores only 7 of 72** — the lowest-coverage milestone, and the one the company depends on. It picks up 6 of the 13 AI & Agentic criteria (including *Configurable AI agents*, which `features.md` defines at level 3 as "user-configurable agents that can take actions" — the criterion no incumbent scores well on) plus *Approval workflows*. The feature-count view actively misvalues this milestone, which is a decent illustration of why a 140-criteria checklist is a comparison tool and not a strategy.
- **M4 scores highest (14)** and is the most cuttable. If the wedge works, agile ceremony is what makes it *sellable*, not what makes it *good*. If M2 disappoints, M4 is a kanban clone chasing Jira on Jira's terms.
