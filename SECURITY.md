# Security boundaries

This is a single-process, loopback-bound developer sample. Use controlled accounts and organizations. It is not a production multitenant identity service.

Implemented protections:

- Separate local provider/customer roles and server-derived tenant ownership on every protected action. The provider console receives connection metadata, not customer directory contents or credential values.
- Generated opaque sessions, rotation at sign-in, HttpOnly SameSite=Lax cookies, server-side idle/absolute expiry, CSRF tokens, Origin checks, and fixed Host validation. Secure cookies are enabled for HTTPS; localhost HTTP is the sole development exception.
- Fixed Webex API origin, HTTPS certificate validation, bounded request bodies and outbound timeouts, rejected redirects, and checked pagination targets. No caller-controlled API base URL.
- Webex person/organization identity from `/people/me`, checked Full Administrator authority, session-bound one-use OAuth state, five-minute pending identity proofs, and explicit confirmation before token retrieval.
- Unique canonical organization claims, connection revisions, and in-process guards against concurrent linking. A single process is required; do not scale this session/locking model across workers.
- Salted scrypt password hashes and generated AES-256-GCM keys. Credential ciphertext is bound to a tenant via authenticated additional data. Tokens and client secrets are never returned to the UI, logged, or stored in browser storage.
- Customer OAuth tokens discarded after verification; provider and Service App token pairs encrypted separately and refreshed using their own client credentials.
- Signed optional deauthorization callbacks recheck current access rather than inferring event ordering from envelope metadata. Confirmed API access denial disables access and removes credentials.
- Strict Content Security Policy, no inline/third-party scripts, safe text-based DOM rendering, no secret material in static files, and no caching of app/API responses.

Known boundaries:

- `.env` is local secret storage, with mode 0600 on setup; it is not a managed vault. Move secrets into a managed vault, plan key rotation/backups, and restrict operating-system access before hosting real customer data.
- Account creation is operator-controlled bootstrap. Invitations, password reset, MFA, account lifecycle, delegated connection authority, persistent/distributed sessions, and a production reverse-proxy trust model are outside this sample.
- Webex Full Admin verification is intentionally strict and fails closed. It requires live validation of role visibility under the configured customer Integration scopes.
- Directory data is read-only and not stored in SQLite, but authorized customer browsers receive names/emails. Do not capture real customer data in shared screenshots or logs.
- A directory read can fail due to revoked consent, missing scope, or invalid credentials. HTTP 401/403 disables the connection conservatively; an operator must resolve the cause and reconnect.
- Without configured webhook subscriptions, there is no immediate revocation notification. The next Webex request detects denial. The app has no background polling or synchronization.
- Refresh status clears the browser's directory view. The sample does not push revocation to already-open browsers or erase data they previously received.

For vulnerabilities, use the repository's private GitHub security reporting if enabled. Do not post secrets, customer information, or exploit credentials in public issues.
