# 0002: Apple Passwords is not integrated; macOS Keychain is the provider

Status: Accepted. Apple platform claims not re-verified against live Apple docs; see research.md.

## Context
The user's website passwords may live in Apple Passwords (iCloud Keychain). A broker needs a credential provider it can read programmatically.

## Decision
Use the macOS Keychain via the Security framework: generic password items, service `dev.agentvault.credential`, account = account id. Passwords are entered once into the helper's own UI during `agentvault credential add`.

## Why not
- Direct read of Apple Passwords: no public API for third-party processes; items sit under Apple-only access groups.
- AuthenticationServices / Shared Web Credentials: only domains associated with your own app via Associated Domains; not usable for arbitrary merchants.
- Credential provider extension: wrong direction (supplies credentials to AutoFill).
- Password AutoFill: user-mediated UI in Safari/WebKit; Playwright Chromium cannot invoke it.
- iCloud Passwords extension native-messaging channel (apwcli and similar): unofficial, reverse-engineered, needs PIN pairing, may break or breach the rule against unofficial extraction.
- Reading Safari cookies/sessions: needs Full Disk Access and private formats.

## Consequences
- Passwords must be enrolled separately; they do not sync from Apple Passwords. Keychain access gives no access to Apple Passwords.
- A later Apple-supported path could slot in behind the same helper protocol.
