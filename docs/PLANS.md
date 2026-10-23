# Plans and validation gaps

As of 2026-10-23, the repository contains an MVP and documented validation gaps. This is a record of existing limits, not an approved delivery schedule.

## Validation still needed

1. Compile and manually exercise the macOS helper, including pairing, login consent, denial, Touch ID and purchase consent.
2. Run a dedicated low-risk real-site pilot following [operations](operations.md#phase-6-real-site-pilot).
3. Evaluate security gaps recorded in the [debt tracker](exec-plans/tech-debt-tracker.md) before broader use.

## Deliberate boundaries

Apple Passwords integration is excluded by [ADR 0002](adr/0002-apple-passwords-not-integrated.md). Unreviewed sites have manual checkout; agents cannot supply new adapters dynamically. Do not add automatic approval or session restoration as convenience features.

No active feature plan or delivery dates are recorded. Add a dated plan under `exec-plans/active/` when work is approved, and move it to `exec-plans/completed/` after verification.
