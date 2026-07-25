---
title: Security and administration
description: Roles, the admin console, granular permissions, audit, retention, legal hold, eDiscovery, and IP policy.
sidebar:
  order: 7
---

Every workspace is a self-contained security boundary: its members, roles,
permission grants, audit trail, and compliance policies all live inside it.
This page covers what you administer from inside the app. Operator-level
deployment settings (environment variables, proxy headers, SSO URLs) are on
[Enterprise deployment](/kanban/enterprise/).

## Members and invitations

Open **Members** from the admin console (or the members button in the header)
to see everyone with access to the workspace.

To invite someone:

1. Enter their email address and pick a role.
2. Click **Invite**. No email is sent — the invitation is redeemed
   automatically the next time that person signs in with the invited address.
3. Pending invitations appear at the bottom of the dialog, where an admin can
   revoke them. Invitations expire after 14 days.

Re-inviting the same address overwrites the pending invitation, so you can
correct a wrong role without revoking first. If the invitee is already a
member when they sign in, their existing role wins — a stale invitation never
upgrades or downgrades anyone.

From the same dialog admins change roles and remove members. Anyone may remove
*themselves* (leave the workspace). Removing a member releases their task
claims and unassigns their tasks in the same transaction, so nothing stays
assigned to a non-member.

Two invariants are enforced server-side:

- Only an owner can grant the owner role or modify another owner.
- The last owner can never be demoted, removed, or allowed to leave. Promote
  another owner first.

## Roles

Five workspace roles, ranked `guest < viewer < member < admin < owner`. A
higher role can do everything a lower one can.

| Capability | Guest | Viewer | Member | Admin | Owner |
|---|---|---|---|---|---|
| See boards, tasks, docs, and members | Only objects explicitly shared with them | Yes | Yes | Yes | Yes |
| Create and edit tasks, comment, log time | No | No | Yes | Yes | Yes |
| Create boards; manage columns, custom fields, automations, templates | No | No | No | Yes | Yes |
| Invite members, change roles, remove members | No | No | No | Yes | Yes |
| Create/delete agents, manage webhooks, mint share links | No | No | No | Yes | Yes |
| Open the admin console | No | No | No | Yes | Yes |
| Grant/revoke board, field, and action permissions | No | No | No | Yes | Yes |
| Place/release legal holds, run eDiscovery search and export | No | No | No | Yes | Yes |
| Grant the owner role or modify an owner | No | No | No | No | Yes |
| Save retention policies | No | No | No | No | Yes |
| Register identity providers, generate SCIM tokens | No | No | No | No | Yes |
| Edit the IP allowlist, install extensions | No | No | No | No | Yes |

Guests never inherit workspace visibility — they see only documents and boards
shared with them directly (see object shares below). Agents hold these same
roles: a viewer agent can be assigned a task it cannot itself move, exactly
like a viewer human.

## The admin console

Owners and admins see a shield icon in the workspace header. It opens the
**Admin console** dialog — central administration for the workspace. Top to
bottom it contains:

- **Summary counts** — members, agents, boards, active webhooks, and total
  audit events. Counts only, never sensitive records; each area below is where
  you manage the resource itself.
- **Members / Agents / Webhooks** buttons — open the respective management
  dialogs (member roster and invitations; agent roster, creation, and budget;
  outbound webhook endpoints).
- **Board permissions** — grant per-board capabilities on top of workspace
  roles (next section).
- **IP allowlist** — per-workspace CIDR network policy (below).
- **Retention** — per-record-type maximum age policies.
- **Legal holds** — deletion blocks on specific records.
- **eDiscovery** — audited workspace-wide search and export.
- **Identity providers** — OIDC/SAML configuration and SCIM tokens.
- **Work integrations** — Slack, Google Workspace, Microsoft 365 OAuth
  connections and Teams webhooks.
- **Extensions** — owner-installed HTTPS manifests whose task panels run in
  sandboxed iframes with only the capabilities the manifest was granted.

## Granular permissions

Workspace roles are the default policy. Permission grants layer narrowly
scoped capabilities on top: a grant only ever *adds* access to a specific
object — it never weakens what a role already allows. With no grants in
place, behavior is pure role-based access control.

### Board grants

In the console's **Board permissions** section:

1. Choose a board.
2. Choose the principal — a workspace role (`guest`, `viewer`, `member`,
   `admin`, `owner`); the API also accepts a specific member as principal.
3. Choose a capability: **read**, **write**, or **manage**.
4. Click **Grant**.

Each active grant is listed as `Board #12: guest → read` with a revoke button.
The capabilities map onto what the roles would otherwise gate: `read` lets the
principal see the board like a viewer, `write` lets them work tasks like a
member, `manage` lets them administer its structure like an admin — on that
board only. A typical use: a `guest → read` grant makes one board visible to
guests without exposing the rest of the workspace.

### Field and action grants

Two finer-grained subjects exist alongside boards:

- **Custom fields** carry a per-role access policy (`can_view` / `can_edit`
  per role). A field with no policy is visible to everyone on the board;
  once a policy exists, only listed roles see or edit it — owners and admins
  always can. This hides sensitive fields (salary, legal notes) from lower
  roles. Individual `view`/`edit` grants on a field are also supported.
