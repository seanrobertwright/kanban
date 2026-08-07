---
title: Integrations and extensions
description: Slack, Teams, email, Google, Microsoft 365, generic webhooks, and the plugin framework.
sidebar:
  order: 9
---

Integrations connect your workspace to the tools you already live in — chat, email, calendars, file storage, and automation platforms. Workspace owners and admins configure them under **Settings** → **Security & compliance**. The credentials that make each provider work (OAuth client IDs, SMTP, signing secrets) are deployment-level and set up by your operator — see [Enterprise deployment](/kanban/enterprise/) for that side.

Most integrations are workspace-scoped: connect once, and every board in the workspace can use them.

## Slack

**What you get:** task notifications delivered to Slack channels, a `/task` slash command, and automatic link unfurls when someone pastes a task URL into a channel.

**Connect:** open **Settings** → **Security & compliance**, find **Work integrations**, and click **Connect Slack**. You are sent through Slack's OAuth consent screen (scopes: `chat:write`, `commands`, `links:read`, `links:write`) and land back in the app with the connection listed. Workspace admins can start the install; remove it later with the trash icon next to the connection.

**Daily use:**

- **Notifications** — an automation rule with a notify action can deliver to a Slack channel. See [Automations](/kanban/guide/automations/) for building rules; the Slack target takes a channel ID.
- **`/task create <title>`** — from any channel in the connected Slack workspace, creates a task with that title. The task lands in the first column of the workspace's first board, and Slack replies in-channel with `Created task #N: <title>`. Requests are verified against Slack's signing secret, so nothing unsigned reaches the board.
- **Link unfurls** — paste a task URL into Slack and it expands to show the task number, title, priority, and due date. Only tasks that belong to the connected workspace unfurl.

## Microsoft Teams

**What you get:** notification delivery into Teams channels via incoming webhooks, and task creation from a Teams bot.

**Connect:** open **Settings** → **Security & compliance** → **Work integrations**. In the Teams row, enter the **channel / conversation ID**, the channel's **incoming webhook URL** (the `https://…webhook.office.com/…` address Teams gives you when you add an Incoming Webhook connector), and an optional name, then click **Connect Teams**. Webhook URLs are encrypted at rest. Each channel you want to deliver to is its own connection.

**Daily use:**

- **Notifications** — automation notify actions can target a Teams connection; the message posts to that channel's webhook.
- **`create <title>`** — if your operator has registered the Bot Framework app (see [Enterprise deployment](/kanban/enterprise/)), mentioning the bot with `create <task title>` in a mapped channel creates a task in the workspace's first board column and the bot replies with the task number. Bot traffic is verified against Microsoft's published signing keys — there is no unauthenticated path.

## Email

**What you get:** outbound notification email, plus a mail-in address per board that turns email into tasks and replies into comments.

**Outbound:** an automation notify action can target any email address. The message arrives with the subject `Kanban task #N` and — this is the important part — a **Reply-To set to the board's mail-in address**.

**Inbound:** every board has a stable, unguessable address of the form `board-<id>-<token>@<your-domain>`. You get it from any notification email the board sends you — just hit reply, or copy the Reply-To address. What happens to your mail:

- **Reply to a notification** (subject like `Re: [task #N] …`) — your message body becomes a comment on task N.
- **New email to the board address** — the subject becomes a new task's title and the body its description, created in the board's first column.

The sender address must match a workspace member's account email; mail from anyone else is rejected. Quoted reply history and signatures are stripped from the stored text. Both directions require your operator to have configured SMTP and the inbound gateway — see [Enterprise deployment](/kanban/enterprise/).

## Google Workspace

**What you get:** Drive file links on tasks and Google Calendar sync of task dates.

**Connect:** open **Settings** → **Security & compliance** → **Work integrations**, then click **Connect Google Workspace**. You go through Google's consent screen (Drive metadata read-only plus Calendar) and return connected. The connection is workspace-wide; refresh tokens are stored encrypted.

**Daily use:** open any task and find the **Connected work** section:

- **Link Google Drive** — paste a Drive file URL and click the button. The file appears as a named link on the task (the app reads only metadata to resolve the name — file contents are never copied).
- **Sync Google Calendar** — click once and the task becomes an event on the connected account's primary calendar, spanning the task's start date to its due date (or one hour if only one date is set). The task needs at least a start or due date first. Syncing again after dates change updates the same event rather than duplicating it.

