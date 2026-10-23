---
name: agentvault-setup
description: Install and configure AgentVault end to end on a Mac, connect it to Hermes (or another MCP agent), enroll the first account and verify the stack. Use when asked to set up, install or connect AgentVault.
---

# Set up AgentVault

You are helping the user install AgentVault on their own Mac. The repo docs are authoritative; this skill sequences them. Read each linked section before acting on it.

## Ground rules

- **Ask before every step that changes the machine**: running `scripts/install.sh`, `scripts/start.sh`/`stop.sh`, `docker compose up`, `launchctl`, codesigning, writing `~/.hermes/config.yaml`, or anything that touches the Keychain. Show the command, wait for a yes. See [AGENTS.md](../../AGENTS.md).
- **Never read, print, type or ask for a real password.** The user types passwords into the native helper dialog. Do not open `~/.agentvault/agent-token`, `secrets/worker_token` or Keychain items; check only that they exist.
- Do not edit allowlists, private-network checks or approval logic to get past an error. Stop and report it.
- Report each step's outcome honestly. If something was skipped or failed, say so.

## 1. Prerequisites

Check, do not install without asking:

| Need | Check |
|---|---|
| macOS (Keychain helper) | `uname` is `Darwin`. On Linux, stop and point to the dev quick start in [README.md](../../README.md#quick-start-linux-dev) (fake credentials only) |
| Node 24+ | `node --version` |
| pnpm | `corepack pnpm --version` (the installer enables corepack) |
| Docker Desktop running | `docker info`; suggest enabling "Start Docker Desktop when you sign in" |
| Swift 5.9+ | `swift --version`; otherwise `xcode-select --install` |
| Hermes (optional) | `command -v hermes` |

## 2. Install

Read [`scripts/install.sh`](../../scripts/install.sh) and [Operations: Install](../../docs/operations.md#install), then summarise to the user what it will do: install deps, create `secrets/worker_token`, build and codesign the Swift helper from `native/AgentVaultHelper` into `~/.agentvault/bin/AgentVaultHelper.app`, start `docker-compose.yml`, create the `hermes` agent token, pair (a native prompt plus Touch ID), install the LaunchAgent from `scripts/launchd/`, link the `agentvault` CLI and connect Hermes.

Ask whether to sign with a Developer ID (`AGENTVAULT_SIGN_IDENTITY`) so rebuilds keep Keychain access; ad hoc signing is the default. With approval, run `scripts/install.sh` from the repo root. It is safe to re-run. Tell the user to watch for the pairing prompt.

## 3. Connect the agent

- **Hermes:** the installer runs `hermes mcp add` and copies [`hermes/SKILL.md`](../../hermes/SKILL.md) to `~/.hermes/skills/agentvault/`. If `hermes` was missing it printed a config instead; with approval, merge it into `~/.hermes/config.yaml` using [`hermes/config.example.yaml`](../../hermes/config.example.yaml) and [README: Hermes config](../../README.md#hermes-config).
- **Other MCP clients:** register a stdio server with an absolute `node` path, args `<repo>/src/mcp-adapter/main.ts`, and env `AGENTVAULT_BROKER_URL=http://127.0.0.1:7800`, `AGENTVAULT_TOKEN_FILE=~/.agentvault/agent-token` (absolute path). Set the tool timeout to 180s or more. Give the agent `hermes/SKILL.md` as its usage instructions.

## 4. First account and grant

Add `~/.agentvault/bin` to `PATH` for the session. Ask which site and account the user wants. Only `test-shop` ships; for a real site, follow [Operations: Adding a site adapter](../../docs/operations.md#adding-a-site-adapter) with the user and keep `checkout: null` until the [checkout verification](../../docs/operations.md#verify-a-checkout-adapter-before-enabling-transactions) is done.

```bash
agentvault credential add <account-id> --site <site-id>   # user types the password in the native dialog
agentvault grant <account-id>                              # add --transactions only after checkout is verified
```

Recommend a dedicated low-risk account first ([real-site pilot](../../docs/operations.md#phase-6-real-site-pilot)).

## 5. Verify

| Check | How | Expect |
|---|---|---|
| Containers | `agentvault status` | broker and browser-worker running; agent token present |
| Broker | `curl -fsS http://127.0.0.1:7800/healthz` | `{"ok":true}` |
| Helper | `launchctl print gui/$(id -u)/dev.agentvault.helper \| grep state` and `lsof -nP -iTCP:47800 -sTCP:LISTEN` | running, listening |
| Accounts | `agentvault accounts` | the enrolled account, masked username |
| Test login | below | `authenticated` |

Test login against the mock shop, with approval: start it with `docker compose --profile dev up -d mock-shop`, enroll a **fake** account (`agentvault credential add demo --site test-shop`; the user types the fake `TEST_USER` from [`mock-shop/shop.ts`](../../mock-shop/shop.ts) into the dialog), `agentvault grant demo`, then from the agent call `browser_navigate` to `http://mock-shop:4000/login`, `request_login` for `demo` (the user approves on the Mac), and `get_session_status`. Finish with `revoke_session`. Afterwards offer to remove it: `agentvault credential remove demo` and `docker compose --profile dev stop mock-shop`.

If anything fails, use [Operations: Locked, logged out, rebooted](../../docs/operations.md#locked-logged-out-rebooted) and `docker compose logs broker`, and the audit log (`agentvault audit`).

## 6. Hand off

Tell the user what was installed, which accounts are granted (and whether transactions are allowed), what was not verified, and how to revoke ([Operations: Revoking access](../../docs/operations.md#revoking-access)).
