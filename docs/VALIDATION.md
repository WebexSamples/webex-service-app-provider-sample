# Validation evidence

## Current automated checks

Validated November 2, 2026, on Node.js 24.19.0:

- JavaScript syntax checks and Node's built-in test suite.
- Local sessions without app login; Host, socket, origin, CSRF, and content-type checks.
- PAT connection/disconnect without persistence or status-response disclosure.
- Creator/app/type checks, canonical organization IDs, duplicate/incomplete-list rejection.
- Approval recheck before retrieve, refresh, and explicit reveal; failed actions preserve saved ciphertext.
- App/client/org encryption contexts, concurrent-action rejection, delayed-result rejection after disconnect, and legacy-data preservation.
- Token endpoint request fields, unrotated refresh-token retention, rotation/expiry handling, and sanitized upstream failures.
- Isolated browser smoke: no-env setup and restart, encrypted secret, separate setup/organization pages, token actions, navigation clearing, reload persistence, simulated revocation, disconnect, Momentum controls, and 320px/390px layout checks.

Run `npm run check`, `npm test`, and optionally `python3 scripts/browser_smoke.py`. Tests use fixtures and mocks; they do not call Webex. Committed screenshots contain fictional demo data only.

## Live research

The Developer Portal source and Hydra source confirm the internal application-read path and authorization-list field. The current public API specification contains the token POST operation but no application GET definition. A live read using the existing Integration bearer with `spark:applications_token spark:people_read` returned HTTP 403. The Integration editor exposed neither accepted application-read scope. No scopes or grants were changed during that investigation.

The current sample uses an explicitly supplied creator PAT for local experimentation. Live PAT listing and token retrieval must be recorded separately from the mocked checks; source inspection alone is not live validation. Private evidence belongs in ignored `artifacts/`, with no token values.

## Remaining acceptance

External-customer App Hub authorization, high-volume list completeness, production scoped OAuth, and production deployment are unverified. See [App Hub transition](APP_HUB_TRANSITION.md). Earlier directory/Data Source evidence applies to the previous sample version and does not establish this console's PAT flow.