## Microsoft 365

The Microsoft 365 integration mirrors Google, provider for provider.

**Connect:** open **Settings** → **Security & compliance** → **Work integrations**, then click **Connect Microsoft 365** (Microsoft consent screen: profile, Files read, Calendars read/write).

**Daily use:** in the same **Connected work** section on a task:

- **Link Microsoft file** — paste a OneDrive or SharePoint URL to attach it as a named reference link.
- **Sync Outlook Calendar** — creates or updates an Outlook calendar event from the task's start/due dates, with the same one-click, idempotent behavior as Google.

Every linked file — Google or Microsoft — stays a remote reference. Links open in a new tab at the provider; nothing is downloaded into the board.

## n8n and generic automation tools

Two doors connect the board to n8n, Make, Zapier-style tools, CI, or your own scripts:

- **Outbound webhooks** — **Settings** → **Webhooks**. Register an endpoint URL (optionally filtered to specific events) and every board event POSTs to it, signed with an `x-kanban-signature-256` HMAC header. The signing secret is shown exactly once when the webhook is created — copy it then.
- **Inbound trigger tokens** — **Settings** → **Automations**, then scroll to **Inbound triggers** (admins only). Mint a named token and the row shows a full URL to copy: `POST /api/board/<id>/triggers/<token>`. Any external tool that POSTs to it fires the board's rules whose trigger is "an external tool fires it". Revoke, reactivate, or delete tokens from the same list.

Together these make the board a full n8n citizen: webhooks out, trigger URLs in, with [automation rules](/kanban/guide/automations/) deciding what happens on each side.

## BI and data export

Every board exports its tasks as a file. Open **Board tools** and choose:

- **CSV** — RFC-4180 spreadsheet-safe, one row per task.
- **JSON** — the same rows for programmatic use.

Exports include id, title, description, type, status, priority, estimate, assignee, milestone, epic, objective, sprint, value/risk/priority score, start and due dates, labels, parent task, created date, and one column per custom field defined on the board. Assignee names are resolved server-side (no bare IDs, no email addresses), and subtasks ride along under their parent's title so counts stay honest. Any viewer can export — it is a read of what the board already shows. Point your BI tool at the CSV, or script the JSON endpoint (`/api/board/<id>/export?format=json`).

## Extensions

Extensions are third-party UI panels installed into a workspace by its owner. Each one is described by a manifest and rendered in sandboxed iframes at named slots across the app.

### Installing

Open **Settings** → **Security & compliance**, then find **Extensions**. Paste the extension's manifest JSON into the text area and click **Install extension**. Only workspace **owners** can install or remove; installing again under the same name updates it in place.

A manifest looks like this:

```json
{
  "name": "burndown-widget",
  "url": "https://extensions.example.com/burndown/",
  "capabilities": ["task.read"],
  "slots": ["task_panel", "card_badge"],
  "version": "1.0.0"
}
```

Rules the app enforces on install: the `url` must be **HTTPS**, the `name` must be a short identifier (letters, digits, `.`, `_`, `-`), at least one valid slot is required, and only known capabilities are accepted. Invalid manifests are rejected outright.

### Slots

| Slot | Where it renders |
|---|---|
| `task_panel` | The **Extensions** section of the task panel — a full-width panel per extension. |
| `board_action` | A compact frame in the board toolbar, next to the board's own actions. |
| `card_badge` | A small inline badge on each task card. |
| `custom_field_renderer` | Inside the task panel alongside the task's custom fields. |

One extension can claim several slots; it renders in each.

### Capabilities and sandboxing

Extensions run in iframes with `sandbox="allow-scripts"` — no same-origin privileges, no session cookies, no access to the parent page. The only data path is a small postMessage bridge:

- The only capability today is **`task.read`**. An extension granted it can request the current task's id, title, description, and start/due dates — nothing else, and only for tasks the viewing user can already see.
- The server checks the grant on every bridge call; an extension that never declared `task.read` gets a flat refusal.
- Board-action and badge frames without a granted capability are purely presentational.

:::note
An extension sees at most what you can see, and only what its manifest declared at install time. Widening access means the owner installing an updated manifest — extensions cannot escalate themselves.
:::

Remove an extension any time from **Settings** → **Security & compliance**; its panels disappear from every task and board immediately.
