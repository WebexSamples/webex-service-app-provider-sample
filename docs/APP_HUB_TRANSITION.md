# After App Hub submission

Service App Studio currently validates local developer maintenance: configure one app, inspect approved organizations, and get their tokens. It no longer implements customer onboarding, directory reads, or Data Sources.

Before publication, exercise the real Service App inside its developer organization. App Hub approval and an external customer's Control Hub approval remain separate prerequisites; a successful own-org test proves neither.

## Replace experimental PAT listing

The Developer Portal reads `GET /v1/applications/{applicationId}` and displays `authorizationsList`. This is currently absent from the public Service Apps specification. Its accepted application-read scopes are also absent from the Integration editor. API documentation, scope catalog enablement, and a supported external contract must be resolved before replacing this sample's temporary PAT with production OAuth.

That work is tracked separately from the sample implementation. Confirm the response schema, app-owner/reviewer permissions, empty-list semantics, pagination/completeness, rate limits, and revocation timing with the API owner. Do not assume a documentation PR alone enables a scope.

## Production acceptance

1. Verify supported scoped developer OAuth can list approvals and retrieve Service App tokens.
2. Verify an external customer can discover and approve the submitted app, then appears in the provider's approval list.
3. Retrieve and refresh a token for that exact organization. Confirm unrelated and revoked organizations are rejected.
4. Exercise expiration, credential rotation, retries, concurrent requests, large authorization lists, and refresh-token rotation.
5. For a hosted provider, add authenticated tenant ownership and explicit organization linking, isolated encrypted storage, managed keys, retention rules, and deployment controls. A PAT owner check in a local console does not establish customer account ownership.

The current console intentionally accepts only loopback HTTP. Do not host it unchanged. Existing old Integration registrations and remote approvals are not removed automatically.
