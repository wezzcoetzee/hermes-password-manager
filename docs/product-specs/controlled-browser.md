# Controlled browsing, login and purchase

AgentVault lets Hermes use an enrolled account without receiving its password or cookies. This describes the existing tool contract in `src/shared/tools.ts`; it does not claim real-site or native macOS validation.

Last checked: 2026-10-23.

## Preconditions

An operator enrolls an account, configures a reviewed site adapter and grants the agent access. Purchase approval additionally requires transaction rights and a verified checkout adapter. See [operations](../operations.md).

## User flow

1. The agent lists granted accounts and navigates to an allowlisted site, receiving an anonymous session id.
2. `request_login` asks the human for consent through the grant's approval mode: the native prompt by default, a Telegram message, or no prompt for `auto` grants ([ADR 0007](../adr/0007-configurable-login-approval.md)). Approved credentials are entered by the worker; denial or unavailability leaves the session anonymous.
3. Browser tools act through numbered refs from snapshots. Website text is untrusted data; snapshots omit input values and scrub known secrets with documented limits.
4. At checkout, `request_transaction_approval` reads the displayed summary and asks the human. Approval lasts two minutes and covers one matching order submission.
5. The worker rereads the summary before the action and the broker atomically consumes approval at the network boundary. Changed, expired or already-used approval blocks submission.
6. Revoke or expiry destroys the context and its cookies. Broker restart terminates prior sessions.

## Success and failure criteria

Success means authenticated browsing without tool-visible credentials, and an order submitted only after matching human approval. Denied login must not authenticate. A site without a checkout adapter returns `manual_checkout_required`; the agent must hand checkout back to the user. Screenshots require explicit site configuration and cannot be scrubbed like text.

The approval binds the DOM summary, not the merchant's server-side cart. CAPTCHA, 2FA and bot detection are unresolved. Read [security limitations](../security-limitations.md) before treating this flow as production-ready.

See the [login sequence](../architecture.md#login-flow), [purchase sequence](../architecture.md#purchase-flow) and [session state diagram](../architecture.md#session-lifecycle) for component-level behavior.
