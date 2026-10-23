# 0001: Hybrid native helper plus Docker

Status: Accepted (MVP; native half unverified)

## Context
Three jobs with different needs: hold passwords and ask the user (needs Keychain, Touch ID, GUI session: native macOS), run an untrusted-web browser (needs isolation and easy teardown), and enforce policy (needs to be unreachable by the agent's tool surface).

## Decision
Split into a native Swift helper on the host (Keychain, prompts, Touch ID) and two containers: a broker (policy, SQLite, audit) and a browser worker (Playwright Chromium). The agent reaches only the broker, via a stdio MCP adapter on the host and a loopback-published port. Broker keys live in the broker's docker volume.

## Why not
- All native on macOS: no practical browser isolation; Chromium and policy run in the user's session next to the Keychain.
- All in Docker: containers cannot reach the Keychain, Touch ID or native prompts.
- Playwright on the host: page content would execute in the same user session as the secrets.

## Consequences
- Prompts and Touch ID are outside anything the container or agent can drive.
- Needs Docker Desktop running and a logged-in GUI session; both are operational dependencies (see operations.md).
- Isolation is a Linux VM plus namespaces, not a hardware boundary. Same-macOS-user access to the docker socket defeats it (see threat-model.md).
- Two languages and a signed protocol between them (ADR 0006).
