# Task Management Systems Feature Summary

Research date: 2026-07-15  
Companion workbook: `task_management_systems_comparison.xlsx`

This document summarizes the 140 feature criteria used in the task management systems comparison workbook. The features are grouped into 10 capability areas so the workbook can be read as both a vendor comparison and a reference model for what modern task, project, workflow, and AI-native work systems can provide.

**Implementation status (2026-07-24):** each feature row below is marked against this repository's kanban app — ✅ means native support is implemented and tested in this codebase; ❌ means not yet implemented but buildable (specced in `../devdocs/SPEC.md`); ⛔ means **out of scope** — it cannot be delivered as application code in this repo, because it is a third-party certification (SOC 2, ISO 27001, HIPAA), an operational/hosting commitment (published uptime/SLA, data residency), or another platform's hosted catalog (a native Zapier/Make connector, an app marketplace). Current tally: **132 ✅ / 0 ❌ / 8 ⛔**. All ten capability areas are now fully resolved: every buildable feature is ✅ and the remaining eight rows are ⛔. This includes the Phase 8 local plugin/extension framework (migration 071) and all AI & Agentic rocks.

## Scoring Scale

| Score | Meaning | Interpretation |
|---:|---|---|
| 0 | None / Unknown | No meaningful native support found in public material, or not applicable. |
| 1 | Limited / Add-on | Available through workaround, marketplace app, integration, template, or narrow implementation. |
| 2 | Native / Standard | Supported natively for common use cases, possibly plan-limited. |
| 3 | Advanced / Strong | Mature native capability, broad coverage, or category-defining implementation. |

## Capability Areas

| Area | Feature Count | What It Measures |
|---|---:|---|
| Core Work Items | 14 | The basic unit of work: tasks, bugs, metadata, ownership, due dates, history, and intake. |
| Planning & Views | 16 | Ways to structure, visualize, sequence, and coordinate work across time, people, and portfolios. |
| Agile & Product | 14 | Scrum, Kanban, product delivery, backlog, release, and scaled agile support. |
| Workflow & Automation | 15 | Workflow engines, automation rules, approvals, SLAs, routing, notifications, and service processes. |
| Collaboration & Knowledge | 14 | Docs, comments, chat, whiteboards, knowledge bases, guest access, and team communication. |
| Reporting & Analytics | 14 | Dashboards, reports, cycle metrics, workload visibility, exports, timesheets, and financial reporting. |
| Enterprise & Security | 16 | Identity, permissions, compliance, auditability, admin controls, data residency, and deployment model. |
| Developer & DevOps | 13 | Git, pull requests, CI/CD, release management, APIs, webhooks, and repository traceability. |
| Integrations & Extensibility | 11 | Collaboration, office suite, automation, marketplace, plugin, and data export connectivity. |
| AI & Agentic | 13 | AI-generated work, summarization, scheduling, prioritization, workflow building, agents, and governance. |

## 1. Core Work Items

These features define whether a system can reliably capture, classify, and manage individual units of work.

| Feature | Summary |
|---|---|
| ✅ Task/work item creation | Ability to create and manage a discrete task, issue, card, story, ticket, or work package. |
| ✅ Issue/bug tracking | Native support for defects, incidents, bugs, or issue-type records. |
| ✅ Subtasks or child items | Ability to decompose work into smaller nested units. |
| ✅ Checklists | Lightweight itemized completion lists inside a task or card. |
| ✅ Recurring tasks | Automatic creation or rescheduling of repeated work. |
| ✅ Custom fields | User-defined metadata fields such as priority, impact, account, component, or score. |
| ✅ Task templates | Reusable task/project patterns for repeatable work. |
| ✅ Bulk edit | Ability to update many work items at once. |
| ✅ Forms/intake | Structured request capture from internal or external users. |
| ✅ Attachments | File attachment support on tasks or records. Stored in an S3-compatible object store when one is configured (MinIO / S3 / R2 / Supabase), and on local disk under `ATTACHMENTS_DIR` (default `./data/attachments`) when none is — so a fresh self-host has working attachments with zero configuration, and S3 is an upgrade for deployments that outgrow one disk. |
| ✅ Priority | Native priority field, ranking, or urgency indicator. |
| ✅ Labels/tags | Flexible classification labels or tags. |
| ✅ Due dates | Date-based commitment, deadline, or scheduled completion field. |
| ✅ Activity history | Audit-style item history showing changes, comments, and updates. |

