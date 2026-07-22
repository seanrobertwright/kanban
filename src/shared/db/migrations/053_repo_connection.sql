-- Git provider connection + link model (053, rock 2.0) — the spine of Phase 2.
--
-- The app already has HMAC-verified egress (webhooks 025): every mutation crosses
-- the process boundary as a signed POST. 2.0 is the mirror — a verified *ingress*.
-- A git host (GitHub/GitLab/Bitbucket) POSTs its push/PR/pipeline events here; the
-- provider adapter (2.1) verifies the signature, normalizes the payload, and
-- upserts a task_git_link. Because that upsert logs through logActivity, a git
-- event rides the very same post-commit sink webhooks and the automation engine
-- subscribe to (045) — so "PR merged → move task to Done" is an ordinary Phase-1
-- rule, no second bus. Git and automation compose.
--
-- One link model for all three providers (2.0), so PR/commit/branch/CI/release
-- surfacing (2.4–2.10) is provider-agnostic downstream — only the adapter that
-- fills task_git_link is vendor-specific.

-- A connected repository, per workspace. The inbound signing secret is stored
-- ENCRYPTED (6.5, shared/crypto/secret-box) — unlike 025's outbound key, which is
-- plaintext because it only signs what we send. This secret authenticates what a
-- third party sends *us*, so a database dump must not yield it in the clear.
CREATE TABLE IF NOT EXISTS repo_connection (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'bitbucket')),
  -- owner/name — the repository the provider names in its webhook payloads.
  external_repo TEXT NOT NULL CHECK (btrim(external_repo) <> ''),
  -- The provider's install identity: a GitHub App installation id, a GitLab
  -- project id, etc. Nullable until the install handshake completes (2.1).
  install_id TEXT,
  -- The inbound webhook signing secret, encrypted at rest (v1.<iv>.<tag>.<ct>).
  -- Minted here, shown to the admin exactly once (the 025 / agent-token
  -- convention), and configured into the provider's webhook settings.
  secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  -- The admin who connected the repo; git events are logged *as* this principal,
  -- the automation_rule.created_by model — an integration acts as its author, so
  -- its activity has a real actor (activity_log has no 'system' actor kind). CASCADE
  -- for that reason: a connection cannot outlive the identity its events attribute
  -- to, exactly as a rule cannot outlive the identity it acts as.
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Overwritten per delivery — enough for an admin to see the integration is live
  -- without a delivery-log table nobody prunes (webhook.last_delivery_at's shape).
  last_event_at TIMESTAMPTZ,
  -- One connection per (workspace, provider, repo): re-connecting the same repo
  -- rotates the row rather than duplicating it.
  UNIQUE (workspace_id, provider, external_repo)
);

CREATE INDEX IF NOT EXISTS idx_repo_connection_ws ON repo_connection(workspace_id);

-- A development artifact tied to a task — the branch/PR/commit that delivers it.
-- Populated by the ingress: a git event names a task via "smart commit" parsing
-- (a `#123` reference in a PR title/commit message, or a `feature/123-slug` branch
-- name), the mapping every leader uses. The row is what the task dialog's
-- Development section (2.4/2.5) surfaces; state chips read `state`.
CREATE TABLE IF NOT EXISTS task_git_link (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  -- Provenance; SET NULL so disconnecting a repo un-ties the historical links
  -- rather than destroying the record that a PR once delivered this task.
  connection_id INTEGER REFERENCES repo_connection(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('branch', 'pr', 'commit')),
  -- The PR number, the commit sha, or the branch name — the provider's own id for
  -- the artifact, TEXT because a sha is not a number.
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  -- open|merged|closed for a PR; NULL for a branch or a commit (no lifecycle).
  state TEXT CHECK (state IN ('open', 'merged', 'closed') OR state IS NULL),
  title TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The upsert key: a redelivered event for the same artifact updates in place, so
  -- a PR that opens then merges is one row that changes state, not two rows.
  UNIQUE (task_id, provider, kind, external_id)
);

CREATE INDEX IF NOT EXISTS idx_task_git_link_task ON task_git_link(task_id);
