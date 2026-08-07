---
title: Why I built Kanban
description: The product research, decisions, trade-offs, and architecture behind a board for people and coding agents.
---

Work-management software has spent decades becoming better at representing human organizations. It knows about owners, reviewers, teams, deadlines, dependencies, approvals, goals, portfolios, and reports. Then coding agents arrived and the coordination model mostly stayed the same.

An agent could change a repository, but the durable record of why it acted, what it claimed, and where it stopped often lived in a private chat or a terminal transcript. The board still assumed that a person was the only meaningful actor.

Kanban began with a narrower question than “how should AI manage work?”:

> What would a board need to believe if a coding agent were a real participant in the work rather than an automation running behind it?

The answer changed the center of the product. Agents did not need a separate AI dashboard. They needed identity, bounded authority, visible ownership, reviewable actions, and a shared record.

## The coordination gap

A coding agent can read a ticket, inspect a codebase, make a change, and report a result. None of those abilities creates coordination on its own.

Coordination requires durable answers to ordinary questions:

- Who is working on this now?
- Did they have permission to make that change?
- What context did they inspect before acting?
- Is the result applied, proposed, or waiting for review?
- What changed while they were working?
- Where should another person or agent resume?

Existing systems often answer those questions for people and treat agents as API keys with no identity of their own. That makes automation convenient but accountability weak. A generic service token can move a card, yet the history does not say which agent intended the move or whether it held the work first.

Kanban makes that distinction part of the domain model.

## Research before implementation

I did not want to invent work management from first principles. The mature parts of the category already encode years of hard lessons about planning, coordination, reporting, access control, and failure modes.

The initial research compared 35 products against 140 capability criteria. The exercise covered core work items, board and planning views, agile delivery, collaboration, automation, integrations, developer workflows, analytics, portfolio planning, administration, and enterprise controls.

That research had two purposes:

1. **Find the common grammar.** Tasks, dependencies, milestones, sprints, comments, notifications, permissions, and audit history are established concepts. A new product should not rename them for novelty.
2. **Find the missing assumption.** Most systems could bolt AI onto a human tracker, but few treated heterogeneous actors as a first-order coordination problem.

The benchmark is an input, not a completeness score. A checklist can reveal a missing capability; it cannot prove that the capability is coherent, usable, or correctly implemented. Current behavior must be supported by current code, schemas, handlers, and tests.

## The inversion

The key product decision was to invert the usual relationship:

- The conventional model is **human tracker + AI feature**.
- Kanban’s model is **shared coordination system + human and agent actors**.

That inversion produces concrete rules.

### An agent has an identity

An agent key resolves to one named agent in one workspace. The identity is not decorative metadata added after the request. It is the principal used for authorization and attribution.

### An agent uses the same board

There is no shadow queue for machine work and no synthetic task type that only agents understand. A task remains a task. Its column, assignee, labels, dependencies, checklist, comments, dates, and history mean the same thing to every actor.

### An agent follows the same permissions

The HTTP API and MCP adapter do not form a privileged back door. They converge on the application’s authorization and audit paths. A viewer can read and comment; a member can do more; workspace boundaries remain boundaries.

### An agent claims work explicitly

Assignment describes responsibility. A claim describes who is actively working now. An exclusive, expiring claim prevents two agents from silently accepting the same card and leaves the task recoverable if one disappears.

### Consequential changes can wait for review

Some mutations should be proposals rather than immediate writes. A successful transport response can mean “recorded for review,” not “applied.” The response status is part of the workflow contract.

## Why a board

A board is useful because it compresses coordination into a surface that both people and agents can inspect.

Columns expose state. Cards hold context. Claims expose active ownership. Comments preserve explanation. Dependencies express ordering. Activity history establishes attribution. Views let the same work be read as a board, list, calendar, timeline, sprint, or portfolio without inventing another source of truth.

The board is not the whole product, but it is the place where the product’s thesis becomes visible.

## Two doors, not two systems

Coding agents arrive with different integration surfaces. Some can call HTTP directly. Others already speak the Model Context Protocol.

Kanban offers both:

