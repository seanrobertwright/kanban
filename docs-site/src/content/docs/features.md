---
title: Feature overview
description: What the platform covers, measured against a 140-criterion industry benchmark.
---

The platform was built against a research benchmark of **140 feature criteria**
across 35 task-management platforms (Jira, Linear, Asana, monday, ClickUp,
Notion, Azure DevOps, …). Current status: **132 implemented natively**; the
remaining 8 are certifications or hosted-catalog listings that cannot be
application code (SOC 2, data residency commitments, a Zapier catalog entry).

## Capability areas

| Area | Coverage | Highlights |
|---|---|---|
| Core work items | 14/14 | Tasks, subtasks, checklists, recurring tasks, custom fields, templates, bulk edit, forms intake, attachments. |
| Planning & views | 16/16 | Board, list, calendar, timeline, Gantt with critical path, roadmap, dashboards, capacity and workload, portfolio rollups, OKRs, budgets. |
| Agile & product | 14/14 | Backlog, sprints, story points, velocity, burndown, releases, discovery, feedback portal, prioritization scoring, SAFe-style hierarchy. |
| Workflow & automation | 15/15 | Trigger→condition→action rules, branching, SLAs, routing, approvals, scheduled rules, webhook triggers, sandboxed scripts, workflow templates. |
| Collaboration & knowledge | 14/14 | Docs/wiki with revisions, real-time co-editing (Yjs), chat, whiteboards (Excalidraw), meeting notes, decision logs, guest access, public sharing. |
| Reporting & analytics | 14/14 | Dashboards, custom reports, cycle/lead time, cumulative flow, timesheets, financial reports, export. |
| Enterprise & security | 13/16 | SSO/SAML, SCIM, RBAC + granular grants, audit logs, encryption at rest, admin console, retention/legal hold, eDiscovery, IP allowlists. *(3 ⛔: SOC 2 / ISO / HIPAA are audits, not code.)* |
| Developer & DevOps | 13/13 | GitHub/GitLab/Bitbucket apps, PR/commit/branch links, CI status, release management, REST + GraphQL, webhooks, repo browsing. |
| Integrations & extensibility | 8/11 | Slack, Teams, email in/out, Google Workspace, Microsoft 365, n8n-compatible webhooks, BI export, local plugin framework. *(3 ⛔: Zapier/Make/marketplace are their catalogs.)* |
| AI & agentic | 13/13 | AI writing, task creation, project generation, prioritization, scheduling proposals, risk prediction, workspace Q&A, workflow builder, meeting-notes extraction, configurable agents, agent capacity planning, AI governance. |

## Design positions worth knowing

- **Proposals, not silent mutations.** AI features (scheduling, risk, workflow
  drafts, meeting extraction) return reviewable changesets a human accepts —
  never a background write.
- **Derived, not stored.** Scores, rollups, spend, flow metrics, and risk are
  computed from stored facts at read time, so they are never stale.
- **One event stream.** Automations, webhooks, and integrations all subscribe
  to the same activity log the audit trail reads.
