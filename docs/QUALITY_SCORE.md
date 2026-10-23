# Quality checks

Quality is assessed through checks and documented validation limits, not an invented numeric score. Choose checks that exercise the changed boundary; documentation-only work needs link and diff validation rather than browser execution.

## Available checks

| Command | Evidence |
|---|---|
| `pnpm typecheck` | Strict TypeScript with no emit; see `tsconfig.json` |
| `pnpm lint` | Repository ESLint rules |
| `pnpm test` | Vitest unit and real-Chromium e2e tests |
| `pnpm test:e2e` | Purchase acceptance and adversarial security cases |
| `pnpm test:docker` | Isolated Compose smoke stack through the real MCP adapter |
| `scripts/verify-crypto-interop.sh` | Swift/Node signing and sealing compatibility via Docker |

Use Node >=24 and install dependencies with pnpm. Chromium is required for e2e tests (`pnpm exec playwright install chromium`). Read the Docker smoke configuration before running it to avoid collision with existing services. Tests are serialized by `vitest.config.ts`; do not assume parallel browser tests are supported.

## Evidence boundaries

No coverage percentage, performance budget or availability target is configured. Passing Node tests does not verify the native helper; it has been checked by hand on macOS only for build, pairing and a fake-account login. Crypto interop verifies only cryptographic compatibility. Real merchant workflows remain untested according to the [limitations](security-limitations.md).

Update documentation alongside behavior, preserve the [design decisions](design-docs/index.md), and report exactly which checks ran. Track remaining validation in [plans](PLANS.md).
