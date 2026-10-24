# Contributing

Use Node 24.13+ in the 24.x line. No application dependencies need installing.

1. Create a focused branch.
2. Run `npm run check` and `npm test`.
3. For UI changes, run the optional browser smoke test and inspect desktop/mobile screenshots.
4. Keep Webex behavior evidence-led. Update `docs/VALIDATION.md` when a live test is actually performed.
5. Open a pull request describing the behavior and relevant validation.

Do not add generated `.env` files, SQLite databases, credentials, real customer data, or environment-specific deployment details. Avoid new dependencies or abstractions unless needed to solve the task. Preserve the separation between fixture demonstrations, mocked contract tests, own-org validation, and external-customer acceptance.
