# Documentation map

Use this map to find task context without loading every document. Existing architecture, operations and ADR files remain authoritative; the harness entry points link to them.

## Orientation

| Need | Document |
|---|---|
| Agent rules and check selection | [AGENTS.md](../AGENTS.md) |
| Stack and source map | [ARCHITECTURE.md](../ARCHITECTURE.md) |
| Components, data, protocols and lifecycle diagrams | [Architecture](architecture.md) |
| Installation, CLI, audit and adapter procedures | [Operations](operations.md) |
| Threats and residual risks | [Security](SECURITY.md), [threat model](threat-model.md), [limitations](security-limitations.md) |
| Recovery and verification | [Reliability](RELIABILITY.md), [quality](QUALITY_SCORE.md) |
| Design rationale | [Design index](design-docs/index.md), [core beliefs](design-docs/core-beliefs.md) |
| Implemented user flows | [Product specs](product-specs/index.md) |
| Outstanding validation work | [Plans](PLANS.md), [debt tracker](exec-plans/tech-debt-tracker.md) |
| Platform research and caveats | [Research](research.md) |

## Scope

There is no browser-based product frontend, so separate frontend and visual design-system documents are not scaffolded. The native prompt behavior is covered by product flows and the security docs. No approved future roadmap or active implementation plan is recorded here; do not infer commitments from validation gaps.

The SQL schema remains in `migrations/001_init.sql`; `src/broker/db.ts` adds migration bookkeeping. No live database was inspected to produce these docs. Library reference dumps are omitted: package versions and APIs should be checked against the relevant source and lockfile when needed.
