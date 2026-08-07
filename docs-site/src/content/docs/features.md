---
title: Feature overview
description: The current Kanban capability map, organized around the work people and agents coordinate.
---

Kanban’s capability map grew from research across 35 work-management products and 140 comparison criteria. That research explains the breadth of the design; it is not a completeness score.

Current behavior is documented only where the repository contains the supporting routes, handlers, data model, or integration path. At the documentation snapshot on **7 August 2026**, the application contained 42 feature slices, 188 Next.js API routes, 88 numbered SQL migrations, and 153 test files.

## Capability areas

| Area | What it covers |
|---|---|
| [Core work items](../guide/work-items/) | Tasks, subtasks, checklists, dependencies, recurring work, fields, templates, bulk updates, forms, attachments, comments, and activity. |
| [Planning and views](../guide/planning-views/) | Board, list, calendar, timeline, Gantt, backlog, roadmap, dashboard, milestones, capacity, budgets, saved views, and portfolio lenses. |
| [Agile delivery](../guide/agile/) | Backlogs, sprints, story points, velocity, burndown, releases, discovery, feedback, prioritization, programs, and objectives. |
| [Workflow and automation](../guide/automations/) | Trigger-condition-action rules, branches, SLAs, routing, approvals, schedules, webhooks, transition guards, scripts, and workflow templates. |
| [Collaboration and knowledge](../guide/collaboration/) | Versioned docs, realtime co-editing, chat, whiteboards, meeting notes, decisions, guest access, public sharing, and workspace search. |
| [Reporting and analytics](../guide/reporting/) | Dashboards, custom reports, lead and cycle time, throughput, cumulative flow, timesheets, financial rollups, risk, and export. |
| [Security and administration](../guide/security-admin/) | Roles, granular permissions, invitations, audit, encryption, retention, legal hold, eDiscovery, IP policy, SSO, and SCIM. |
| [Git and development](../guide/git-devops/) | GitHub, GitLab, and Bitbucket connections; branches, commits, pull requests, CI, releases, smart commits, REST, GraphQL, and webhooks. |
| [Integrations](../guide/integrations/) | Slack, Teams, email, Google Workspace, Microsoft 365, outbound and inbound webhooks, and data export. Provider features require the corresponding deployment credentials and external service. |
| [AI and agents](../guide/ai-agents/) | Native board agents, external agent identity, MCP and HTTP access, proposals, scheduling, risk, workspace Q&A, workflow drafting, and governance. |

## The product positions behind the list

- **One domain for people and agents.** Identity, role checks, claims, review policy, and history do not change with the client.
- **Proposals, not silent mutations.** Consequential changes can be held for a person to accept or reject.
- **Derived, not duplicated.** Scores, progress, spend, flow metrics, and delivery risk are calculated from underlying facts.
- **One inspectable history.** UI actions, agent calls, automations, webhooks, and integrations converge on attributable activity.
- **Deployment truth matters.** A route for Slack, SAML, object storage, or another provider is not a working integration until the operator supplies and verifies its external configuration.
- **Certifications are not code.** SOC 2, ISO 27001, HIPAA posture, data-residency commitments, and third-party marketplace listings require organizational or external processes. This project does not infer them from implementation.

## Choose a detailed guide

- [Use the application](../using-the-app/) for the shell and shared board lenses.
- [Connect a coding agent](../agents/connect/) for client configuration and a safe first run.
- [Architecture](../architecture/) for the feature-slice and service boundaries.
- [Enterprise deployment](../enterprise/) for production identity, secrets, integrations, retention, and network controls.
