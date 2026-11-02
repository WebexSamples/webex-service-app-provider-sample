# Live local setup

Start with `npm start` and open http://localhost:3000. Use a sandbox Webex organization and a developer account that owns the Service App. No local login, Integration registration, callback URL, or environment file is required.

## Configure the Service App

1. Open [My Webex Apps](https://developer.webex.com/my-apps). Select an existing Service App, or create one with the scopes needed for your eventual use case.
2. Under **Service App** in the sample, save the app ID, client ID, and client secret. You may also save its name and Developer Portal Manage URL.
3. As an organization administrator, approve the Service App in Control Hub. This sample does not grant approval or add scopes.

Approval before App Hub publication is limited by Webex's own-org development rules. Test external customers only after the appropriate submission and approval process.

## Connect temporary developer access

1. Sign into the Developer Portal as the Service App creator.
2. Copy the [personal access token](https://developer.webex.com/admin/docs/getting-started#your-personal-access-token).
3. Paste it into **Developer Access** in the local sample and select **Connect PAT**.

The backend reads `/people/me` and the experimental `/applications/{applicationId}` endpoint, verifies creator ownership, and saves a whitelisted authorization snapshot. Successful connection should show the Service App name and its approved organizations. PAT expiry or denial requires replacing the PAT. A wrong owner, wrong app type, or incomplete response is rejected.

The read path is unpublished. The Integration editor currently omits both accepted application-read scopes; `spark:applications_token` alone returns HTTP 403 for the read. The PAT is an experimental local workaround, not production OAuth guidance.

## Retrieve and refresh organization tokens

Open **Organizations**, refresh approvals, and expand **Manage tokens** for an approved organization. Select **Retrieve token pair** to call the documented [Service Apps token endpoint](https://developer.webex.com/docs/api/v1/service-apps/get-service-app-token) using the PAT as the developer bearer and the saved Service App client credentials.

The server supplies `targetOrgId` from the fresh approval response. The resulting pair is encrypted locally. **Refresh token pair** uses the Service App client credentials and saved refresh token through `/v1/access_token`. **Reveal saved pair** reads the saved pair after checking approval again. Ordinary status requests never return either token.

Hide tokens after use and replace copied credentials on your clipboard. Disconnect the PAT when finished. This removes local developer access without revoking Service App grants or deleting saved token pairs.

## Troubleshooting

- **No organizations:** check the last-checked timestamp, app identity, and Control Hub approval.
- **Owner mismatch:** supply the creator's PAT. Administrator membership alone is insufficient for this sample's owner check.
- **HTTP 401/403:** replace an expired PAT, verify the creator account, or review approval. Never add permissions by guessing undocumented scopes.
- **Incomplete response:** compare the authorization list in the Developer Portal. The console rejects pagination or count mismatches rather than silently showing a partial list.
- **Refresh rejected:** approval or refresh credentials may have changed. Retrieve a new pair after checking the Service App in Webex.

Keep `.data/master.key` and the SQLite database private. Existing legacy credentials remain preserved but inactive; this workflow does not use or revoke them.
