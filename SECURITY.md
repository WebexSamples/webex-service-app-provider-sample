# Security boundaries

This sample is a local developer console. It has no application login. Anyone with access to its loopback workspace can use saved Service App credentials and connect their own PAT. Do not expose it through a reverse proxy, tunnel, shared host, or public listener. The server accepts only the configured HTTP loopback origin, matching Host header, and loopback socket peers. Mutation requests require a session cookie, same-origin header, JSON, and CSRF token.

## Credential handling

- Service App client secrets and token pairs use AES-256-GCM in SQLite. The local `master.key` is a separate private file. Directory permissions are `0700`; key/database permissions are `0600`. This protects against casual file disclosure, not a compromised local account holding both files.
- Token ciphertext is bound to Service App ID, client ID, and canonical organization ID. Changing registrations cannot reveal a different registration's saved pair.
- PATs stay in server-session memory and never enter persisted settings, audit details, browser storage, or environment configuration. Sessions expire after 30 minutes idle or eight hours absolute and do not survive restart. Explicit disconnect or a configuration save clears PAT access.
- Token pairs are returned only by an explicit POST action. Status responses expose metadata only. The UI clears revealed tokens on navigation, errors, PAT disconnect, and a periodic five-minute timer. Copies stay on the user's clipboard until replaced.
- No request bodies, raw upstream responses, tokens, or secrets are logged. HTTP responses use `no-store`, a same-origin Content Security Policy, frame denial, and no-referrer.

## Authorization and consistency

The experimental application-read path verifies a human PAT owner against the app's `createdBy` before accepting its authorization list. Wrong app/type, malformed identities, duplicate organizations, unexpected pagination, and count mismatches fail closed. An owner-verified empty list means no approvals were returned. Completeness at large scale remains unverified because this is not a published API contract.

Every retrieve, refresh, or reveal action re-reads current approval for the chosen organization. The documented token endpoint independently enforces current authorization. A revocation between the approval read and token call can still cause token issuance or later use to fail; approval snapshots are not grants. Previously issued tokens are not remotely revoked or deleted by this console.

Per-organization locks prevent overlapping token mutations. Settings cannot change during a token action. Session/configuration checks reject delayed results after disconnect or setup changes. Failed retrievals or refreshes preserve the prior encrypted pair.

## Boundaries

PATs have broad developer permissions and are for temporary local testing. Public API publication and OAuth scope enablement are being pursued separately. A production provider must use supported scoped OAuth access and add authenticated tenant isolation, credential lifecycle management, audit retention/redaction, and its own deployment controls.

Older settings and customer tables are preserved but inactive. This version does not use old Integration credentials, customer OAuth, directory reads, Data Sources, or webhooks. No automatic remote grant cleanup occurs.

Report security issues privately to the repository maintainers. Do not include real credentials, database files, organization snapshots, or customer data in issues or PRs.