## 2. Planning & Views

These features measure whether teams can see work through different operating lenses: list, board, time, roadmap, capacity, and portfolio.

| Feature | Summary |
|---|---|
| ✅ List/table view | Spreadsheet-like or list-based view of work items. |
| ✅ Kanban board | Visual flow board with columns representing statuses or stages. |
| ✅ Calendar view | Date-oriented view of deadlines, schedules, or planned work. |
| ✅ Timeline view | Time-based view for projects, initiatives, or work streams. |
| ✅ Gantt chart | Dependency-aware schedule view with bars over time. |
| ✅ Roadmap view | Higher-level product, project, or initiative planning view. |
| ✅ Milestones | Major checkpoints, releases, or target dates. |
| ✅ Dependencies | Explicit relationships such as blocked by, depends on, or predecessor/successor. |
| ✅ Critical path | Schedule analysis identifying tasks that drive completion date. |
| ✅ Resource planning | Planning work against people, teams, or roles. |
| ✅ Capacity planning | Comparing planned demand to available capacity. Demand is the board's open assigned story points; capacity is each member's weekly point budget (041) **prorated by time off** (090) — dated absences, inclusive ranges, counted as whole Mon–Fri workdays inside the Monday–Sunday week the plan reports. Over-allocation asks `committed > available`, so a member away all week while holding work is flagged even though a percentage of zero capacity has no value. Leave is self-or-admin to book, own-or-admin to revoke. |
| ✅ Workload view | Visibility into how work is distributed across people or teams. |
| ✅ Portfolio view | Cross-project or cross-program view for multiple work streams. |
| ✅ Program/initiative hierarchy | Higher-order grouping above projects, epics, or teams. |
| ✅ Goals/OKRs | Linking tasks and projects to measurable goals or objectives. |
| ✅ Budget/financial planning | Cost, budget, investment, or financial planning tied to projects or portfolios. |

## 3. Agile & Product

These features are most important for software, product, and agile delivery teams.

| Feature | Summary |
|---|---|
| ✅ Backlog management | Prioritized queue of future work. |
| ✅ Epics | Larger bodies of work composed of stories, tasks, or issues. |
| ✅ User stories | Product-delivery work item framed around user value. |
| ✅ Sprints/iterations | Timeboxed delivery cycles. |
| ✅ Scrum support | Native support for Scrum planning, execution, and review patterns. |
| ✅ Kanban WIP limits | Limits on work in progress per board column or stage. |
| ✅ Story points | Relative effort or complexity estimates. |
| ✅ Velocity | Tracking completed work per sprint or iteration. |
| ✅ Burndown chart | Sprint progress chart showing remaining work over time. |
| ✅ Release planning | Grouping work into versions, releases, or launch plans. |
| ✅ Product discovery | Support for ideas, research, feedback, validation, or discovery work. |
| ✅ Feedback intake/portal | Dedicated intake channel for customer or stakeholder feedback. Internally, the Feedback inbox (043) files raw signal under the ideas it argues for; externally, an admin mints a tokenized public portal at `/public/feedback/[token]` (085) where anyone with the link can send feedback with a sentiment and an optional free-text "who are you", rate-limited and revocable. Submit-only: the portal shows the board's name and nothing about its ideas, statuses, or demand — a public roadmap is a separate share, and minting an intake link is not consent to publish the backlog. |
| ✅ Prioritization scoring | Scoring work by value, effort, risk, reach, impact, or custom criteria. |
| ✅ Scaled Agile/SAFe | Support for enterprise agile layers such as teams, programs, ARTs, and portfolios. |

## 4. Workflow & Automation

These features determine how well a platform can model process, enforce rules, route work, and automate repeated actions.

