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

## Live sandbox run — October 26, 2026

The run used a controlled developer organization and three dedicated registrations: **Service App Studio Sandbox Directory**, **Service App Studio Provider Sandbox**, and **Service App Studio Customer Sandbox**. The same Webex Full Administrator served as the app creator and customer verifier for this pre-App Hub test. Provider, Summit, and Northstar were separate local sample accounts, exercised sequentially in one browser profile. No external customer organization was involved.

The customer Integration initially requested only `spark:people_read` and `spark-admin:roles_read`. Both identity and role-catalog requests succeeded, but the identity response omitted assigned roles, so verification correctly failed closed. Adding `spark-admin:people_read` to the registration and OAuth request returned the assigned Full Administrator role and allowed verification. The regression test covers both missing roles and a member role even when the Full Administrator role appears in the catalog.

After verification and before confirmation, the database contained no organization claim or Service App credentials. Explicit confirmation retrieved the organization-specific access/refresh pair and verified the returned organization. Directory access loaded 10 members, including after a fresh local customer login without repeating Webex OAuth. A second local customer account verified the same administrator but could not claim the already-linked organization; it received `claim_conflict` and saved no credentials. Persisted settings contained only the application mode and encrypted provider tokens; customer OAuth tokens were not persisted.

Both real refresh-token grants passed. Local `obtained_at` metadata was moved into the past to trigger the Service App refresh during a directory read and provider Integration refresh during a later activation attempt. This exercises real Webex refresh calls without waiting for natural token expiry. A direct run of the production directory adapter with a Webex page size of three followed returned next links across pages of 3, 3, 3, and 1 members. The normal browser directory request retained its default page size of 50.

### Revocation and recovery boundary

Control Hub deauthorization did **not** immediately prevent an already-issued Service App access token from reading the directory in this run. The subsequent explicit local disconnect removed stored credentials and released the claim. A fresh activation attempt while deauthorized returned Webex HTTP 401 and saved no credentials or claim. Control Hub reauthorization alone did not reconnect the sample. Fresh customer verification and confirmation restored directory access.

This proves denial of new token issuance while deauthorized, not immediate invalidation of all existing access tokens. No lifecycle webhook subscriptions were installed, and revocation propagation time was not measured. The optional webhook handler also rechecks current token access; if Webex still accepts that token, the handler retains the connection. Do not promise immediate provider-side revocation from that mechanism. Local disconnect immediately removes this sample's credentials and link.

## Live acceptance status

| Live acceptance item | Status |
| --- | --- |
| Registered provider OAuth with the configured owning developer identity | Passed in the sandbox |
| Rejection of a different developer or external organization by Webex ownership restrictions | Not run live |
| Customer `/people/me` role data plus `/roles` under the corrected three scopes | Passed; missing admin people-read scope failed closed first |
| Own-org Control Hub authorization and organization-scoped token retrieval | Passed; deauthorized issuance returned HTTP 401 |
| Real directory reads, pagination, and returned organization identity fields | Passed; browser read and four-page adapter run |
| Real Service App and provider refresh-token grants | Passed with forced local expiry metadata |
| Natural token expiry and refresh-token rotation over their full lifetimes | Not run |
| Customer re-login, duplicate tenant claim, local disconnect, and reauthorization recovery | Passed in the sandbox |
| Live webhook registration, payload, delivery, signature, and revocation timing | Not run |
| App Hub review/listing and two external customer organizations | Not run |

For each live run, record the date, app registration identities, non-secret organization/test identity references, user path exercised, result, and sanitized tracking IDs where useful. Never record token values, client secrets, authorization codes, cookie values, customer directory exports, or encryption keys.

Fixture and contract results remain separate from live evidence. The sandbox run establishes the paths above only for the tested developer organization and registrations.
