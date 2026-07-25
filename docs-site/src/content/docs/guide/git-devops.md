---
title: Git and DevOps
description: Connect GitHub, GitLab, or Bitbucket; link branches, PRs, commits, CI, and releases to tasks.
sidebar:
  order: 8
---

The board sits next to your repository, not inside it. You connect a repo once, point
the provider's webhooks at the board, and from then on branches, pull requests, commits,
CI runs, and published tags flow onto the tasks they reference — read-only facts the git
host owns, surfaced in each task's **Development** section and usable as automation
triggers. Nothing from your repository is mirrored or stored beyond the links
themselves.

## Connect a repository

A connection is a workspace-scoped record of one repository on one provider (`github`,
`gitlab`, or `bitbucket`). Creating one requires the workspace **admin** role and is
done through the REST API — there is no settings dialog for it yet; the task-side
surfaces (Development section, automations) light up on their own once webhooks arrive.

```sh
# Admin session required. Returns the connection and its signing secret — once.
POST /api/workspaces/:id/repo-connections
{ "provider": "github", "externalRepo": "acme/app" }
```

The response contains a signing secret (`ghw_` + 64 hex characters). It is shown
**exactly once** and stored encrypted server-side — copy it into the provider's webhook
settings immediately. Re-connecting the same repo does not duplicate the connection; it
rotates it in place with a fresh secret. `GET /api/workspaces/:id/repo-connections`
lists connections (secret omitted), and `DELETE /api/repo-connections/:id` disconnects —
existing task links survive with their connection cleared.

Each connection has its own webhook ingress URL containing its id. The webhook signature
is the credential: the ingress takes no session, and a bad id, wrong provider, or failed
verification all answer a flat 404/401 that leaks nothing.

### GitHub

1. Create the connection with `"provider": "github"` and the `owner/name` repo. Keep the
   returned secret.
2. In your GitHub App or repository webhook settings, set the payload URL to `POST
   /api/git/webhook/github/<connectionId>` on your board's host, content type
   `application/json`, and paste the secret into the **Secret** field.
3. Subscribe to **Pull requests**, **Pushes**, **Branch or tag creation**, **Check
   suites**, and **Releases**.

GitHub signs each delivery with `X-Hub-Signature-256` (HMAC-SHA256 over the raw body);
the board verifies it in constant time against the connection's secret before parsing
anything. `pull_request`, `push`, and `create` (branch) events feed task links;
`check_suite` feeds CI status; `release` feeds release shipping. The GitHub App install
handshake and installation-token REST calls (remote branch creation, CI backfill) attach
to the same connection but run only against the live API.

### GitLab

1. Create the connection with `"provider": "gitlab"`.
2. In the project's **Settings → Webhooks**, set the URL to `POST
   /api/git/webhook/gitlab/<connectionId>` and paste the secret into the **Secret
   token** field.
3. Enable **Merge request events**, **Push events**, **Pipeline events**, and **Release
   events**.

GitLab carries the secret as a plain token in `X-Gitlab-Token` rather than an HMAC; the
board compares it in constant time. Events are discriminated by the payload's
`object_kind`: `merge_request` and `push` feed links (a push that creates a branch also
links the branch), `pipeline` feeds CI status, `release` feeds release shipping.

### Bitbucket

1. Create the connection with `"provider": "bitbucket"`.
2. In the repository's **Settings → Webhooks**, set the URL to `POST
   /api/git/webhook/bitbucket/<connectionId>` and configure the secret — with one set,
   Bitbucket HMAC-signs the raw body and sends `X-Hub-Signature: sha256=…` (GitHub's
   scheme, minus the `-256`).
3. Choose the **Pull request** triggers
   (`pullrequest:created|updated|fulfilled|rejected`) and **Push** (`repo:push`).

Bitbucket events are keyed off the `X-Event-Key` header. PR states normalize as OPEN →
open, MERGED → merged, DECLINED/SUPERSEDED → closed. CI, release ingestion, and
repository browsing are GitHub/GitLab-only today; Bitbucket covers branch, PR, and
commit links.

## Smart-commit task resolution

Every inbound event is scanned for the tasks it references, two ways:

- **`#123` references** in free text — a PR title or body, a commit message. The `#`
  anchor and a word boundary are required, so `#123abc` and bare numbers in prose do not
  match.
