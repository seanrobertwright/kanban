-- M0: member invitations.
--
-- Invites are addressed by email, not user id, so you can invite someone who has
-- never signed in. There is no email provider wired up yet: an invitation simply
-- sits here until a user signs in with a matching address, at which point it is
-- redeemed into a workspace_member row.

CREATE TABLE IF NOT EXISTS workspace_invitation (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         workspace_role NOT NULL DEFAULT 'member',
  -- Keep the invitation if the inviter's account is deleted; the workspace is
  -- what grants access, not the person who sent it.
  invited_by   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '14 days'
);

-- Email comparison is case-insensitive everywhere. The app normalizes to
-- lowercase on write, but these are expression indexes so the database enforces
-- it even if a future caller forgets: "Alice@x.com" cannot be invited twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_workspace_email
  ON workspace_invitation (workspace_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_invitation_email
  ON workspace_invitation (lower(email));