| Feature | Summary |
|---|---|
| ✅ Custom statuses | User-defined workflow states. |
| ✅ State transition rules | Logic controlling movement between states. |
| ✅ Approval workflows | Formal approval steps before work can proceed. |
| ✅ No-code automations | Rule-based automation configured through UI. |
| ✅ Conditional branching | Automation logic that changes behavior based on conditions. |
| ✅ SLA management | Service-level timers, commitments, escalation, or breach tracking. |
| ✅ Request management | Structured management of incoming requests. |
| ✅ Forms routing | Sending form submissions to the right queue, team, project, or assignee. |
| ✅ Recurring automation rules | Scheduled or repeated automation actions. |
| ✅ Notification rules | Configurable alerts or update policies. |
| ✅ Webhook triggers | Event-driven outbound automation hooks. |
| ✅ Custom scripts/functions | Advanced scripted behavior or custom workflow functions. |
| ✅ External automation connectors | Zapier, Make, n8n, Power Automate, or similar connectors. |
| ✅ Workflow templates | Reusable process templates. |
| ✅ Incident/service workflows | Native workflows for incidents, service requests, escalations, or operational processes. |

## 5. Collaboration & Knowledge

These features show whether work is supported by shared context, decisions, documents, and team communication.

| Feature | Summary |
|---|---|
| ✅ Docs/wiki | Structured documentation space connected to work. The hierarchy 056 stored is now visible and editable: an indented tree in the sidebar built purely from the flat workspace read, a parent picker that refuses a doc's own descendants (as does the server, via a recursive ancestor walk), and `[[wiki links]]` resolved by title — clicking one opens the page, and an unresolved name stays literal `[[Name]]` and is offered as a "wanted page" that creates a child in one click. |
| ✅ Rich text pages | Flexible pages with formatted text, embeds, and structured content. |
| ✅ Real-time co-editing | Multiple users editing shared content simultaneously. |
| ✅ Mentions | `@mention` notifications for people, teams, or groups. |
| ✅ Native chat | Built-in chat or messaging. |
| ✅ Whiteboards | Visual collaboration canvas. |
| ✅ Meeting notes | Dedicated support for agendas, notes, or action items. |
| ✅ Decision logs | Capturing decisions and rationale. |
| ✅ File sharing | Managing shared files in or alongside work items. |
| ✅ Guest/client access | Controlled access for external collaborators. |
| ✅ Discussions/forums | Threaded or forum-style team discussion. |
| ✅ Knowledge base | More structured, reusable knowledge repository. |
| ✅ Comment resolution | Ability to resolve, close, or track comment threads. |
| ✅ Public sharing | Shareable public pages, boards, forms, portals, or views. |

## 6. Reporting & Analytics

These features determine whether leaders and teams can understand progress, bottlenecks, capacity, and outcomes.

| Feature | Summary |
|---|---|
| ✅ Dashboards | Configurable visual summary pages. |
| ✅ Custom reports | User-defined reports across projects, teams, or fields. Saved `report` (058, rock 5.1) over the existing read model: source (tasks/time/flow/financial) + reused saved-view filter + group_by + metric + viz, folded by a pure `runReport`, cross-board via the portfolio query. Private (member) or shared (admin), rendered by generic bar/line/table charts in the header Reports dialog. |
| ✅ Charts | Native visual charts. |
| ✅ Time tracking | Capturing time spent on work. |
| ✅ Timesheets | Timesheet entry, review, or approval. |
| ✅ Estimates | Effort or duration estimates. |
| ✅ Cycle time | Time from work start to completion. |
| ✅ Lead time | Time from request or creation to completion. |
| ✅ Cumulative flow | Flow metric showing work distribution across states over time. |
| ✅ Workload reports | Reporting on team or individual load. |
| ✅ Portfolio rollups | Aggregated reporting across projects, programs, or portfolios. |
| ✅ Financial reports | Budget, spend, billing, profitability, or cost reporting. Rock 5.2 as a `source: financial` in 5.1's builder: logged minutes × the board's `hourly_rate` (042) via budget's pure `costOf`, grouped by board/member/day across one board or the portfolio (single-currency scope surfaces the board currency). Forecasting too, as `forecast:spend` (091): spend ÷ delivered story points, applied to the points still open, added to the spend to date — the only rate the app can observe without a second number to maintain. It reads two populations at once (the time ledger and the tasks in scope), emitted as separate facts so neither measure double-counts, which is why it narrows its groupings to none/board — a task's remaining points belong to no member's time entry. Nothing open ⇒ the forecast is the spend; nothing delivered ⇒ no rate, so it reports spend to date rather than inventing a projection. |
| ✅ Export | CSV, spreadsheet, BI, or data export capability. |
| ✅ Saved filters | Reusable filtered views and query definitions. |

