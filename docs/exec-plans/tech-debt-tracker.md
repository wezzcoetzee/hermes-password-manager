# Technical debt and validation tracker

This tracker indexes gaps already documented in the repository as of 2026-10-23. It assigns no delivery commitment or unsupported severity score; full risk descriptions remain in [security limitations](../security-limitations.md).

| Gap | Impact | Next evidence needed |
|---|---|---|
| Native helper partly exercised on macOS | Build, pairing and fake-account login pass; denial, purchase, Touch ID and replay unverified | Manually test denial, purchase and replay rejection |
| Real-site workflows untested | Selectors, checkout and bot defenses may break | Dedicated low-risk pilot per operations runbook |
| Same-user Docker access | Agent can reach operator files and container state | Validate a separate-user deployment model |
| Exact-value scrubbing and screenshot limits | Re-encoded or unknown secrets may be visible | Threat-specific fixtures before changing output filtering |
| Global worker session cap, no general rate limiting | One agent can exhaust sessions or cause repeated prompts | Define and test per-agent resource policy |
| DNS resolution race | Allowlisted hostname can change resolution between checks | Evaluate connection-time address enforcement |
| No tested backup/restore procedure | Recovery guarantees unknown | Design and verify isolated recovery with helper key material |

No resolutions are claimed. Update this tracker when evidence changes and link the implementing PR or completed plan.