- **Actions** can be delegated by name. The `automation.manage` action with
  the `execute` capability lets a specific member or role manage a board's
  automations without being promoted to workspace admin.

Field and action grants are managed through the same permissions API the
console uses (`POST /api/workspaces/[id]/permissions` with
`subjectType: "custom_field"` or `"action"`).

### Object shares and public links

Admins can share a single document or board with a guest (read-only or
editable), and mint expiring public read links for boards, docs, forms, and
views. This is how a guest role gets any access at all.

## Audit log

Every mutation in the workspace writes an append-only audit row: who acted
(human or agent), what action, and `before`/`after` snapshots of the affected
record. Rows are never rewritten, and history survives the deletion of the
things it describes — a deleted comment's author, a deleted column's name, and
a removed member's assignments all remain readable.

Recorded action families include task changes (create, update, move, assign,
prioritize, schedule, label, claim/release, delete), comments (including
resolve/reopen), columns, labels, milestones, epics, sprints, releases,
objectives, time entries, custom-field values, git events (branch/PR/commit
links, CI results), and administrative events such as `ediscovery.export`.

Where to see it:

- **Task dialog → Activity** — the full history of one task, in prose, with
  actors resolved (agents included).
- **Notification bell** — the workspace-wide feed with an unread count and
  @mention highlighting.
- **Admin console** — the total audit event count, and the eDiscovery search,
  which queries the audit log alongside tasks, comments, and docs.

## Retention and legal holds

### Retention policies

In the console's **Retention** section, an owner picks a record type —
`activity_log`, `task`, `comment`, `attachment`, or `doc` — and a maximum age
in days (1 to 36500), then clicks **Save**. One policy per record type;
saving again replaces it.

An hourly background sweep applies the policies. Today the sweeper deletes
only **audit-log rows** older than their workspace's `activity_log` policy —
audit events are append-only and self-contained, so age-based deletion is
safe. Policies for the other types are stored but not yet swept: live objects
wait for their soft-delete lifecycle so retention never destroys active work.

### Legal holds

In the **Legal holds** section, an admin picks a record type (`task`,
`comment`, `attachment`, or `doc`), enters the record's ID and a reason, and
clicks **Hold**. The server verifies the record exists in this workspace
before accepting the hold.

An active hold blocks deletion of the record — and holds cannot be bypassed
through a parent: deleting a task is refused if the task, any of its subtasks,
or any of their comments or attachments is held, and deleting a document is
refused if any document in its subtree is held. Releasing a hold (the trash
icon next to it) records who released it and when; the record becomes
deletable again.

## eDiscovery

In the console's **eDiscovery** section:

1. Enter a search term and click **Search**. The query runs across task
   titles and descriptions, comment bodies, document titles and bodies, and
   the audit log — up to 500 most recent matches, with the first ten
   previewed inline.
2. Click **Export JSON** to download `ediscovery.json`.

The bundle contains the generation timestamp, the query, every hit (type, id,
title, excerpt, created date), and a metadata inventory of every attachment
in the workspace (name, content type, size, owning task).

:::note
Discovery exports are themselves audited: every export writes an
`ediscovery.export` audit event recording who exported, the query used, and
the hit count.
:::

## IP allowlisting

In the console's **IP allowlist** section, an owner enters an IPv4 CIDR range
(for example `203.0.113.0/24`) with an optional label and clicks **Add**.
Admins can view the list; only owners change it. Entries are normalized to
their network address; malformed ranges and IPv6 are rejected rather than
silently becoming allow-alls. A workspace with no entries has no network
restriction.

:::caution
Adding CIDRs does not by itself block anyone. Enforcement activates only when
the deployment operator sets `IP_ALLOWLIST_ENFORCEMENT=1` and a trusted
client-IP header behind a proxy that overwrites it — see
[Enterprise deployment](/kanban/enterprise/). Once enforced, every workspace
request from outside the listed ranges is refused.
:::

## SSO and SCIM

In the console's **Identity providers** section, an owner registers an OIDC or
SAML provider: a provider ID (lowercase, 3–64 characters), issuer URL, and
email domain, plus client ID/secret and discovery URL for OIDC, or entry
point, signing certificate, and callback URL for SAML. Admins can view the
provider list; only owners register, remove, or issue tokens.

For each provider, **SCIM token** generates a workspace-scoped bearer token
for automated user provisioning. The token is shown once — copy it
immediately; it is stored only as a hash and can never be retrieved again.
Removing a provider also invalidates its SCIM connection, so a deprovisioned
IdP cannot keep creating accounts. SCIM endpoint URLs and provisioning
behavior are covered on [Enterprise deployment](/kanban/enterprise/).

## Agent governance

Agents are workspace members: each has a name, avatar, and one of the same
roles as humans, and every authorization check applies to them identically —
an agent's token cannot see other workspaces or exceed its role. Admins
create and delete agents from the console's **Agents** dialog, which also
sets a monthly spend cap for the workspace.

External agents are minted a bearer token exactly once at creation (only its
hash is stored); native agents carry a model and system prompt instead. Agent
tool calls pass through three approval tiers — `auto`, `changeset`, and
`block` — and their runs, actions, and pending changesets are reviewed from
the task dialog. Every agent action lands in the same audit log as human
activity. See [AI agents](/kanban/guide/ai-agents/) for the full governance
model.
