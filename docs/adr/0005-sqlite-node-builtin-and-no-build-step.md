# 0005: node:sqlite and no build step

Status: Accepted

## Context
The broker needs a small embedded store. Fewer dependencies means a smaller supply-chain surface for a security tool.

## Decision
Use `node:sqlite` (`DatabaseSync`) with plain SQL migrations in `migrations/`. Run TypeScript directly with Node 24 type stripping (`node src/broker/main.ts`); `tsc --noEmit` is typecheck only, with no emit. Imports use `.ts` extensions; only erasable TypeScript syntax is allowed.

## Why not
- better-sqlite3 or an ORM: native build step and extra dependencies.
- Postgres: a service to run and secure for a single-user tool.
- tsc/bundler emit: a build artifact to keep in sync with source.

## Consequences
- Requires Node >= 24 (`engines`); `node:sqlite` API may change.
- No enums, parameter properties or other non-erasable syntax.
- Images copy `src/` as-is.
