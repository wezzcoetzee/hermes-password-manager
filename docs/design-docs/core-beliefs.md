# Core beliefs

These principles summarize the existing ADRs and enforcement boundaries. Use the linked decisions for rationale and implementation detail.

## Human consent is a capability boundary

Login and purchase consent comes from the helper, never page text or an agent assertion. The only exceptions are chat and auto login grants, which also need a per-account flag set in the helper ([ADR 0007](../adr/0007-configurable-login-approval.md)). Preserve signed, request-bound responses and single-use purchase approvals. See [ADR 0006](../adr/0006-signed-helper-protocol.md).

## Policy and execution have separate owners

The broker decides; the worker enforces network rules and owns disposable browser contexts. The worker cannot mint approvals, but remains trusted with credentials. See [architecture](../architecture.md).

## Site support is reviewed configuration

Keep origins, login selectors and checkout boundaries in reviewed adapters. Prefer manual checkout over pretending an unknown purchase path is protected. See [ADR 0004](../adr/0004-site-adapters-as-reviewed-config.md).

## Minimize machinery and claims

Use built-in SQLite and direct Node TypeScript execution as recorded in [ADR 0005](../adr/0005-sqlite-node-builtin-and-no-build-step.md). Describe tested behavior precisely; do not present the partly verified native service or real-site support as established.
