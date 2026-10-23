# Research

## Hermes (verified)

Verified from local source at `~/.hermes/hermes-agent` commit `b34ee8074`: `tools/mcp_tool.py`, `cli-config.yaml.example`, `apps/desktop/src/app/settings/mcp-settings.tsx`.

- Config: `~/.hermes/config.yaml`, key `mcp_servers`.
- Transports: stdio (`command`, `args`, `env`), HTTP/StreamableHTTP (`url`, `headers`), SSE (`transport: sse`).
- Per-server `timeout` (default 120s) and `connect_timeout` (60s).
- `tools.include` / `tools.exclude` filter which tools are exposed.
- Tools register as `mcp_<server>_<tool>`, e.g. `mcp_agentvault_browser_click`.
- Hermes Desktop edits the same `mcp_servers` key and hot-reloads through a `reload.mcp` gateway request.
- stdio subprocess environment is filtered: pass needed variables in `env`, and use an absolute `command` path.
- Hermes has its own browser toolset (`tools/browser_tool.py`, `agent-browser` CLI, local Chromium or Browserbase/Browser Use cloud). It is independent of AgentVault and has no access to AgentVault sessions. Toolsets are configurable per platform via `platform_toolsets`; to force browsing through AgentVault, disable the built-in browser toolset there.
- Skills are supported (`~/.hermes/skills`).

**Recommendation:** `timeout` of at least 180 for the server. The adapter waits up to 180s on `request_login` and `request_transaction_approval`, and the helper prompt expires after 120s. The example uses 200.

## Apple Passwords

These points come from Apple platform knowledge and were **not re-verified against live Apple documentation in this session**. Re-check before relying on them.

- No public API lets a third-party process read Apple Passwords / iCloud Keychain website passwords for arbitrary domains. Those items sit in the data-protection keychain under Apple-only access groups.
- `AuthenticationServices` (`ASAuthorizationPasswordProvider`, Shared Web Credentials) returns credentials only for domains associated with your own app through Associated Domains (`apple-app-site-association`). Not usable for lululemon.com and similar.
- `ASCredentialProviderExtension` is the reverse direction: an app supplying credentials to AutoFill.
- Password AutoFill is user-mediated UI in Safari/WebKit and native text fields. Playwright-driven Chromium cannot invoke it.
- The iCloud Passwords Chrome extension talks to a native messaging helper over a reverse-engineered protocol. Tools such as `apwcli` reuse that channel, need user PIN pairing, and are unofficial and unsupported. They could break or violate the rule against unofficial extraction, so they are not used.
- Reusing Safari sessions would mean reading Safari cookies (Full Disk Access, private formats). Rejected.

**Conclusion:** an Apple Passwords provider is unavailable. The supported provider is the macOS Keychain (Security framework, generic password items, service `dev.agentvault.credential`, account = account id). Keychain access does **not** give access to Apple Passwords. See [ADR 0002](adr/0002-apple-passwords-not-integrated.md).

## macOS security options considered

| Option | Notes |
|---|---|
| Separate macOS user for Hermes | Strongest practical isolation from the same-user problem; see threat-model.md |
| Code signing + keychain ACLs | Restricts which binary reads the Keychain items; needs a signing identity |
| LocalAuthentication (Touch ID / password) | Used before releasing a credential or approving an order |
| App sandbox | Possible for the helper; not set up in the MVP |
| launchd LaunchAgent | Used for the helper; needs a GUI session for prompts |
| Docker Desktop VM | Containers run in a Linux VM; isolation is VM plus namespaces |

Whether each is wired into the Swift helper is unverified; the helper has been built and used for a login, but these settings were not checked.
