---
title: Enterprise deployment
description: Production services, identity, encryption, network policy, retention, integrations, and the controls operators still own.
---

Kanban is self-hosted and supports multiple workspaces within one deployment. Membership, authorization, agent keys, and data access are workspace-scoped; the operator chooses where the application, Postgres, object storage, and realtime service run and therefore where application data resides.

That architecture supports enterprise controls; it does not create organizational certifications by itself.

:::caution[Implementation is not certification]
Running this code does not confer SOC 2, ISO 27001, HIPAA compliance, a business associate agreement, a data-residency commitment, or a listing in a third-party marketplace. Those require organizational controls, contracts, audits, and deployment decisions outside the repository.
:::

## Production topology

A full deployment has four application services:

| Service | State | Production responsibility |
|---|---|---|
| Next.js app | Stateless application requests | Run multiple instances behind an ingress as capacity requires. |
| Postgres | Durable system of record | Backups, point-in-time recovery, encryption, capacity, and migration discipline. |
| S3-compatible object storage | Attachment bytes | Bucket policy, encryption, lifecycle, backup, and availability. |
| Realtime Yjs server | Live co-editing sessions | WebSocket routing, affinity/coordination strategy, capacity, and observability. |

The repository’s Docker Compose stack is useful for a single-host deployment and local validation. A production orchestrator can replace it as long as the service contracts and environment remain equivalent.

## Required production baseline

1. Terminate TLS at a trusted reverse proxy or ingress.
2. Set the public application origin.
3. Use a production Postgres database with tested backups.
4. Set a dedicated encryption key before storing provider credentials.
5. Run authentication and numbered application migrations.
6. Configure object storage when attachments must survive application container replacement.
7. Route WebSocket traffic to the realtime service.
8. Establish logs, health checks, restore tests, and an upgrade rollback procedure.

```sh
BETTER_AUTH_URL=https://kanban.example.com
BETTER_AUTH_TRUSTED_ORIGINS=https://kanban.example.com
BETTER_AUTH_SECRET=<independent-high-entropy-auth-secret>
GITHUB_CLIENT_ID=<github-oauth-app-client-id>
GITHUB_CLIENT_SECRET=<github-oauth-app-client-secret>
ENCRYPTION_KEY=<dedicated-high-entropy-encryption-key>
```

Register `${BETTER_AUTH_URL}/api/auth/callback/github` as the GitHub OAuth application's authorization callback URL. GitHub sign-in is the bootstrap authentication path; SAML/OIDC providers are configured later by an authenticated workspace owner under **Settings** → **Security & compliance**.

`BETTER_AUTH_SECRET` signs authentication and realtime credentials. Store it in a secret manager, keep it distinct from `ENCRYPTION_KEY`, and treat rotation as a coordinated session-invalidating change.

For durable attachment storage, configure the complete S3-compatible contract:

```sh
S3_ENDPOINT=https://objects.example.com
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>
S3_REGION=us-east-1
S3_BUCKET=kanban-attachments
```

