---
title: Enterprise deployment
description: Hardening a production deployment — SSO, SCIM, encryption, IP policy, integrations.
---

Everything below is configured by the deployment operator via environment
variables and the in-app admin console. The platform is single-tenant and
self-hosted: data residency is wherever you run Postgres.

## Identity: SSO and SCIM

Workspace owners create SAML/OIDC provider configurations through the
identity-provider API (surfaced in the admin console). SCIM tokens are issued
per provider, stored hashed, and shown only once.

- SCIM base URL for your IdP: `/api/auth/scim/v2` with the issued bearer token.
- Provisioned users become workspace members; **SCIM deactivation immediately
  revokes membership and sessions**; reactivation restores the `member` role.
- Removing a provider invalidates its SCIM token.
- SAML validation requires timestamped, correlated responses and rejects
  deprecated algorithms.

```sh
BETTER_AUTH_URL=https://kanban.example.com   # the public origin
BETTER_AUTH_TRUSTED_ORIGINS=...              # comma-separated, if >1 origin
```

Run `npm run db:setup` (or the compose `migrate` service) after deployment so
auth and application migrations are current.

## Secret encryption and TLS

```sh
ENCRYPTION_KEY=<dedicated high-entropy value>
```

Git ingress secrets, webhook signing keys, and integration OAuth tokens are
AES-256-GCM encrypted at rest with this key. **Do not rotate it without a
planned re-encryption** — existing ciphertext needs the current key. Terminate
TLS at the reverse proxy; `BETTER_AUTH_URL` must be the external `https://`
origin.

## IP allowlisting

Per-workspace CIDR allowlists (IPv4), enforced only when the operator opts in:

```sh
IP_ALLOWLIST_ENFORCEMENT=1
TRUSTED_CLIENT_IP_HEADER=x-forwarded-for   # or x-real-ip
```

The reverse proxy **must overwrite** the selected header with the true client
address — never forward a client-supplied value. A workspace with no CIDRs
stays open.

## Retention, legal hold, eDiscovery

- **Retention policies** (per workspace, per object type) drive scheduled
  purges of aged soft-deleted rows.
- **Legal holds** exempt matching tasks, comments, documents, and attachments
  from purge.
- **eDiscovery** is an admin-only, audited search-and-export across the
  workspace — including held content — producing a JSON/CSV bundle.

## First-party integrations

All OAuth redirect URLs register against the public `BETTER_AUTH_URL`. Tokens
are encrypted server-side; never put them in client config.

| Integration | Key variables | Endpoints |
|---|---|---|
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | `/api/integrations/slack/{callback,commands,events}` — slash command `/task create <title>`; unsigned or stale (>5 min) requests are rejected. |
| Teams | `TEAMS_BOT_APP_ID` | Bot messaging at `/api/integrations/teams/messages`; Bot Framework tokens fully verified; incoming webhooks configured per channel in the admin console. |
| Email | `SMTP_URL`, `SMTP_FROM` (out) · `EMAIL_INBOUND_DOMAIN`, `EMAIL_INBOUND_SIGNING_SECRET` (in) | Gateway posts JSON to `/api/integrations/email/inbound` with a 5-minute HMAC-SHA256 signature. |
| Google / Microsoft 365 | Provider OAuth apps | Drive/OneDrive attachment links + calendar sync for task dates; refresh tokens encrypted. |
