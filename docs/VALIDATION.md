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

### Momentum UI refresh — October 31, 2026

On Node.js 24.19.0, a clean `npm ci --ignore-scripts`, JavaScript syntax checks, all 17 automated tests, and the Chromium browser smoke passed. The dependency audit reported zero vulnerabilities. The UI uses locked Momentum components, light-theme tokens, and a locally served font; asset tests confirm only the explicit asset routes are served and the same-origin Content Security Policy is retained.

Browser coverage includes component hydration, font loading, no external asset requests, native login validation and Enter submission, and Momentum button activation with Enter and Space. Login, provider, customer confirmation, and connected-directory views fit at 320px and 390px. Desktop/mobile fixture screenshots were inspected and the README screenshots refreshed. The full fixture walkthrough still covers member denial, explicit linking, pagination, conflicting claims, and deauthorization. No new live Webex authorization or API test was performed for this styling change.

### Provider first-run setup — October 31, 2026

JavaScript syntax checks and 23 automated tests passed. New coverage checks the private one-use bootstrap code, session rotation, provider-only credential and customer-account endpoints, encrypted/write-only registration storage, partial setup with a Service App/Integration/both/neither, incomplete-registration rejection, developer identity pinning, stale and in-flight OAuth rejection after settings changes, and credential replacement restrictions while a customer is connected. Local key tests cover persistence, file permissions, legacy-key preservation, missing/conflicting keys, and symbolic links.

The Chromium smoke launched the real server with only `PATH` in its environment, a fresh temporary data directory, and no `.env` loading. It created the provider account through the private setup link, exercised all four registration choices, saved generated test credentials, and created a customer sign-in. The test verified that the secret was absent from plaintext SQLite bytes and that `master.key` was `0600`. After stopping and restarting the server, the same provider signed in, the saved registration ID was restored, and the secret field remained empty with a saved-value placeholder. Provider setup fit at 320px and 390px, and its screenshots were visually inspected. The existing fixture walkthrough also passed.

For the existing local sandbox installation, migration read-back verified that the generated private key file retained the original encryption key, imported registration fields matched the legacy configuration, and existing encrypted provider/Service App token records remained readable. No credential values or customer data were captured. This was a local storage migration check, not a new live Webex API or authorization test.

## Data Source example — October 31, 2026

JavaScript syntax checks and 30 Node tests passed. Added contracts cover the fixed-origin Data Source POST/GET/PUT/DELETE paths, Service App bearer context, complete renewal payload, 204 deletion, already-removed 404 handling, and sanitized Data Source scope denials. Registration writes are not retried automatically after an ambiguous response. Setup validation rejects incomplete schema/URL pairs and endpoint credentials, query strings, fragments, local/IP destinations, and non-default ports.

HTTP tests exercise explicit register/remove confirmation, provider-role denial, rejection of browser-supplied IDs/organizations/endpoints, tenant-specific endpoint derivation, encrypted metadata and nonce storage, token redaction/discard, distinct registrations for two tenants, persistent re-login, fresh renewal nonces, and continued directory access after removal. Disconnect retains the record; another connected organization cannot manage it. In-flight writes block a concurrent disconnect or second mutation. Missing optional-feature scope leaves the directory connection's credentials intact.

The isolated Chromium walkthrough passed the complete Data Source register/read/renew/remove flow. It checked persistence after reload, disabled actions after local disconnect, management after reconnecting, optional provider settings restored after server restart, and layouts at 320px and 390px. Desktop and mobile fixture screenshots were visually reviewed. No dependency was added.

No live Data Source API request, scope grant, schema/domain change, endpoint deployment, inbound JWS verification, natural delivery-token expiry, or actual Webex data delivery was performed for this addition. Existing live sandbox directory evidence below does not establish live Data Source support. Live validation requires the additional grants and approved receiver configuration described in [Data Source setup](DATA_SOURCES.md).

## Live provider setup and admin approval — October 31, 2026

Using a Chrome profile already signed into the sandbox administrator account, the run reused the three existing Service App Studio registrations and their previously approved scopes. No additional registrations or webhook subscriptions were needed. The server ran with its environment cleared except for `PATH`, using the generated key file and encrypted registration settings.

Provider sign-in showed all registrations configured. All saved-secret fields were empty with saved-value placeholders; submitting them blank preserved the credentials and existing connection. Provider OAuth completed with the already signed-in Webex developer account. The provider console showed connection metadata and no customer directory.

The customer read the 10-member directory with the migrated machine credentials. Local disconnect removed the stored credentials and organization claim. Customer OAuth through the separate Integration verified the assigned Full Administrator role; before confirmation, database read-back showed no machine credentials or claim. Explicit confirmation retrieved a fresh token pair and directory access returned 10 members. Northstar verified the same administrator but was denied Summit's organization claim and saved no credentials or claim. A server restart without environment configuration required local sign-in again; directory access still returned 10 members without repeating customer OAuth.

The native browser disconnect popup proved awkward to automate in a background tab. It was replaced with an inline disclosure and separate **Confirm disconnect** action. Opening the disclosure retained the connection; the confirmation removed it. The updated control passed the fixture walkthrough and the live sandbox disconnect/reconnect path. JavaScript checks and all 23 automated tests passed.

### Administrator approval cycle

The administrator opened **Apps → Service Apps → Other service apps**, searched by the exact application ID, and selected **Service App Studio Sandbox Directory**. Control Hub listed its existing scopes as `spark-admin:people_read`, `spark-admin:organizations_read`, and `spark:kms`.

After local disconnect, authorization was temporarily removed from this dedicated sample app and saved in Control Hub. A fresh customer verification succeeded, but token retrieval failed with Webex HTTP 401 and no directory was available. The administrator then authorized the same app and saved the change; the persisted Control Hub row showed **Authorized**. Refreshing the sample still showed no directory, and database read-back confirmed that approval alone had created neither credentials nor an organization claim. Fresh customer verification and explicit confirmation then activated the connection and read all 10 members.

The app was left authorized in Control Hub with Summit connected and Northstar unlinked. Private evidence captures the Control Hub approval state and the directory header/member count, excluding customer member rows, credentials, and authorization codes. No external Webex organizations, App Hub publication, live webhook delivery, revocation propagation timing, or natural token expiry were tested in this run.

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
