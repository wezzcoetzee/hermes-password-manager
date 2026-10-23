# Agent guidance

AgentVault is a local credential broker and controlled browser for Hermes. Start with [architecture](ARCHITECTURE.md), then read only the task-specific documents in the [documentation map](docs/index.md).

## Working rules

- Use Node 24 or newer and pnpm. TypeScript runs directly with Node type stripping; imports use `.ts` extensions. Keep syntax erasable and types strict.
- Keep the MCP adapter thin. Authoritative validation, grants, session ownership and approvals belong in `src/broker/`; browser enforcement belongs in `src/browser-worker/`.
- Never expose passwords, cookies, private keys or bearer tokens through tools, snapshots, audit rows, logs or documentation. The dev helper is for fake credentials only.
- Do not weaken allowlists, private-network checks, approval binding or single-use consumption to make a site work. Site adapters are reviewed configuration, never agent input.
- Changes to helper cryptography must keep TypeScript and Swift byte-compatible. Read [ADR 0006](docs/adr/0006-signed-helper-protocol.md) and run the interop check when changing the protocol.
- Do not run install/start/stop scripts, touch live credentials or databases, or restart an operator's stack without explicit authorization. Test against isolated fixtures.
- The macOS helper has been built, paired and passed a fake-account login on a real Mac. Denial, purchase approval, Touch ID and replay rejection are still unverified there, and Linux tests do not establish them.

## Task context and verification

| Task | Read first | Relevant checks |
|---|---|---|
| Broker policy or browser guard | [Security](docs/SECURITY.md), [architecture](docs/architecture.md) | `pnpm typecheck`, `pnpm lint`, targeted unit tests and `pnpm test:e2e` |
| Helper protocol | [ADR 0006](docs/adr/0006-signed-helper-protocol.md), `src/shared/helper-protocol.ts` | Protocol/crypto unit tests, `scripts/verify-crypto-interop.sh`; macOS manual verification for native behavior |
| Site adapter | [Operations](docs/operations.md#adding-a-site-adapter), `src/shared/sites.ts` | Reviewed selectors and checkout boundary using fake or explicitly authorized test accounts |
| Storage | `migrations/`, `src/broker/db.ts` | Migration behavior and affected broker tests |
| Docs only | [Documentation map](docs/index.md) | Local links, source paths, diagram syntax and `git diff --check` |

Use `pnpm exec vitest run <test-file>` for a focused test. Full test and Docker commands are described in [quality](docs/QUALITY_SCORE.md). Do not add redundant smoke tests for documentation changes.

## Completion and handoff

Update the owning document when behavior changes; link to existing explanations rather than copying them. Preserve ADR history. Report changed paths, checks actually run, unresolved limitations and the PR URL. When work is delegated, assign disjoint file ownership and include those same details in the handoff; delegation is not required for ordinary changes.
