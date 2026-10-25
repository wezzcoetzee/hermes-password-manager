# Operations

The macOS scripts and Swift helper below have not been run on a Mac. Treat steps as a checklist to validate.

## Install

```bash
scripts/install.sh
```

Prerequisites: Docker Desktop, Node 24, Xcode CLT (Swift 5.9+). The script is expected to build `native/AgentVaultHelper`, create `secrets/worker_token`, start the compose stack, create the `hermes` agent token at `~/.agentvault/agent-token`, install the LaunchAgent and pair keys. Read the script before running it. Then enroll accounts (`agentvault credential add`, `agentvault grant`) and add the Hermes config from the README.

## CLI reference

`agentvault` (`src/cli/main.ts`) runs on the host. Broker commands run `src/broker/admin.ts` inside the broker container through `docker compose exec`, so the stack must be up. Passwords and bot tokens never appear as arguments: passwords are typed into the native helper's own prompt, and bot tokens are typed at a hidden prompt. Run `agentvault` with no arguments to print the built-in help.

| Command | What it does |
|---|---|
| `agent add [name]` | Creates an agent (default `hermes`) and writes its token to `~/.agentvault/agent-token`, or `agent-token-<name>` for other names (mode 600) |
| `pair` | Exchanges keys between the broker and the native helper. Run it again after reinstalling either one. See [architecture](architecture.md) |
| `credential add <id> --site <site> [--username u] [--label l]` | Saves a password. The helper asks for the username (if not given) and the password, then stores them in the Keychain. The broker records the account. `<site>` must be a reviewed adapter in `sites/`; unknown ids print the known list |
| `credential rotate <id> --site <site> [--username u]` | Replaces the stored password through the same helper prompt. The broker record and grants stay as they are |
| `credential remove <id>` | Deletes the Keychain item and the broker account, revoking its live sessions |
| `accounts` | Lists saved accounts: id, site, label and maximum session length. Passwords are never shown, since only the Keychain holds them |
| `grant <id> [--transactions] [--approval prompt\|chat\|auto] [--agent name]` | Lets an agent (default `hermes`) use an account. `--transactions` allows purchase approval requests. Approval modes are described [below](#login-approval-modes). Running it again updates the grant |
| `revoke <id> [--agent name]` | Removes the grant and clears the helper's unattended flag |
| `grants` | Lists each grant's agent, account, transaction right and approval mode |
| `chat telegram --chat-id <id>` | Sets up [Telegram approvals](#set-up-telegram-approval) |
| `chat discord --user-id <id> [--channel-id <id>]` | Sets up [Discord approvals](#set-up-discord-approval), in DMs or in a shared channel. The chat provider set up last is the one used |
| `sessions` | Lists the 20 most recent browser sessions with state and expiry |
| `audit [--event e] [--limit n] [--json]` | Shows audit events, newest first (default 50). See [Audit](#audit) |
| `status` | Shows compose state and whether the agent token is present |

| Environment variable | Default | Purpose |
|---|---|---|
| `AGENTVAULT_HOME` | `~/.agentvault` | Where agent tokens and the installed helper live |
| `AGENTVAULT_HELPER` | The helper app in `$AGENTVAULT_HOME/bin` | Helper command. Set `node src/dev-helper/main.ts` for Linux development (fake credentials only) |

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
| Mac locked or no GUI session | Helper cannot prompt: login and purchase requests return `approval_unavailable` / denial. `chat` and `auto` logins on unattended accounts skip the prompt, but may still fail while locked (unverified, see [limitations](security-limitations.md)). Existing sessions keep working until they expire |
| Chat provider unreachable, bot not set up, or no tap or reaction within 120s | `chat` grants return `approval_unavailable`; nothing is approved. Check `agentvault audit --event login_approval` and the bot token. On Discord, also check the bot shares a server with you and may DM you, or in channel mode that it can post and react in that channel |
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

Login approvals record `channel`: `helper` for the helper's answer, plus `chat` or `auto` for those grants (`auto` logs outcome `auto_approved`). `agentvault grants` lists each grant's transaction right and approval mode.

Event names: `agent_auth`, `policy_violation`, `session_created`, `session_expired`, `session_revoked`, `credential_access`, `login_approval`, `login_result`, `browser_action`, `transaction_approval`, `transaction_execution`. Rows contain ids, outcomes and reasons, not secrets. Broker logs: `docker compose logs broker`.

## Login approval modes

Each grant chooses who approves its logins. Purchases always use the native prompt. See [ADR 0007](adr/0007-configurable-login-approval.md), [ADR 0008](adr/0008-discord-chat-approval.md) and [ADR 0009](adr/0009-discord-shared-bot-channel.md).

| Mode | Command | Who approves |
|---|---|---|
| `prompt` (default) | `agentvault grant <id>` | Native prompt and Touch ID on the Mac |
| `chat` | `agentvault grant <id> --approval chat` | You, by tapping Approve once in Telegram or reacting ✅ in Discord within 120s |
| `auto` | `agentvault grant <id> --approval auto` | Nobody; the login is audited as `auto_approved` |

`chat` and `auto` first ask the helper to mark the account unattended, with a native confirmation and Touch ID. Without that flag the helper still prompts. The flag belongs to the account, not the grant: `--approval prompt` or `revoke` for any agent clears it, and other agents' `chat` or `auto` grants on that account then fall back to the native prompt. Re-enrolling a credential (`credential rotate`) also clears it. On a `chat` grant without the flag, the native prompt follows the chat approval; rerun `agentvault grant <id> --approval chat` to set it again. A plain `grant <id>` sets the broker grant back to `prompt` but leaves the helper flag alone.

### Set up Telegram approval

Use a bot for AgentVault only, not the one Hermes uses. If approvals came through Hermes' bot, the agent could approve itself.

1. Create a bot with @BotFather and keep its token. Do not set a webhook on it; the broker long-polls.
2. Send the bot any message from your own account, so it can message you. Get your numeric user id, for example from @userinfobot.
3. `agentvault chat telegram --chat-id <your id>` and paste the token at the hidden prompt. It is stored only in the broker's `settings` table.
4. `agentvault grant <id> --approval chat`.

Only taps from that user id, in its private chat with the bot, count. If the bot is not set up or Telegram is unreachable, `request_login` returns `approval_unavailable`; it does not fall back to the native prompt.

### Set up Discord approval

Chat approval uses one provider at a time: whichever of `chat telegram` or `chat discord` you ran last. Discord works in one of two ways:

- **Channel, with Hermes' bot**: the prompt appears in a channel you already use with Hermes, sent by Hermes' bot, mentioning you. Hermes holds the token, so an approval of a prompt that was edited is denied ([ADR 0009](adr/0009-discord-shared-bot-channel.md)).
- **DM, with AgentVault's own bot**: a separate bot DMs you.

For the channel:

1. Make sure Hermes' bot can View Channel, Send Messages, Add Reactions and Read Message History there.
2. Turn on Developer Mode in Discord. Copy your user id (right-click your name, Copy User ID) and the channel id (right-click the channel, Copy Channel ID).
3. `agentvault chat discord --user-id <your id> --channel-id <channel id>` and paste Hermes' bot token at the hidden prompt. It is stored only in the broker's `settings` table.
4. `agentvault grant <id> --approval chat`.

For a DM:

1. Create an application in the Discord Developer Portal, add a bot and copy its token. No privileged intents or interactions endpoint are needed; the broker only makes outbound REST calls.
2. Invite the bot to a server you are in. A private server with just you and the bot is enough. Keep "Allow direct messages from server members" on for that server, so the bot can DM you.
3. Turn on Developer Mode in Discord and copy your user id (right-click your name, Copy User ID).
4. `agentvault chat discord --user-id <your id>` and paste the token at the hidden prompt. It is stored only in the broker's `settings` table.
5. `agentvault grant <id> --approval chat`.

Each login sends a message with ✅ and ❌ already added. React ✅ to approve once or ❌ to deny. Only your user id's reaction counts, and ❌ wins if both are set. With no decision in 120s the message is marked expired and `request_login` returns `approval_unavailable`.

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