- **Branch names** — the *leading* number of the branch's last path segment.
  `feature/123-add-oauth`, `bugfix/123`, and `123-fix` all resolve to task 123;
  `release/v1.2.3` resolves to nothing, deliberately, so version strings and dates never
  read as task references.

A parsed id is a candidate, never a grant: each is validated against the connection's
own workspace before anything is touched. A `#123` in repo A's payload names a task only
if that task lives in the workspace that connected repo A — one repo can never move
another workspace's board. Redeliveries are idempotent: an event whose artifact state
has not changed upserts nothing and fires no rule.

## The Development section

Open a task and, once any repo artifact references it, a read-only **Development**
section appears in the task dialog. It renders nothing on a task no repo touches, and it
has no write controls — a link's lifecycle is owned by the git host and arrives only
through the webhook ingress. Each row links out to the artifact on the provider.

| Link kind | Shown as | State chip |
|---|---|---|
| Pull request | PR title (or `#number`) | `open` (blue), `merged` (purple), `closed` (muted) |
| Commit | Commit subject (or short SHA) | — |
| Branch | Branch name | — |
| CI run | Run title (or "CI run"), linked when the provider gives a URL | `running` (dashed), `passed` (green check), `failed` (red x), `skipped` (muted) |

Anyone who can view the task can see its links (`GET /api/tasks/:id/git-links` and
`/api/tasks/:id/ci-status` — agent keys work too); managing connections stays
admin-only.

## Branch linking and the suggested branch name

At the bottom of the Development section the task shows its canonical branch name to
copy: `feature/<taskId>-<slug>` — the task's title lowercased, non-alphanumeric runs
collapsed to dashes, capped at 40 characters (`feature/<taskId>` alone if the title
slugifies to nothing).

The suggestion is the exact inverse of the branch parser, and a test pins the round-trip
invariant: `parseBranchRef(suggestBranchName(id, title)) === id`. A name the board
suggests is always a name it will later re-link to the same task, so pushing the
suggested branch links it back automatically — and fires `git.branch_linked`, which
means "branch created → move to In Progress" is an ordinary no-code automation rule.
Creating the branch on the remote via the provider's API needs a live installation
token; copy-and-push works everywhere.

## CI/CD status

GitHub `check_suite` and GitLab `pipeline` webhooks fold onto one normalized vocabulary
— a status (`queued`, `in_progress`, `completed`) plus, once completed, a conclusion
(`success`, `failure`, or `neutral` for skipped/cancelled-style outcomes). The run
resolves to its task by the run's head branch through the same smart-commit parser, and
upserts a CI row the Development section renders as the pass/fail/running chip.

Automation triggers fire only on the transition into a terminal pass or fail — a run
going `in_progress` updates the chip silently, a redelivered completed run is a no-op,
and a `neutral` conclusion fires nothing. So `git.ci_passed` and `git.ci_failed` each
fire exactly once per finished build, making "when CI fails, notify the assignee" a rule
you build in the [Automations dialog](/kanban/guide/automations/) like any other.

## Releases from git tags

