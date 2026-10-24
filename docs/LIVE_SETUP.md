# Live setup

Live mode is intended for a controlled developer/sandbox organization. It does not simulate consent, identities, tokens, or directory responses. Do not reuse the documentation repository's Contentstack credentials or other project secrets.

## 1. Register the Service App

In [My Webex Apps](https://developer.webex.com/my-apps), create a Service App under the provider developer's Webex account. Select:

- `spark-admin:people_read` — read the organization directory.
- `spark-admin:organizations_read` — verify and display organization details.

Record its application ID, client ID, and client secret in `.env` as `SERVICE_APP_ID`, `SERVICE_APP_CLIENT_ID`, and `SERVICE_APP_CLIENT_SECRET`. The application ID and OAuth client ID are different identifiers; do not substitute one for the other.

For the own-org test, request admin authorization to make the app visible, then have a Full Admin authorize it under **Control Hub → Management → Apps → Service Apps**. Follow the [Service App guide](https://developer.webex.com/admin/docs/service-apps). External-customer availability is a separate [App Hub transition](APP_HUB_TRANSITION.md).

## 2. Register the provider token-management Integration

Create a regular OAuth Integration using the Webex developer account that owns the Service App. Select:

- `spark:people_read`
- `spark:applications_token`

Set the callback to `<BASE_URL>/oauth/provider/callback`, with the exact origin you will use. Set `PROVIDER_INTEGRATION_CLIENT_ID` and `PROVIDER_INTEGRATION_CLIENT_SECRET` in `.env`.

Set `PROVIDER_WEBEX_PERSON_ID` to the owning developer account's **encoded person ID**, available from `GET /v1/people/me` using that developer's token in the Developer Portal API reference. This is an operator-configured identity pin, not an inferred app-ownership lookup. The provider callback refuses a different Webex person. An identity pin does not prove ownership by itself; the application-token endpoint also enforces Webex's authorization rules.

The provider administrator signs into the sample locally and selects **Connect provider Integration**. Authorize with the owning developer account. The server exchanges the OAuth code, checks `/people/me`, and encrypts the returned provider token pair. It refreshes the pair on demand when retrieving Service App credentials.

## 3. Register a separate customer identity Integration

Create a regular OAuth Integration for customer verification. Select:

- `spark:people_read` — read the authenticated person's details.
- `spark-admin:roles_read` — resolve the administrative role IDs returned on that person's profile.

Set the callback to `<BASE_URL>/oauth/customer/callback`. Set `CUSTOMER_INTEGRATION_CLIENT_ID` and `CUSTOMER_INTEGRATION_CLIENT_SECRET` in `.env`.

The callback reads `/people/me`, requires a human account, derives its `orgId`, and checks the person's role IDs against the **Full Administrator** role returned by `/roles`. Merely being able to enumerate roles is not accepted as proof. Missing role data or insufficient permission fails closed. Role availability with this scope combination is an explicit live acceptance item, not assumed from the mocked tests. Do not relax the check to organization membership if it fails.

This is an OAuth API-authorization flow, not an OpenID Connect ID-token flow. It verifies a Webex identity for a user who is **already authenticated to the provider account**. No email-domain matching or account merging occurs.

## 4. Configure and start live mode

Stop the running demo. Run `npm run setup` again and choose `live` to create separate live-mode local accounts and a separate database. Setup preserves existing `.env` Webex configuration and encryption keys; it refuses to overwrite existing accounts in the selected mode.

Fill in the Webex variables in the ignored `.env`. Use `BASE_URL=http://localhost:3000` for a loopback flow only if Webex accepts that registered callback. Otherwise use an HTTPS tunnel/public origin you control, for example `https://sample.example.com`. Preserve its Host header at the proxy and set both Integrations' exact callback URLs. `PORT` remains the local listener port, default `3000`. HTTPS origins use Secure cookies; loopback HTTP is the sole development exception. No arbitrary API base URL or disabled TLS verification is supported.

Run `npm start`. Use separate browser contexts for the local provider and customer accounts. For the pre-App Hub test, the Webex developer and customer administrator must belong to the developer organization; they may be different Webex people within it.

After provider OAuth and Control Hub approval:

1. Customer signs into its provider tenant and selects **Verify with Webex**.
2. Backend verifies the Webex person and administrative authority, retaining only a five-minute identity proof. The customer's OAuth access/refresh tokens are discarded; they are not persisted or used for directory reads.
3. Customer explicitly confirms the verified organization and provider account.
4. Backend checks for conflicting tenant claims, then calls `POST /v1/applications/{applicationId}/token` with the **provider Integration bearer token**, Service App client credentials, and the verified raw `orgId` as `targetOrgId`.
5. Backend verifies returned organization details using the Service App token, encrypts the pair under this tenant's identity, and activates the connection.
6. Directory requests use only the stored Service App token; the refresh token is used with the **Service App** client credentials when necessary.

The documented application-token operation requires an already-authorized Service App. There is no speculative or undocumented authorization-list API in this sample. A denied token request leaves the connection inactive. Token retrieval may succeed before a later organization-details failure; in that case the new pair is discarded locally and no connection is activated.

Directory pagination follows Webex-provided next links only after checking the API origin, `/v1/people` path, and matching organization. Missing or mismatched organization IDs in the response are rejected. The interface reports **members loaded**, not a guessed organization-wide total.

## 5. Optional signed lifecycle webhooks

With a publicly reachable HTTPS `BASE_URL`, register two webhooks through the [Create a Webhook API](https://developer.webex.com/messaging/docs/api/v1/webhooks/create-a-webhook). Use an eligible token belonging to the developer who owns the Service App: a separate developer-owned Integration token with `spark:applications_webhook_write`, or an eligible Developer Portal personal access token for this controlled test. The sample's provider OAuth flow requests only identity and application-token scopes and never exposes its tokens for copying. This app accepts callbacks but does **not** create subscriptions automatically. Register each subscription with:

```json
{
  "name": "Provider sample Service App lifecycle",
  "targetUrl": "https://sample.example.com/api/webhooks/service-app",
  "resource": "serviceApp",
  "event": "deauthorized",
  "filter": "id=<SERVICE_APP_ID>",
  "secret": "<WEBHOOK_SECRET from the local secret configuration>"
}
```

Replace the placeholders privately, and repeat with `event: authorized`. Setup generates `WEBHOOK_SECRET` without printing it. The callback verifies `X-Spark-Signature` over the raw body, the resource/event, exact `data.id`, and `data.authorizerOrgId`. It does not use the envelope's `orgId` to identify the customer, or treat its `id`/`created` metadata as a unique, ordered event log. See [duplicate notification guidance](https://developer.webex.com/messaging/docs/webhooks#handle-duplicate-notifications) and [signature verification](https://developer.webex.com/blog/using-a-webhook-secret).

An `authorized` event never links accounts, retrieves tokens, or reactivates service. A valid `deauthorized` event triggers an organization-details request using only the already-stored Service App access token. If Webex denies that request, the callback deletes local credentials and advances the connection revision. If access remains valid, the notification does not discard a potentially newer connection. Repeated notifications while disconnected have no effect. Transient upstream failures return a non-2xx response; they do not establish revocation. An expired access token can also trigger conservative disconnection during this check. The original tenant claim remains reserved until its customer explicitly disconnects.

Without subscriptions, deauthorization is detected only on the next failed Service App API call. HTTP 401/403 from a customer directory/refresh call removes saved credentials and disables that connection. Other upstream failures retain the connection and can be retried. The UI is request-driven, not a push notification channel.

## Troubleshooting

- **OAuth state error:** use the same browser context that began verification; do not replay the callback. Restart verification after sign-out, server restart, or expiry.
- **Full Administrator required:** verify the Webex account and Integration scopes. This sample intentionally does not accept a normal member or partner administrator as a substitute for a customer's own Full Admin.
- **HTTP 401/403 from Webex:** check provider ownership, live token scopes, client credentials, and Control Hub authorization. Failures are sanitized; secrets and raw Webex response bodies are not logged.
- **Organization already linked:** disconnect it from the original provider tenant before moving it. Do not edit SQLite to bypass the claim.
- **Unexpected host:** open exactly `BASE_URL`, or configure the HTTPS proxy to preserve that Host header.
- **Wrong encryption key:** restore the original key or start with a new database and reconnect. Do not try to decrypt records under another key.

API contracts were checked against the [Webex Admin OpenAPI specification](https://github.com/webex/webex-openapi-specs/blob/main/public-spec/webex-admin.json). Only your live validation can establish that your registered apps, scopes, organization policy, and identities support the complete flow.
