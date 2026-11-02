# Customer Data Source example

This example demonstrates a provider registering a customer-specific endpoint after the customer explicitly links its Webex organization. It manages a BYODS registration through Webex's Data Sources API. It does not implement a BYOVA agent, media receiver, or consuming feature configuration.

## Demo walkthrough

1. Run the sample in demo mode and complete provider/customer setup as described in the [README](../README.md).
2. Approve the Summit fixture, verify its administrator, and confirm its organization link.
3. Under **Customer Data Source**, expand **Register a data source**. Review the fixture endpoint and schema, then select **Confirm register data source**.
4. Select **Refresh data source** to read its last reported registration status.
5. Select **Renew delivery token** to exercise a full update with a fresh nonce. The UI shows an estimated renewal deadline, not the token.
6. Switch experiences and back: the saved registration remains available. A separate customer's registration uses a different endpoint path and local record.
7. Expand **Remove data source** and select **Confirm remove data source**. The registration is removed while the organization link and directory access remain active.

Demo mode uses a published BYOVA schema ID only as a fixture value. It makes no Webex calls and does not establish that a live Service App is approved for that schema.

## Live prerequisites

1. On the existing Service App, add `spark-admin:datasource_read` and `spark-admin:datasource_write`. Select the data exchange schema that matches your receiver and register the receiver's domain. Webex enforces these selections.
2. Have the customer's Full Administrator reauthorize the Service App after changing scopes, schema, or domains.
3. Remove any saved example Data Source, then disconnect linked sample customers before changing provider settings. On a fresh installation, configure the optional fields before linking customers.
4. In **Webex registrations → Optional Data Source example**, enter the schema UUID and an HTTPS endpoint base URL you control. For example, `https://connector.example.com/byods` becomes `https://connector.example.com/byods/customers/summit` for the Summit provider tenant. The receiver must support those customer-specific paths. The base URL cannot contain credentials, a non-default port, query parameters, or a fragment.
5. Save, connect the provider Integration if necessary, then have the customer verify and confirm a fresh organization link. Use the customer controls to register the endpoint.

The provider and customer OAuth Integrations keep their existing scopes. Data Source management uses only the linked organization's Service App access token, refreshed with the Service App client credentials when needed. A registered endpoint may receive data when a compatible Webex feature is configured; use a controlled receiver and sandbox organization.

## API behavior

| Customer action | Webex operation |
| --- | --- |
| Register | `POST /v1/dataSources` |
| Refresh | `GET /v1/dataSources/{dataSourceId}` |
| Renew delivery token | `PUT /v1/dataSources/{dataSourceId}` |
| Remove | `DELETE /v1/dataSources/{dataSourceId}` |

Registration uses this server-generated payload:

```json
{
  "schemaId": "<provider-configured-schema-uuid>",
  "url": "https://connector.example.com/byods/customers/summit",
  "audience": "ServiceAppStudio",
  "subject": "callAudioData",
  "nonce": "<fresh-random-value>",
  "tokenLifetimeMinutes": 60
}
```

Renewal sends the complete saved payload, its current active status, and a new nonce. An externally disabled registration cannot be reactivated by the renewal button; restore it in Webex or remove it first. Missing remote registrations can be cleared through **Confirm remove data source**, which accepts an upstream 404 as already removed.

The saved ID and organization come from server-side state, never the browser request. A customer can manage only its own saved registration while connected to the original organization. Unexpected returned IDs, organization IDs, URLs, or schema IDs are rejected. This sample intentionally manages one saved Data Source per provider customer, rather than displaying all registrations belonging to the Service App.

## Boundaries and recovery

- The status is the last reported registration state. It does not establish receiver health, data delivery, or a working BYOVA conversation.
- Delivery-token lifetime is 60 minutes. **Renew by** is an estimate based on the last successful register/renew response. Renewal is manual; production providers need a durable renewal worker and failure handling before the deadline.
- Management metadata is encrypted in SQLite. Delivery JWS tokens returned by Webex are discarded; the receiver must independently validate the JWS Webex sends with each connection, including its signature, issuer, expiration, audience, subject, URL, schema, and customer organization.
- Local disconnect does not delete the remote Data Source. Remove it first when retiring this example. If disconnected, reconnect the original organization to manage it; a different organization cannot access it. Provider settings stay locked until saved registrations are removed.
- The sample does not automatically retry writes. If registration times out or returns an invalid response, inspect the Service App's registrations in Webex before retrying: the remote operation may have succeeded without a usable response. Unknown remote outcomes require manual reconciliation; the sample does not discover or adopt existing registrations.
- A Data Source HTTP 403 leaves a working directory connection intact and reports the optional feature's access requirements. Check scopes, schema, domain, and Control Hub authorization. HTTP 401 or a failed Service App refresh follows the existing conservative disconnect behavior.

The implementation was checked against the [Webex Admin OpenAPI specification](https://github.com/webex/webex-openapi-specs/blob/main/public-spec/webex-admin.json) and [Bring Your Own Data Source guide](https://developer.webex.com/create/docs/bring-your-own-datasource). See [validation evidence](VALIDATION.md) for the distinction between contract/demo checks and live sandbox tests.