## 7. Enterprise & Security

These features matter most for large organizations, regulated environments, and systems used across many teams.

| Feature | Summary |
|---|---|
| ✅ SSO/SAML | Enterprise single sign-on support. Workspace-owned OIDC/SAML providers with hardened response validation are configured in the admin console. |
| ✅ SCIM/user provisioning | Automated user lifecycle management. Workspace-scoped SCIM bearer tokens provision, deactivate, and restore members. |
| ✅ RBAC | Role-based access control. |
| ✅ Granular permissions | Fine-grained permissions at workspace, project, object, field, or action level. Board, field, and action grants layer on top of workspace roles. |
| ✅ Audit logs | Administrative and security event logging. |
| ⛔ Data residency | Control over where data is stored or processed. *(Inherent to self-hosting — a deployment choice, not application code.)* |
| ⛔ SOC 2 | SOC 2 compliance or attestation. *(A third-party audit, not application code.)* |
| ⛔ ISO 27001 | ISO 27001 certification or alignment. *(A third-party certification, not application code.)* |
| ⛔ HIPAA/regulated support | Support for healthcare or other regulated compliance needs. *(A compliance program + BAA, not application code.)* |
| ✅ Encryption | Encryption in transit and at rest. App-level AES-256-GCM secret box (6.5, `shared/crypto/secret-box.ts`) encrypts third-party credentials at rest — pulled forward ahead of Phase 2's git-host secret; transport TLS is deployment-terminated (documented). |
| ✅ Admin console | Centralized administration controls for members, permissions, identity, retention, legal holds, IP policy, and integrations. |
| ✅ Retention/legal hold | Retention policies, legal hold, or compliance preservation. Activity retention sweeps respect task/comment/document/attachment holds. |
| ✅ eDiscovery | Search/export for legal or compliance discovery. Admin-only, audited, workspace-scoped search across tasks, comments, documents and the audit trail (6.7), reading the live tables so it reaches content still inside retention and content frozen by a legal hold — and each hit says whether a hold is preserving it. Matching is two-armed: stemmed full text ranked by `ts_rank` (084) **union** raw substring, because a discovery request is usually for an identifier full text tokenizes away. The 500-hit cap is reported on the bundle and in the audit row rather than silently truncating. Attachments come back as a query-scoped manifest. |
| ✅ IP allowlisting | Network access restriction by IPv4 CIDR range, deployed behind an explicitly trusted proxy header. |
| ✅ On-prem/self-hosted option | Ability to run outside the vendor's SaaS cloud. |
| ⛔ Published uptime/SLA | Public service availability commitment or SLA. *(An operational commitment by whoever hosts the deployment, not application code.)* |

## 8. Developer & DevOps

These features show whether the task system is close to code, releases, pull requests, and engineering automation.

