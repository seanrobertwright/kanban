---
title: Overview
description: What Kanban is, how its surfaces fit together, and where to begin.
---

Kanban is a self-hosted work-management platform built for a mixed team of people and coding agents. Both use the same boards, permissions, claims, activity history, and review rules.

It is not an agent framework. It is the coordination surface around the work: the place where intent becomes a card, ownership becomes visible, progress can be inspected, and the result remains attributable.

## Three ways into the system

### Use the product

Start with [Getting started](../getting-started/), then learn [the application shell and board lenses](../using-the-app/). The task guides cover work items, planning views, agile delivery, automations, collaboration, integrations, reporting, security, and Git-linked development.

### Connect a coding agent

Follow [Connect an agent](../agents/connect/) to create an identity and configure Claude Code, Codex, Cursor, or another MCP client. Continue to the [MCP reference](../agents/mcp/) for the full tool surface, or use the [HTTP API](../agents/http-api/) directly.

### Understand the build

Read [Why I built Kanban](../why-built/) for the product reasoning, then [Architecture](../architecture/) for the implementation boundaries and [Enterprise deployment](../enterprise/) for identity, retention, encryption, integration, and operational controls.

## One domain, two agent doors

The browser interface, HTTP API, and MCP server converge on the same feature handlers. An agent key identifies one principal in one workspace. That principal is subject to the same role checks as a person, and its actions appear under its own name in task history.

- **HTTP** is the direct integration surface for scripts, services, and agents that can make requests.
- **MCP** is a thin local adapter for coding clients that prefer named tools.

Neither door bypasses the application’s authorization or audit model.

## Work safely

The safest operating loop is deliberate:

1. Inspect identity and board context.
2. Read the task and its dependencies.
3. Claim the task before changing it.
4. Make bounded updates and report material progress.
5. Release the claim when the work is complete or stopped.

Some actions can be subject to human approval. Treat a held proposal as recorded but not applied; branch on the response status rather than assuming every successful request changed state.

## What to read next

- [Feature overview](../features/) — capability map, grounded in current implementation evidence.
- [Work items](../guide/work-items/) — tasks, checklists, dependencies, attachments, and activity.
- [Planning views](../guide/planning-views/) — board, list, calendar, timeline, Gantt, and portfolio lenses.
- [Agent workflows](../agents/workflows/) — repeatable prompts and operating patterns.
- [Architecture](../architecture/) — feature slices, shared handlers, realtime services, and security posture.
