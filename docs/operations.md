# Operations

The macOS scripts and Swift helper below have not been run on a Mac. Treat steps as a checklist to validate.

## Install

```bash
scripts/install.sh
```

Prerequisites: Docker Desktop, Node 24, Xcode CLT (Swift 5.9+). The script is expected to build `native/AgentVaultHelper`, create `secrets/worker_token`, start the compose stack, create the `hermes` agent token at `~/.agentvault/agent-token`, install the LaunchAgent and pair keys. Read the script before running it. Then enroll accounts (`agentvault credential add`, `agentvault grant`) and add the Hermes config from the README.

## Auto start

| Piece | How |
|---|---|
| Helper | LaunchAgent from `scripts/launchd/dev.agentvault.helper.plist`, loaded into the user's GUI session (`~/Library/LaunchAgents`). It must run in the GUI session, since a LaunchDaemon cannot show prompts or Touch ID |
| Containers | Docker Desktop setting "Start Docker Desktop when you sign in", plus `restart: unless-stopped` in `docker-compose.yml` |
| Manual | `scripts/start.sh` and `scripts/stop.sh`; or `docker compose up -d` / `docker compose down` |

Check: `agentvault status` (compose state and token presence).

## Locked, logged out, rebooted

| Situation | Behaviour |
|---|---|
| Mac locked or no GUI session | Helper cannot prompt: login and purchase requests return `approval_unavailable` / denial. Existing sessions keep working until they expire |
| Helper not running | `helper_unavailable` (503); nothing is approved |
| Not paired | `helper_unpaired` (503); run `agentvault pair` |
| Docker not running | The adapter reports "AgentVault broker is unreachable. Is Docker running?" |
| Broker restart or reboot | On boot the broker marks every `anonymous` and `authenticated` session `terminated`, expires pending and approved transaction approvals, and tells the worker to close all contexts. Worker sessions are in memory and do not survive a worker restart |

## Audit

```bash
agentvault audit                       # last 50
agentvault audit --event credential_access --limit 20 --json
agentvault sessions; agentvault accounts
```

Event names: `agent_auth`, `policy_violation`, `session_created`, `session_expired`, `session_revoked`, `credential_access`, `login_approval`, `login_result`, `browser_action`, `transaction_approval`, `transaction_execution`. Rows contain ids, outcomes and reasons, not secrets. Broker logs: `docker compose logs broker`.

## Revoking access

- One account: `agentvault revoke <id>`; remove it with `agentvault credential remove <id>` (deletes the Keychain item and broker record).
- An agent: `docker compose exec broker node src/broker/admin.ts agent-disable hermes`.
- Live session: Hermes calls `revoke_session`, or `docker compose restart broker` terminates all.

## Adding a site adapter

Create `sites/<id>.json` (schema in `src/shared/sites.ts`, example `sites/test-shop.json`) and rebuild: `docker compose build && docker compose up -d`.

| Field | Meaning |
|---|---|
| `id` | `[a-z0-9-]{1,40}`, unique; used in `--site` |
| `name` | Shown in prompts and order summaries |
| `origin` | Primary origin (http/https); normalised |
| `extraOrigins` | Other origins the page may load (CDN, auth). Everything else is blocked. Each one widens the attack surface |
| `allowPrivateNetwork` | Dev only. Leave `false` for real sites |
| `screenshots` | Default `false`; enable only if you accept unscrubbed page content in images |
| `login.url`, `login.username`, `login.password`, `login.submit` | URL and CSS selectors |
| `login.successPath` | Regex on the post-login path |
| `checkout` | `null` (manual checkout) or an object |
| `checkout.pagePath` | Regex for the checkout page path |
| `checkout.submitPath` | Regex for the order-submit request path (any method) on the site origin; this is the purchase boundary |
| `checkout.summary.*` | Selectors for item rows (`item`, `name`, `variant`, `quantity`, `unitPrice`) and `shipping`, `total`, `currency`, `address`, `paymentMethod` |

### Verify a checkout adapter before enabling transactions

1. Use a test or low-value order and a dedicated account.
2. In browser devtools, find the exact request that finalises payment. Confirm `submitPath` matches only it, and that nothing earlier (basket updates, address saves, payment tokenisation) also matches or needs to be blocked.
3. Confirm the summary selectors return the real item, total, currency, delivery address and payment method, and nothing from a different region of the page.
4. Check what happens with promo codes, split shipments and 3-D Secure: if the order can be finalised through a different request or origin, `checkout` is not safe; keep it `null`.
5. Run through the flow with `--transactions` granted. Confirm a click before approval is blocked and audited (`transaction_execution` `blocked`), approval allows exactly one order, and a changed basket blocks (`order_changed_since_approval`).
6. Only then grant `--transactions` for real accounts.

### Phase 6 real-site pilot

- Use a dedicated low-risk account, not your primary one. No stored card if you can avoid it.
- Read-only first: browse, log in, snapshot. Grant without `--transactions`.
- No checkout adapter means manual checkout: the agent fills the basket, you pay yourself.
- Watch `agentvault audit` after each run and read the prompts instead of tapping through.
- Expect bot detection, CAPTCHAs and 2FA to break logins; AgentVault does not solve them.