| Feature | Summary |
|---|---|
| ✅ GitHub integration | Native or strong integration with GitHub. GitHub App webhook ingress (2.1): `X-Hub-Signature-256` verified against the connection's encrypted secret, `pull_request`/`push`/`create` payloads normalized onto the 2.0 link model, so a real GitHub App drives the board and fires Phase-1 rules. The OAuth install handshake + installation-token REST (branch creation 2.6, CI backfill 2.7) are wired to the same connection but exercised against the live API. |
| ✅ GitLab integration | Native or strong integration with GitLab. GitLab webhook ingress (2.2): `X-Gitlab-Token` verified in constant time against the connection's encrypted secret, `merge_request`/`push` payloads (incl. a branch link on a new-branch push) normalized onto the 2.0 link model, so a connected GitLab project drives the board and fires Phase-1 rules the same way GitHub does. The OAuth application handshake + REST calls (branch creation 2.6, pipeline/CI 2.7) run against the live API. |
| ✅ Bitbucket integration | Native or strong integration with Bitbucket. Bitbucket webhook ingress (2.3): `X-Hub-Signature` (HMAC-SHA256 over the raw body, the GitHub scheme) verified against the connection's encrypted secret, `pullrequest:*`/`repo:push` payloads (keyed off `X-Event-Key`, incl. a branch link for a newly created branch) normalized onto the 2.0 link model, so a connected Bitbucket repo drives the board and fires Phase-1 rules. The OAuth/Connect install + REST calls (branch creation 2.6, CI 2.7) run against the live API. |
| ✅ Pull request links | Linking work items to pull requests. Smart-commit resolution (2.0) links a PR to the task it references; the task dialog's Development section (2.4) lists them with open/merged/closed state chips and a link out. |
| ✅ Commit links | Linking work items to commits. A push webhook links each commit referencing a task; the Development section (2.5) surfaces them by subject/short-sha. |
| ✅ Branch linking/automation | Creating or tracking branches from work items. *Tracking* is 2.0: a `feature/123-slug` branch (from any of the three hosts) links to task 123 via smart-commit parsing, and because `git.branch_linked` is a Phase-1 trigger, "branch created → move to In Progress" is an ordinary automation rule (no code, built in the Automations dialog). *Creating*: `suggestBranchName` (2.6) generates the canonical branch name for a task — the exact inverse of the parser, so a name it suggests re-links to its task (a pinned round-trip invariant) — surfaced as a copyable name in the task's Development section. The provider-API call that opens the branch on the remote is live-only (needs an installation token). |
| ✅ CI/CD integration | Linking work to builds, deployments, or pipeline results. CI status (2.7, migration 054): GitHub `check_suite` and GitLab `pipeline` webhooks normalize onto a shared (status, conclusion) vocabulary and upsert a `task_ci_status` row resolved to the task by the run's head branch. A completed run fires `git.ci_passed`/`git.ci_failed` on the transition to a terminal conclusion — so "when CI fails, notify the assignee" is an ordinary Phase-1 rule — and the task dialog's Development section shows a pass/fail/running chip. |
| ✅ Release management | Managing releases, versions, or deployment milestones. Releases (2.8, migration 055): a board-scoped `release` (name/state/notes) + `task.release_id` (milestone's SET-NULL twin) that groups delivered work and rolls up done/total. A release ships planned→released either by hand or — the git-native part — when a matching git tag publishes: `normalizeGithubReleaseEvent`/`normalizeGitlabReleaseEvent` feed `ingestReleaseEvent`, which ships the planned release of the same name **in the connection's workspace only**, stamps `released_at`, and freezes auto-generated notes (compiled from the shipped tasks' titles) — logging `release.released` onto the automation sink. Self-fetching Releases dialog with task assignment. |
| ✅ REST API | Programmatic API using REST. |
| ✅ GraphQL API | Programmatic API using GraphQL. A read-first `/api/graphql` (2.9) over the existing repositories (`graphql` schema-first): `Query.board(id)` returns the board tree (columns → tasks) + milestones, `Query.task(id)` a single task. It is a second *shape*, not a second permission system — every resolver goes through `getBoard`/`getTask`, inheriting the same `requireBoardRole`/`requireTaskRole` gates and the same principal (session cookie **or** `x-agent-key`), so a query for a board the caller can't read surfaces a GraphQL error + null field, never another board's data. Mutations phase in later behind the REST gates. Guard-railed: every query is statically limited before a resolver runs — max 10 root fields (the real amplification here is aliasing one repository call N times, not depth), a cost budget where list fields multiply their subtree, and a depth cap for when the schema gains a back-edge; plus a per-principal rate limit and body/query byte ceilings. Limit and validation failures are 400s, a resolver refusal stays a 200 with `errors`. |
| ✅ CLI or SDK | Command-line or software development kit support. |
| ✅ Webhooks | Event notifications to external systems. |
| ✅ Repository browsing | Viewing or navigating repository information inside the platform. A read-through proxy (2.10): `GET /api/repo-connections/[id]/tree?path=&ref=` and `/branches` call the connected provider's contents/branches API and normalize GitHub and GitLab responses onto a common `RepoEntry`/`RepoBranch` shape (dirs before files) — **no repo data stored**, the self-hosted "hold only what we must" stance. Gated viewer+ of the connection's workspace. The provider HTTP call is injectable, so the normalization + gate are covered by tests without a network; the installation-token retrieval + response caching + a read-only file/branch panel are the live-only layer on top. |

## 9. Integrations & Extensibility

These features capture whether the platform can connect to the broader operating environment.

| Feature | Summary |
|---|---|
| ✅ Slack integration | OAuth installation, automation delivery, signed `/task create` commands, Events API ingress, and task link unfurls. |
| ✅ Microsoft Teams integration | Encrypted incoming-webhook delivery plus signed Bot Framework `create <title>` task creation. |
| ✅ Email integration | SMTP automation delivery and signed inbound board mail that creates tasks or task comments for verified workspace members. |
| ✅ Google Workspace | OAuth with encrypted refresh tokens; Drive reference links and idempotent primary-calendar synchronization for task start/due dates. |
| ✅ Microsoft 365 | OAuth with encrypted refresh tokens; OneDrive/SharePoint reference links and Outlook calendar synchronization for task start/due dates. |
| ⛔ Zapier | Zapier connector support. *(A native connector lives in Zapier's hosted catalog; our generic webhooks + n8n-compatible API already make us usable from it.)* |
| ⛔ Make | Make connector support. *(A native connector lives in Make's hosted catalog; covered in practice by our generic webhooks + REST API.)* |
| ✅ n8n | n8n connector support or practical API/webhook compatibility. |
| ⛔ Marketplace/apps | Vendor or ecosystem app marketplace. *(Requires a central hosted app catalog; N/A for a single-tenant self-hosted product.)* |
| ✅ Plugin/extensions | Extension model, power-ups, packs, plugins, or add-ons. Local extension framework (8.1, migration 071): a workspace-installed **manifest** (`https`-only URL, validated `name`, versioned) registers third-party UI into named slots (`task_panel`, `board_action`, `card_badge`, `custom_field_renderer`) with capability-gated data access. The capability set is closed and **read-only** — `task.read`, `comments.read`, `labels.read`, `board.read` — and each one buys exactly one hand-built projection from the bridge: comments carry author display names rather than ids, the board arm carries column counts rather than cards. The bridge checks two things in order, the caller's own board access and then the manifest's grant, so an extension is never a way for a human to read a board they cannot open, and a grant never carries over to a scope the manifest did not ask for. The extension's UI is sandboxed (the two-door discipline applied to third-party code). No capability writes. Managed at `/api/workspaces/[id]/extensions`, surfaced per task at `/api/tasks/[id]/extensions`. Owner installs. |
| ✅ BI/data export | Data export or BI integration for analytics. |

## 10. AI & Agentic

These features measure how far a system has moved beyond passive task tracking into AI-assisted or AI-agentic work orchestration.

| Feature | Summary |
|---|---|
| ✅ AI writing/summarization | AI-generated summaries, drafts, updates, or documentation. |
| ✅ AI task creation | Creating tasks from prompts, notes, messages, meetings, or documents. |
| ✅ AI project generation | Generating project plans, workflows, subtasks, or structures from goals. |
| ✅ AI prioritization | AI-assisted ranking, triage, scoring, or prioritization. |
| ✅ AI scheduling | AI-based calendar, deadline, workload, or task scheduling. `proposeSchedule` (4.1, `board/lib/schedule-proposal.ts`) runs the critical-path scheduler over member capacity and returns proposed `start_date`/`due_date` per task with reasons, as a reviewable changeset the human explicitly applies (served at `/api/board/[id]/schedule`). The deterministic core keeps every date explainable. Both agent doors publish it as `propose_schedule` — read-only by design: there is deliberately no tool that applies a whole proposed schedule, so an agent plans and a human (or `set_due_date`, one reviewable change at a time) applies. |
| ✅ Risk prediction | AI-assisted risk, delay, blocker, or delivery prediction. `assessRisk` (4.2, `board/lib/risk.ts`) derives a low/medium/high level per task from age-in-column, overdue slope, and blocking edges over the analytics replay — pure and unit-tested, no model needed for the signal — surfaced as a risk chip in Insights, at `GET /api/board/[id]/risk` and `GET /api/tasks/[id]/risk`, and published to both agent doors as `score_risk` — plus carried on the reads an agent already makes (`list_board` returns `risks`, `get_task` returns `risk`). |
| ✅ AI search/Q&A | Natural-language question answering over workspace knowledge. Workspace Q&A (4.3, `POST /api/workspaces/[id]/knowledge-query`) retrieves authorized task, comment, and published-document evidence, then a model writes a short answer citing the retrieved snippets by number; sources show in the Ask dialog. Retrieval is **lexical, not semantic** (084: stemmed `english` full text ranked by `ts_rank`, plus a `pg_trgm` word-similarity fallback on titles for typos) — there are no embeddings and no ANN index, so a question phrased in words the workspace never uses will not find the passage that means the same thing. Every retrieved row is filtered to the boards the asker can read. |
| ✅ AI workflow builder | AI-assisted creation of workflows, automations, apps, or processes. `POST /api/board/[id]/automations/draft` (4.4) hands the description plus the board's real column/label/member ids to a model constrained to a closed JSON schema, compiles the result into an `automation_rule`, and validates it with the same `readTrigger`/`readCondition`/`readActions` the create route runs — an id the board lacks or an action the engine has no door for comes back 400 rather than coerced. The draft is always `isEnabled: false` for an admin to review: generation, never silent activation. `script` actions are excluded by design; with no model configured it degrades to a deterministic phrasebook and says so. |
| ✅ Configurable AI agents | User-configurable agents that can take actions or perform specialized work. |
| ✅ Meeting notes to tasks | Extracting action items from meetings or transcripts. `extractMeetingActions` (4.5, `docs/lib/meeting-actions.ts`) parses a meeting doc (3.4) into reviewable action candidates with owner + due-date hints; a member explicitly promotes an item through the normal `createTask` gate, with the created task noting its source meeting doc. |
| ✅ Automated status updates | AI-generated status reports, summaries, or progress updates. |
| ✅ Human/agent resource planning | Planning work across both human contributors and AI/agent capacity. |
| ✅ AI governance/admin controls | Admin controls for AI access, permissions, data use, or governance. |

## Reading the Workbook

Use the workbook as a decision aid rather than a final procurement answer. A high score means broad public evidence of capability, not necessarily that the capability is included in every pricing tier or deployed in the same way for every customer.

Recommended usage:

1. Start with the `Overview` sheet to see market-level strengths and top overall scores.
2. Use `Feature Matrix` when comparing individual platforms across all 140 criteria.
3. Use `Platform Profiles` to understand each tool's positioning, strengths, limitations, and source URLs.
4. Use `Enterprise Features` for governance, compliance, permissions, and deployment model evaluation.
5. Use `AI Capabilities` to compare AI-native and AI-assisted workflow support.
6. Use `Integration Matrix` to evaluate developer, office suite, automation, and marketplace connectivity.
7. Use `Scoring` to compare normalized category and overall scores.
8. Use `Sources` to audit the public evidence behind platform assessments.

## Practical Takeaways

The market clusters into several recognizable patterns:

- Developer-native systems such as Jira, Azure DevOps, GitHub Projects, GitLab, Linear, YouTrack, Shortcut, Zenhub, and Plane are strongest when work needs to connect tightly to code, pull requests, releases, and engineering workflows.
- General work management systems such as Asana, monday.com, ClickUp, Wrike, Smartsheet, Airtable, Teamwork.com, and Zoho Projects tend to be strongest for cross-functional planning, workflow automation, views, dashboards, and business collaboration.
- Enterprise portfolio systems such as ServiceNow SPM, Planview, Rally, IBM Targetprocess, Microsoft Project, and Microsoft Planner Premium focus on portfolio planning, governance, resource/capacity management, and executive visibility.
- Knowledge-centric systems such as Notion, Coda, Fibery, and Basecamp emphasize context, docs, collaboration, and flexible team operating systems more than strict agile or DevOps process.
- Open-source systems such as OpenProject, Redmine, Taiga, and Plane matter when self-hosting, transparency, or customization are key requirements.
- AI-native or AI-forward systems such as Motion, Taskade, Fibery, Asana, ClickUp, Linear, Airtable, Notion, Wrike, and Plane are pushing the category toward generated projects, automated scheduling, AI summaries, AI agents, and AI-managed workflows.

The next generation of task management appears to be moving from "track tasks humans create" toward "coordinate intent, context, agents, humans, workflows, and outcomes."
