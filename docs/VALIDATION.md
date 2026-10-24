# Validation and evidence boundaries

## Automated local coverage

Run `npm run check` and `npm test`. Tests use isolated in-memory databases, generated passwords/keys, real local HTTP requests, and mocked Webex responses. Browser smoke tests use temporary storage and three independent browser contexts. They never access a real Webex organization.

Local delivery run on October 24, 2026: JavaScript syntax checks, 16 automated tests, and the Chromium desktop/mobile smoke walkthrough passed. Fixture-only screenshots were visually inspected. No Webex app registrations, real token flows, or App Hub publication were performed.

Covered behaviors include:

- Approval alone does not retrieve tokens or claim a tenant.
- Member-only identity, missing approval, missing confirmation, and conflicting tenant claims are denied.
- Provider/customer role restrictions, CSRF, anonymous access, Host validation, secure headers, and logout.
- Paginated directory reads, fresh customer sign-in without a retained Webex user token, disconnect, reauthorization recovery, and protection against an old failed request erasing a newer connection's credentials.
- Session-bound, single-use OAuth state; tenant-bound credential encryption; provider-vs-Service App credential contexts.
- Signed lifecycle events, correct customer organization field, current-access rechecks for delayed events, and no activation on authorization notifications.
- API errors do not expose raw upstream bodies, tokens, or client secrets.

## Not yet established by local tests

| Live acceptance item | Status |
| --- | --- |
| Registered provider OAuth flow and Service App ownership restrictions | Not run |
| Customer `/people/me` role data plus `/roles` under the selected scopes | Not run |
| Own-org Control Hub authorization and organization-scoped token retrieval | Not run |
| Real directory pagination and returned organization identity fields | Not run |
| Real Service App and provider refresh-token expiry/rotation | Not run |
| Live webhook registration, payload, delivery, signature, and revocation timing | Not run |
| App Hub review/listing and two external customer organizations | Not run |

For each live run, record the date, app registration identities, non-secret organization/test identity references, user path exercised, result, and sanitized tracking IDs where useful. Never record token values, client secrets, authorization codes, cookie values, customer directory exports, or encryption keys.

This distinction is deliberate: a passing fixture or contract test proves the implementation against that contract; it is not evidence that a real Webex organization accepted the flow.
