# 0006: Signed broker-to-helper protocol

Status: Accepted (Swift side verified on macOS, including replay rejection)

## Context
The broker in a container calls the host helper over `host.docker.internal`. Any local or container process could try to hit that port, or impersonate the helper and return a fake approval.

## Decision
- Requests: ECDSA P-256 over `POST\npath\nts\nnonce\nsha256(body)`; helper pins the broker key, allows 30s skew, rejects nonce reuse.
- Responses: helper-signed over `nonce\nsha256(payload)`; broker pins the helper key and checks `requestId`.
- Credentials: sealed with ephemeral ECDH P-256, HKDF-SHA256 (salt `requestId`, info `agentvault/credential/v1`), AES-256-GCM, to a separate broker sealing key.
- Keys exchanged once via `agentvault pair`; broker private keys stay in the docker volume.

## Why not
- Bearer token over HTTP: replayable, leaked by any reader of the config file.
- mTLS: heavier certificate management for two peers; signatures also bind each answer to its request.
- Unix socket: not reachable from a Docker Desktop VM.
- Plaintext credentials over the loopback link: any listener sees the password.

## Consequences
- A process that reaches port 47800 without the broker key gets nothing; forged approvals fail verification.
- Pairing is trust-on-first-use by the admin; re-pairing replaces the pinned key.
- Two implementations (TypeScript, Swift) must stay byte-compatible (nonce input, X9.63 points, CryptoKit combined box). The Swift one is untested against the TypeScript one.
