# After App Hub submission and approval

The local sample does not reproduce App Hub discovery, review, approval, listing, or external-customer authorization. Demo identities and approvals are fixtures. Live own-org testing proves only the exercised organization and API paths.

## Changes needed

1. **Submit the existing Service App.** Complete App Hub review, requested scopes, branding, support/privacy information, and reproducible reviewer instructions. Record the exact Service App identity. Do not assume submission alone makes it available to external customers.
2. **Replace own-org setup instructions.** Direct external customers to the approved Service App listing/Control Hub entry. Remove the developer-org visibility step from the customer journey.
3. **Configure the deployed origins.** Register exact HTTPS callbacks on both Integrations and the webhook target. Move client secrets and the encryption key into managed secret storage; put the app behind a production HTTPS service.
4. **Confirm organization policy.** Standard OAuth Integrations and Service Apps have different authorization/visibility paths. Integration consent remains subject to the customer's Control Hub policy. Do not infer that listing a Service App automatically permits the separate customer Integration.
5. **Repeat live acceptance with independent organizations.** Use the provider organization plus at least two genuinely separate customer Webex organizations and separate customer provider tenants.

The organization-linking algorithm, separate OAuth contexts, Service App token endpoint, encrypted tenant-specific token storage, and directory API should remain the same. If real external-org testing reveals different API behavior, fix and test that behavior explicitly; do not add an App Hub toggle that bypasses verification.

## External-customer acceptance

- Customer A authorizes the exact listed Service App in its Control Hub; no provider tenant is linked automatically.
- A local customer tenant administrator authenticates with Customer A's Webex Full Admin, confirms the link, and receives only Customer A's directory.
- Customer B follows the same path independently and receives only Customer B's directory.
- Customer B cannot claim A's existing organization link, supply A's organization ID manually, replay A's callback, or read A's saved credentials/directory.
- A normal organization member and a user from the provider's Webex organization cannot activate another customer's link merely by knowing its ID.
- Customer OAuth tokens can be discarded while Service App reads and refreshes continue.
- Service App deauthorization stops access, invalidates local credentials, and never automatically reactivates on reauthorization.
- Duplicate actions, interrupted verification, retries, expired tokens, missing scopes, and provider Integration reconnection remain safe.
- Confirm webhook payload fields, signatures, authorization events, and deauthorization behavior in both external organizations.

Do not describe these as passed until their actual live evidence is recorded in [validation](VALIDATION.md).
