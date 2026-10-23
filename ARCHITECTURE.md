# Architecture entry point

AgentVault separates agent tools, policy enforcement, browser execution and native credential access. The canonical technical description remains [docs/architecture.md](docs/architecture.md), including topology, login and purchase sequences, session states, storage and signed protocols.

## Stack and source map

| Layer | Technology | Source |
|---|---|---|
| Agent interface | MCP SDK, stdio, Zod schemas | `src/mcp-adapter/`, `src/shared/tools.ts` |
| Policy and persistence | Node 24, TypeScript, built-in SQLite | `src/broker/`, `migrations/` |
| Browser enforcement | Playwright Chromium | `src/browser-worker/` |
| Credential provider | SwiftPM, Keychain, AppKit, LocalAuthentication | `native/AgentVaultHelper/` |
| Chat login approval (optional) | Telegram Bot API, long poll from the broker | `src/broker/chat-approver.ts`; [ADR 0007](docs/adr/0007-configurable-login-approval.md) |
| Development provider | Node helper with plaintext fake credentials | `src/dev-helper/` |
| Operator interface | Host CLI and shell scripts | `src/cli/`, `scripts/` |
| Deployment | Docker Compose broker and worker | `docker-compose.yml`, `docker/` |
| Verification | Vitest, mock shop, Docker smoke, Swift crypto interop | `test/`, `mock-shop/` |

There is no standalone web frontend or application build pipeline. Node executes TypeScript source directly; see [ADR 0005](docs/adr/0005-sqlite-node-builtin-and-no-build-step.md).

## Read next

- [Security boundaries and known gaps](docs/SECURITY.md)
- [Operating and recovering the stack](docs/RELIABILITY.md)
- [Design decisions](docs/design-docs/index.md)
- [Product flows](docs/product-specs/index.md)
- [Complete documentation map](docs/index.md)