- A workspace-scoped [Agent HTTP API](../agents/http-api/) for any program that can make requests.
- A local [MCP server](../agents/mcp/) that names and describes the same operations as coding-agent tools.

The important decision is behind those doors: both reach the same feature handlers. Tool naming can improve intent and ergonomics without creating a second domain implementation.

## Architecture decisions

### Feature slices over layer sprawl

Each capability lives under a feature directory with its types, pure logic, server handlers, persistence code, client wrappers, and components kept close. Shared infrastructure stays shared; business vocabulary stays with the feature that owns it.

This makes the repository easier to navigate for both people and agents. A change to claims, dependencies, objectives, or notifications has an obvious home and a bounded set of neighboring contracts.

### Derive, do not duplicate

Scores, rollups, progress, spend, flow metrics, and risk should be computed from stored facts when they are read. Persisting a convenient derived number creates another fact that can become stale.

The rule costs some computation and removes a class of disagreement.

### One event history

Automations, webhooks, integrations, people, and agents all need to explain what happened. Their effects converge on an activity model that can be inspected later instead of remaining private to the mechanism that produced them.

### Self-hosting as a product constraint

Work data includes strategy, customer context, credentials, source links, internal discussions, and operational history. The system is designed to run with Postgres and the application stack under the operator’s control.

Self-hosting is not a claim that operations become free. It is a choice about where the boundary sits and who decides how data, secrets, retention, and integrations are managed.

## What I rejected

Several tempting designs would have been faster to demo and harder to trust.

### A separate AI workspace

A machine-only queue would simplify permissions initially, then force every real workflow to synchronize two sources of truth. Shared work should remain shared.

### Invisible automation identities

A single service account is easy to configure and weak at attribution. Named agents make activity comprehensible and allow policy to differ by principal.

### Unlimited autonomous mutation

The ability to call an API is not permission to change every field. Role checks, workspace scope, claims, approval tiers, and deliberately absent destructive tools preserve operator control.

### Stored summary truth

Persisted progress percentages and risk scores look efficient until the underlying work changes without updating them. Derived reads favor correctness over superficial simplicity.

### Feature-count marketing

The research corpus is useful evidence of coverage work. It is not proof that every capability deserves an unqualified launch claim. Documentation should distinguish implemented behavior, deployment-dependent integrations, and external certifications or catalog listings.

## Trade-offs

The model creates costs worth naming.

- **More identity plumbing.** Every agent request must resolve a principal and workspace before useful work begins.
- **More explicit workflow.** Claiming, commenting, releasing, and checking review status add steps compared with a fire-and-forget automation.
- **A larger surface to document.** People need task guides; agent operators need setup, tool, policy, and recovery guidance.
- **Strict boundary work.** The HTTP door, MCP door, UI, realtime service, and background integrations must not drift into different vocabularies.

The benefit is not merely safer automation. It is comprehensible collaboration.

## What changed during the build

The initial ambition was broad because the product research was broad. Building it clarified where depth matters more than catalog size.

The strongest parts are the pieces that reinforce the central model: a shared task record, explicit claims, agent attribution, common authorization, reviewable mutations, activity history, and tools that expose intent clearly. Peripheral breadth is useful only when it continues to serve that coordination model.

The documentation follows the same correction. It does not lead with a total. It starts with the problem, the actor model, the operating loop, and the evidence a reader can verify.

## Principles that remain

1. **One board for every actor.** Do not create a second truth for agents.
2. **Identity before action.** A request should be attributable before it is useful.
3. **Permissions are shared infrastructure.** Adapters must not bypass them.
4. **Claim before work.** Active ownership needs a visible, expiring contract.
5. **Derive from facts.** Do not store summaries that can drift.
6. **Review is a state, not a polite suggestion.** Held work must be distinguishable from applied work.
7. **The repository is the authority.** Documentation and product claims must follow current behavior.

## Continue reading

- [Architecture](../architecture/) maps these decisions to code and services.
- [Connect an agent](../agents/connect/) turns the actor model into a working client configuration.
- [Agent workflows](../agents/workflows/) shows claim-to-release operating patterns.
- [Feature overview](../features/) maps the current product surface without turning research into a completeness claim.
