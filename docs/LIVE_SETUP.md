# Live setup

Live mode is intended for a controlled developer/sandbox organization. It does not simulate consent, identities, tokens, or directory responses. Do not reuse the documentation repository's Contentstack credentials or other project secrets.

## 1. Register the Service App

In [My Webex Apps](https://developer.webex.com/my-apps), create a Service App under the provider developer's Webex account. Select:

- `spark-admin:people_read` — read the organization directory.
- `spark-admin:organizations_read` — verify and display organization details.

For the optional [Data Source example](DATA_SOURCES.md), also select `spark-admin:datasource_read` and `spark-admin:datasource_write`, plus a data exchange schema and your receiver's domain. Existing installations need a Full Administrator to reauthorize these changes; the separate provider/customer Integrations do not need additional scopes.

Enter its application ID, client ID, and client secret in the provider’s **Webex registrations** screen. The application ID and OAuth client ID are different identifiers; do not substitute one for the other.

For the own-org test, request admin authorization to make the app visible, then have a Full Admin authorize it under **Control Hub → Management → Apps → Service Apps**. Follow the [Service App guide](https://developer.webex.com/admin/docs/service-apps). External-customer availability is a separate [App Hub transition](APP_HUB_TRANSITION.md).

## 2. Register the provider token-management Integration

Create a regular OAuth Integration using the Webex developer account that owns the Service App. Select:

- `spark:people_read`
- `spark:applications_token`

Use the exact provider redirect URI shown in the setup screen (`http://localhost:3000/oauth/provider/callback` for the default local run). Enter the Integration client ID and client secret in that screen.

The first successful provider OAuth connection pins the verified Webex developer identity in encrypted configuration. Later connections must use that same person. Use the developer who owns the Service App: the identity pin does not prove ownership by itself, and the application-token endpoint also enforces Webex's authorization rules. Migrated installations retain their existing identity pin. Replacing Service App or provider Integration credentials clears the pin and saved provider tokens; all customer organizations must first be disconnected.

The provider administrator signs into the sample locally and selects **Connect provider Integration**. Authorize with the owning developer account. The server exchanges the OAuth code, checks `/people/me`, and encrypts the returned provider token pair. It refreshes the pair on demand when retrieving Service App credentials.

## 3. Register a separate customer identity Integration

Create a regular OAuth Integration for customer verification. Select:

- `spark:people_read` — read the authenticated person's details.
- `spark-admin:people_read` — include the authenticated administrator's assigned roles in their profile.
- `spark-admin:roles_read` — resolve the administrative role IDs returned on that person's profile.

Use the exact customer redirect URI shown in the setup screen (`http://localhost:3000/oauth/customer/callback` by default). Enter this separate Integration’s client ID and secret in that screen.

The callback reads `/people/me`, requires a human account, derives its `orgId`, and checks the person's role IDs against the **Full Administrator** role returned by `/roles`. Merely being able to enumerate roles is not accepted as proof. Missing role data or insufficient permission fails closed. In the October 26, 2026 sandbox run, `spark:people_read` plus `spark-admin:roles_read` returned the role catalog but omitted the person's assigned roles. Adding `spark-admin:people_read` returned those assignments and allowed verification. Include the admin people-read scope in both the registration and OAuth request; existing installations must authorize the added permission. Do not relax the check to organization membership if role data is absent.

This is an OAuth API-authorization flow, not an OpenID Connect ID-token flow. It verifies a Webex identity for a user who is **already authenticated to the provider account**. No email-domain matching or account merging occurs.

## 4. Configure and start live mode

Run `npm ci --ignore-scripts` once, then `npm start`. No environment configuration is required. On a fresh installation, open the private first-run setup link printed in the terminal, create the provider account, and choose which Webex registrations you already have. Save complete registration details as you obtain them; blank secret fields retain saved values. The provider UI can also create separate local sample customer accounts.

If a legacy `.env` sets `MODE=demo`, use `npm start -- --live` to select live mode without editing environment settings. Without a legacy mode setting, `npm start` defaults to live; `npm start -- --demo` selects the separate demo database. Existing local accounts remain usable. Legacy credentials are imported encrypted and the original encryption key is preserved in `.data/master.key`.

The default origin is `http://localhost:3000`. For an HTTPS tunnel/public origin you control, use `npm start -- --origin https://sample.example.com`. Preserve that Host header at the proxy and register both Integrations' exact callback URLs. `--port 3001` changes the local listener. HTTPS origins use Secure cookies; loopback HTTP is the sole development exception. No arbitrary API base URL or disabled TLS verification is supported.

Use separate browser contexts for provider and customer accounts. For this pre-App Hub test, the Webex developer and customer administrator must belong to the developer organization; they may be different Webex people within it.

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

With a publicly reachable HTTPS origin, register two webhooks through the [Create a Webhook API](https://developer.webex.com/messaging/docs/api/v1/webhooks/create-a-webhook). Use an eligible token belonging to the developer who owns the Service App: a separate developer-owned Integration token with `spark:applications_webhook_write`, or an eligible Developer Portal personal access token for this controlled test. The sample's provider OAuth flow requests only identity and application-token scopes and never exposes its tokens for copying. This app accepts callbacks but does **not** create subscriptions automatically. Register each subscription with:

```json
{
  "name": "Provider sample Service App lifecycle",
  "targetUrl": "https://sample.example.com/api/webhooks/service-app",
  "resource": "serviceApp",
  "event": "deauthorized",
  "filter": "id=<SERVICE_APP_ID>",
  "secret": "<your webhook signing secret>"
}
```

Choose a strong random signing secret, enter it in the provider setup screen’s optional webhook field, and use the same value when registering the subscriptions. Replace the placeholders privately, and repeat with `event: authorized`. The sample never returns the saved secret to the UI. The callback verifies `X-Spark-Signature` over the raw body, the resource/event, exact `data.id`, and `data.authorizerOrgId`. It does not use the envelope's `orgId` to identify the customer, or treat its `id`/`created` metadata as a unique, ordered event log. See [duplicate notification guidance](https://developer.webex.com/messaging/docs/webhooks#handle-duplicate-notifications) and [signature verification](https://developer.webex.com/blog/using-a-webhook-secret).

An `authorized` event never links accounts, retrieves tokens, or reactivates service. A valid `deauthorized` event triggers an organization-details request using only the already-stored Service App access token. If Webex denies that request, the callback deletes local credentials and advances the connection revision. If access remains valid, the notification does not discard a potentially newer connection. Repeated notifications while disconnected have no effect. Transient upstream failures return a non-2xx response; they do not establish revocation. An expired access token can also trigger conservative disconnection during this check. The original tenant claim remains reserved until its customer explicitly disconnects.

Without subscriptions, deauthorization is detected only on the next failed Service App API call. HTTP 401/403 from a customer directory/refresh call removes saved credentials and disables that connection. Other upstream failures retain the connection and can be retried. The UI is request-driven, not a push notification channel.

In the [live sandbox run](VALIDATION.md), an existing access token still read the directory immediately after Control Hub deauthorization, while a fresh application-token request was denied. Neither the next-read check nor the webhook's current-access recheck guarantees immediate revocation if Webex still accepts an existing token. Local disconnect removes saved credentials and the account link immediately. After reauthorization, the customer must verify and explicitly confirm a new link.

## Troubleshooting

- **OAuth state error:** use the same browser context that began verification; do not replay the callback. Restart verification after sign-out, server restart, or expiry.
- **Full Administrator required:** verify the Webex account and Integration scopes. This sample intentionally does not accept a normal member or partner administrator as a substitute for a customer's own Full Admin.
- **HTTP 401/403 from Webex:** check provider ownership, live token scopes, client credentials, and Control Hub authorization. Failures are sanitized; secrets and raw Webex response bodies are not logged.
- **Organization already linked:** disconnect it from the original provider tenant before moving it. Do not edit SQLite to bypass the claim.
- **Unexpected host:** open the exact configured origin, or configure the HTTPS proxy to preserve that Host header.
- **Wrong encryption key:** restore the original `.data/master.key` from its backup, or use a fresh data directory and reconnect. Do not try to decrypt records under another key.

API contracts were checked against the [Webex Admin OpenAPI specification](https://github.com/webex/webex-openapi-specs/blob/main/public-spec/webex-admin.json). Only your live validation can establish that your registered apps, scopes, organization policy, and identities support the complete flow.
