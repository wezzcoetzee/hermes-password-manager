# Design documents

The existing ADRs are the canonical decisions. Keep them in place and link new decisions here rather than duplicating their rationale.

| Document | Status | Subject |
|---|---|---|
| [Core beliefs](core-beliefs.md) | Current | Working principles derived from the implementation |
| [ADR 0001](../adr/0001-hybrid-native-plus-docker.md) | Accepted, native half partly verified | Native helper and container split |
| [ADR 0002](../adr/0002-apple-passwords-not-integrated.md) | Accepted | Keychain enrollment, no Apple Passwords integration |
| [ADR 0003](../adr/0003-network-level-transaction-boundary.md) | Accepted | Network purchase boundary |
| [ADR 0004](../adr/0004-site-adapters-as-reviewed-config.md) | Accepted | Reviewed site configuration |
| [ADR 0005](../adr/0005-sqlite-node-builtin-and-no-build-step.md) | Accepted | Built-in SQLite and direct TypeScript execution |
| [ADR 0006](../adr/0006-signed-helper-protocol.md) | Accepted, verified on macOS | Signed requests and sealed credentials |
| [ADR 0007](../adr/0007-configurable-login-approval.md) | Accepted, `auto` not exercised on macOS | Per-grant login approval: native prompt, Telegram or auto |
| [ADR 0008](../adr/0008-discord-chat-approval.md) | Accepted, not tested against Discord | Discord chat approval through reactions |
| [ADR 0009](../adr/0009-discord-shared-bot-channel.md) | Accepted, not tested against Discord | Discord approval in a channel, through Hermes' own bot |

Existing ADRs have no decision dates recorded; none are inferred here. For current crypto validation scope, prefer the [README status](../../README.md) and [limitations](../security-limitations.md) over historical untested wording in ADR 0006.
