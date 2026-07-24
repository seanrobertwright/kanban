# Enterprise deployment

## IP allowlists

IP policies are stored per workspace. Enforcement is disabled unless both values
below are explicitly configured by the deployment operator:

```text
IP_ALLOWLIST_ENFORCEMENT=1
TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
```

`x-real-ip` is also supported. The reverse proxy must overwrite the selected
header with the original client address; do not forward a client-supplied value.
When a workspace has no CIDRs configured, it remains open. CIDRs currently use
IPv4 notation.

## SSO and SCIM

Better Auth SSO (SAML/OIDC) and SCIM are enabled. Workspace owners create and
own provider configurations through the workspace identity-provider API; SCIM
tokens are issued only for a provider owned by that workspace. Configure the IdP
to use `/api/auth/scim/v2` as its SCIM base URL and the issued bearer token.
Tokens are stored hashed and are shown only when issued. Provisioned users are
added as workspace members; a SCIM deactivation immediately revokes their
workspace membership and sessions, while reactivation restores the default
`member` role. Removing an identity provider also invalidates its SCIM token.

SAML is configured to require timestamped, correlated responses and reject
deprecated cryptographic algorithms. Set `BETTER_AUTH_URL` to the public origin
and, if more than one origin is legitimate, set
`BETTER_AUTH_TRUSTED_ORIGINS` to a comma-separated allowlist before registering
a production provider. Run `npm run db:setup` (or the compose `migrate` service)
after deployment so both Better Auth and application migrations are current.

## Secret encryption and TLS

Set a dedicated, high-entropy `ENCRYPTION_KEY` in production (the application
falls back to `BETTER_AUTH_SECRET` only for compatibility). Application-owned
Git ingress and outbound-webhook signing secrets use AES-256-GCM at rest; legacy
webhook keys are converted safely when a Node application instance starts. Do
not rotate this value without a planned re-encryption procedure, since existing
ciphertext requires the current key. Terminate TLS at the reverse proxy and set
`BETTER_AUTH_URL` to the external `https://` origin.

## First-party integrations

All OAuth redirect URLs below must be registered exactly against the public
`BETTER_AUTH_URL`. Integration access and refresh tokens, plus Teams webhook
URLs, are AES-256-GCM encrypted in `integration_connection`; never add them to
client-side configuration.

### Slack and Teams

Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SIGNING_SECRET`. The
Slack app uses `/api/integrations/slack/callback`, `/api/integrations/slack/commands`,
and `/api/integrations/slack/events`. Configure the slash command text as
`/task create <title>`. The command and Events API both reject unsigned or
older-than-five-minute requests.

For Teams bot task creation, set `TEAMS_BOT_APP_ID` and point the bot messaging
endpoint at `/api/integrations/teams/messages`. Bot Framework bearer tokens are
verified using its published OpenID signing keys, issuer, expiry, audience, and
service URL. Configure a Teams incoming webhook in the admin console for each
outgoing notification channel; its configured channel/conversation ID is also
the binding for incoming `create <title>` messages.

### Email

Outbound notification email requires `SMTP_URL` and `SMTP_FROM`. Inbound email
requires `EMAIL_INBOUND_DOMAIN` and `EMAIL_INBOUND_SIGNING_SECRET`. Route a mail
gateway to `POST /api/integrations/email/inbound` with JSON
`{to,from,subject,text,html}` and headers:

```text
x-kanban-email-timestamp: unix seconds
x-kanban-email-signature: v1=<HMAC-SHA256(timestamp + "." + exact raw body)>
```

The handler accepts only five-minute signed deliveries to the board reply
address, and only a sender whose email is a member of that board's workspace.
Use a subject beginning `Task #123` (optionally `Re:`) to add a comment; other
messages create tasks. Rotating `EMAIL_INBOUND_SIGNING_SECRET` invalidates the
deterministic board reply addresses, so update the mail routing at the same
time.

### Google Workspace and Microsoft 365

Google requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with redirect
`/api/integrations/google/callback`. Enable Drive and Calendar APIs and grant
Drive metadata read plus Calendar write access. Microsoft requires
`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optionally
`MICROSOFT_TENANT_ID` (defaults to `organizations`), with redirect
`/api/integrations/microsoft/callback`. Grant delegated `User.Read`,
`Files.Read`, and `Calendars.ReadWrite` permissions plus `offline_access`.

Task endpoints create Drive/OneDrive/SharePoint reference links and synchronize
start/due dates to the connected user's primary calendar. They do not proxy or
store third-party file bytes, and calendar syncs are idempotent per task.
