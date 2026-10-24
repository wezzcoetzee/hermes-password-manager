# Reliability guide

The broker persists policy and audit state; browser contexts are disposable in-memory state. Recovery must preserve approval checks and discard old authenticated sessions rather than silently restoring them.

## Failure behavior

- Helper denial or unavailability leaves login sessions anonymous. Signature or request-binding failures cannot count as consent.
- On `chat` grants, a timeout (120s), a failed send or a missing bot configuration returns `approval_unavailable`. There is no fallback to the native prompt or the other provider. A failed Telegram long poll or Discord reaction poll is retried every 2s while a request is pending.
- Broker startup terminates old live sessions and expires outstanding approvals, then asks the worker to close contexts. See [session lifecycle](architecture.md#session-lifecycle) for timers and retry behavior.
- A worker restart loses browser contexts. It does not reconstruct cookies from SQLite.
- Purchase enforcement denies when the broker cannot consume a valid matching approval.

## Operations and recovery

Use the [operations runbook](operations.md) for health inspection, audit events, startup, shutdown and revocation. Restart and revocation commands affect live sessions, so obtain authorization before using them on an operator's stack.

Audit records contain event names, outcomes, identifiers and reasons; never add credentials or full order details. The broker uses Pino logging (`src/shared/logger.ts`). No external alerting, uptime SLO, scheduled backup or tested restore-time guarantee is configured in this repository. Audit rows are not tamper-evident.

SQLite and broker private keys live in the `broker-data` volume; credentials live separately in the native helper's Keychain. Do not assume a database copy alone restores a usable installation. Backup and restore procedures need explicit design and validation before being represented as supported operations.

See [quality checks](QUALITY_SCORE.md) and [security limitations](security-limitations.md) for current verification boundaries.