A planned release on a board ships automatically when a matching tag publishes: GitHub
`release` and GitLab release webhooks feed a release ingress that finds the planned
release **of the same name in the connection's workspace only**, flips it to released,
stamps the release time, and freezes its auto-generated notes (compiled from the shipped
tasks' titles), logging `release.released`. Only a *published* tag ships — drafts and
edits do not — and a redelivered publish no-ops. Creating and managing releases
themselves is covered in [Agile and product](/kanban/guide/agile/).

## Automation triggers from git events

Every git event a connection ingests is logged as activity on the linked task, which
makes each one a first-class trigger in the Automations dialog — the trigger picker
phrases them as plain English:

| Trigger event | Fires when |
|---|---|
| `git.branch_linked` | a branch is linked |
| `git.pr_opened` | a pull request is opened |
| `git.pr_merged` | a pull request is merged |
| `git.pr_closed` | a pull request is closed |
| `git.commit_linked` | a commit is linked |
| `git.ci_passed` | CI passes |
| `git.ci_failed` | CI fails |

The event's snapshot is the linked task's own, so conditions and actions (move, assign,
label, notify, …) apply exactly as they do for board events. See
[Automations](/kanban/guide/automations/) for building rules.

### A worked flow

1. You pick up task **214, "Add OAuth login"**, on a board whose workspace has
   `acme/app` connected.
2. You cut the canonical branch and push it: `git checkout -b
   feature/214-add-oauth-login && git push -u origin HEAD`. The branch-creation webhook
   links the branch to task 214 and fires `git.branch_linked` — your "branch created →
   move to In Progress" rule moves the card, and the task's Development section is now
   live, showing the branch and the suggested name.
3. Commits pushed with `#214` in the message link individually (`git.commit_linked`).
4. You open a PR from that branch. `git.pr_opened` fires; the PR appears with an `open`
   chip.
5. CI finishes green — `git.ci_passed`, and the run shows a `passed` chip.
6. The PR merges. `git.pr_merged` fires and your "PR merged → move to Done" rule closes
   the loop; the chip turns `merged`.
7. When `v1.4` — the name of the board's planned release — publishes as a tag, the
   release ships itself with notes compiled from its tasks.

:::note
Steps 2–7 involve no board clicks at all. The branch name is the only contract: name it
what the task suggests, or reference `#<taskId>`, and the board follows the work.
:::

## Outbound webhooks and the REST API

Traffic flows out as well as in. Workspace **webhooks** (admin-gated: workspace menu →
**Webhooks**) deliver the activity stream — including every `git.*` event — to URLs you
register, optionally filtered to specific events. Each delivery is a JSON POST carrying
the activity entry, an `x-kanban-event` header, and an `x-kanban-signature-256:
sha256=<HMAC>` header signed with the webhook's secret (GitHub's convention, so every
consumer library verifies it). The secret is shown once at creation; delivery is
best-effort with a 5-second timeout, and the last delivery status is recorded per hook
so an admin can see a failing endpoint.

The same REST endpoints the web UI uses are open to programs via workspace-scoped agent
keys — see the [Agent HTTP API](/kanban/agents/http-api/).

## GraphQL endpoint

`POST /api/graphql` is a read-first GraphQL API over the same repositories as REST:
`Query.board(id)` returns the board tree (columns → tasks) plus milestones, and
`Query.task(id)` a single task. It is a second *shape*, not a second permission system —
every resolver goes through the same board/task gates with the same principal (session
cookie or `x-agent-key` header), so a board you cannot read comes back as a GraphQL
error with a null field, never another board's data. No principal is a 401; a missing
query is a 400; everything else is a standard `{ data, errors }` response.

```sh
curl -X POST https://your-board/api/graphql \
  -H "x-agent-key: kbn_..." -H "content-type: application/json" \
  -d '{"query":"{ board(id: 1) { name columns { title tasks { id title } } } }"}'
```

## Repository browsing

With a GitHub or GitLab connection in place, the board can list a repo's tree and
branches without storing any of it:

- `GET /api/repo-connections/:id/tree?path=&ref=` — the entries at a path (directories
  before files), normalized to a common shape across providers.
- `GET /api/repo-connections/:id/branches` — branch names with their protected flag.

Both are read-through proxies: each request calls the provider's contents/branches API
live and normalizes the response, so no repository data is ever held — the self-hosted
"hold only what we must" stance. Access requires viewer or better in the connection's
workspace; a provider error surfaces as a plain API error. Caller-supplied paths are
sanitized (`..` segments dropped, metacharacters encoded) so a request can never escape
the connection's own repository. Bitbucket browsing is not yet available.
