# Security guide

AgentVault limits what an agent can do with credentials through grants, human approval and a guarded browser. Read the [threat model](threat-model.md) and [known limitations](security-limitations.md) before changing any security boundary; this guide routes you to their detailed controls.

## Ownership and controls

| Concern | Authority and implementation |
|---|---|
| Agent authentication | Broker bearer-token hash lookup; `src/broker/service.ts` |
| Account access and session ownership | Broker grants and session checks; `src/broker/service.ts` |
| Login and purchase consent | Signed helper responses; `src/broker/helper-client.ts`, `src/shared/helper-protocol.ts` |
| Chat and auto login approval | Grant mode in the broker plus the helper's per-account `unattended` flag; `src/broker/service.ts`, `src/broker/chat-approver.ts`; [ADR 0007](adr/0007-configurable-login-approval.md) |
| Origin and request enforcement | Worker; `src/browser-worker/guard.ts`, `src/browser-worker/session.ts` |
| Tool validation | Shared Zod schemas, revalidated by broker; `src/shared/tools.ts` |
| Secret output filtering | `src/browser-worker/snapshot.ts`, `src/browser-worker/sanitize.ts` |
| Native storage | Helper Keychain implementation, verified on macOS for a fake-account login |

The worker is trusted with credentials and live cookies. Broker storage includes plaintext usernames and order metadata, but no persisted passwords or cookies. Same-user Docker access defeats container separation. Scrubbing and prompt-injection flags have documented limits; neither replaces capability enforcement.

## Change checklist

- Preserve agent, site, account and session binding on each privileged operation.
- Fail closed when approval is denied, unavailable, forged, expired, changed or already consumed.
- Never let approval come back through an agent tool, and never let broker state alone skip the helper prompt. Purchases always need the native prompt.
- Keep passwords, cookies and key material out of responses, audits and logs.
- Exercise relevant adversarial cases in `test/e2e/security.test.ts`.
- For protocol changes, follow [ADR 0006](adr/0006-signed-helper-protocol.md) and verify both implementations.
- For new adapters, follow the [checkout verification procedure](operations.md#verify-a-checkout-adapter-before-enabling-transactions).