`S3_ENDPOINT`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` must all be present to enable the S3 backend. `S3_REGION` defaults to `us-east-1`, and `S3_BUCKET` defaults to `attachments`. Without the required trio, files use `ATTACHMENTS_DIR` on local disk; that path must be a durable mounted volume in a container deployment.

Run:

```sh
npm run db:setup
```

The command applies Better Auth schema requirements and the repository’s numbered SQL migrations. Run it as a controlled deployment step rather than allowing every web replica to race migrations at startup.

## Identity: SSO and SCIM

Workspace owners configure SAML or OIDC identity providers through the administrative application surface. SCIM bearer tokens are issued per provider, stored hashed, and shown only when created.

Application-supported behavior includes:

- SCIM base URL `/api/auth/scim/v2`;
- user provisioning into workspace membership;
- deactivation that revokes workspace membership and sessions;
- reactivation that restores the member role;
- provider removal that invalidates its SCIM token;
- SAML response timestamp and request-correlation checks;
- rejection of deprecated SAML algorithms.

The deployment operator still owns:

- IdP application registration;
- signing certificates and rotation;
- attribute and group mapping;
- break-glass access;
- lifecycle testing;
- IdP audit and availability.

Test create, update, deactivate, reactivate, and offboarding flows in a non-production workspace before enabling automatic provisioning.

## Secrets and encryption

```sh
ENCRYPTION_KEY=<dedicated-high-entropy-value>
```

The application uses AES-256-GCM for stored Git provider tokens, webhook signing secrets, OAuth refresh tokens, and identity-provider secrets. The key must not be stored in the same database as the ciphertext.

Operational requirements:

- inject the key from a secret manager;
- restrict read access to the application runtime;
- back it up separately under recovery controls;
- never print it in build logs or support bundles;
- plan re-encryption before rotation;
- confirm a restore can decrypt existing provider credentials.

Changing `ENCRYPTION_KEY` without migrating existing ciphertext makes stored integrations unreadable.

## TLS and trusted origins

`BETTER_AUTH_URL` must be the external HTTPS origin users actually visit. Configure trusted origins explicitly when more than one origin is necessary.

The reverse proxy should:

- redirect HTTP to HTTPS;
- set forwarded host and protocol deterministically;
- enforce request size and timeout limits appropriate to the app;
- route WebSocket upgrades to realtime;
- overwrite trusted client-IP headers;
- avoid caching authenticated responses.

## IP allowlisting

Per-workspace IPv4 CIDR allowlists become enforceable only when the deployment opts in:

```sh
IP_ALLOWLIST_ENFORCEMENT=1
TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
```

`x-real-ip` is also supported. The proxy must overwrite the selected header with the verified client address. Trusting a header forwarded directly from the public client turns an allowlist into a bypass.

A workspace with no configured CIDRs remains open. Roll out policy with a tested administrator path and a documented recovery procedure to avoid locking out operators.

## Roles, granular grants, and agents

The base role ladder is `owner > admin > member > viewer`, with guest access scoped to shared objects. Granular board, field, and action grants refine that base.

Treat agents as service principals:

- create one identity per agent or automation;
- choose the least-privilege role;
- keep keys in a secret store;
- rotate by minting a replacement and revoking the old identity;
- review agent activity separately from human sessions;
- use workspace approval policy for higher-blast-radius actions.

An agent key is not a substitute for an end-user session and should never be embedded in browser code.

## Audit and activity

Human and agent changes write attributable activity. Integration and automation effects should remain traceable through the same task and workspace history.

The operator still owns log retention, export, alerting, clock synchronization, access review, and preservation outside the database. If audit data is sent to another system, protect its integrity and document the delivery failure path.

## Retention, legal hold, and eDiscovery

Application-supported controls include:

- per-workspace, per-object retention policies;
- scheduled purge of eligible soft-deleted records;
- legal holds that exempt matching tasks, comments, documents, and attachments;
- admin-only, audited eDiscovery search and export, including held content.

A production retention program also needs:

- a documented policy owner;
- validated schedules and object coverage;
- storage lifecycle alignment for attachment bytes;
- backup-expiration rules;
- legal approval for hold release;
- export custody and access controls.

A database row removed by policy may still exist in a backup or object-store version unless those systems use compatible retention rules.

## First-party integration configuration

Provider routes exist in the application, but each integration works only after the operator registers the external application and supplies valid credentials.

All OAuth callbacks must use the public `BETTER_AUTH_URL`.

| Integration | Deployment inputs | Application endpoints and behavior |
|---|---|---|
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | Callback, commands, and events routes; stale or unsigned requests are rejected. |
| Microsoft Teams | `TEAMS_BOT_APP_ID` and provider-side bot registration | Bot messages route with Microsoft token verification; channel webhooks are configured in the admin surface. |
| Outbound email | `SMTP_URL`, `SMTP_FROM` | Notification delivery through the configured SMTP service. |
| Inbound email | `EMAIL_INBOUND_DOMAIN`, `EMAIL_INBOUND_SIGNING_SECRET` | JSON gateway request with bounded HMAC-SHA256 timestamp verification. |
| Google Workspace | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; callback `${BETTER_AUTH_URL}/api/integrations/google/callback`; Drive and Calendar APIs enabled with Drive metadata read and Calendar write access | Drive links and calendar synchronization; refresh tokens encrypted. |
| Microsoft 365 | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optional `MICROSOFT_TENANT_ID` (defaults to `organizations`); callback `${BETTER_AUTH_URL}/api/integrations/microsoft/callback`; delegated `offline_access`, `User.Read`, `Files.Read`, and `Calendars.ReadWrite` | OneDrive links and calendar synchronization; refresh tokens encrypted. |
| GitHub, GitLab, Bitbucket | Provider application credentials and webhook secrets | Repository, branch, commit, pull request, CI, and release context. |

For every provider, test install, callback, token refresh, event verification, delivery retry, revocation, and uninstall. A route that compiled is not proof that the provider configuration works.

## Webhooks

Inbound provider webhooks must verify the provider signature before parsing the event as trusted. Outbound workspace webhooks are HMAC-signed.

Production controls should include:

- replay windows;
- secret rotation;
- bounded retry with delivery history;
- dead-letter or operator-visible failure state;
- request-size limits;
- endpoint allowlisting where appropriate;
- no credentials in payload logs.

## Backups and recovery

Back up Postgres, attachment storage, and the encryption key as separate recovery assets. Recovery is complete only when a restored application can:

1. authenticate a user;
2. read board and task state;
3. decrypt an existing integration secret;
4. retrieve an existing attachment;
5. reconnect realtime clients;
6. process a verified provider event.

Define recovery point and recovery time objectives from business requirements, then test them. The repository does not choose those commitments for the operator.

## Upgrade procedure

A conservative upgrade sequence:

1. Read migration and deployment changes.
2. Snapshot or back up Postgres and confirm object-store recovery.
3. Deploy to a staging environment with production-equivalent integrations.
4. Run `npm run db:setup` once.
5. Start the application and adjacent services.
6. Exercise sign-in, one board read/write, an agent `whoami`, an attachment, and realtime collaboration.
7. Verify provider callbacks and webhook signatures.
8. Promote, observe, and retain a tested rollback path.

Schema rollback may require restoring data rather than running application code backward. Do not assume every forward migration is mechanically reversible.

## Go-live checklist

- [ ] Public HTTPS origin and trusted origins are exact.
- [ ] Migrations run as one controlled step.
- [ ] Postgres backup and restore are tested.
- [ ] `ENCRYPTION_KEY` is external to the database and recoverable.
- [ ] Object storage persists across application replacement.
- [ ] Realtime WebSocket routing is verified.
- [ ] SSO and SCIM lifecycle paths are tested if enabled.
- [ ] Client-IP headers are overwritten before allowlisting is enabled.
- [ ] Agent identities use least privilege and separate keys.
- [ ] Retention, holds, backups, and object lifecycles agree.
- [ ] Each enabled external provider passes callback, event, refresh, and revoke tests.
- [ ] No compliance or residency claim exceeds the operator’s evidence.

## Continue reading

- [Security and administration](../guide/security-admin/) for in-product controls.
- [Architecture](../architecture/) for service and data boundaries.
- [Integrations](../guide/integrations/) for user-facing provider workflows.
- [Connect an agent](../agents/connect/) for service-principal configuration.
