# 0004: Site adapters as reviewed config

Status: Accepted

## Context
Login selectors, allowed origins and the purchase boundary differ per site. Letting the agent choose any of them lets a prompt-injected agent point a login at an attacker page.

## Decision
One JSON file per site under `sites/`, validated by zod (`src/shared/sites.ts`) at broker start and shipped in the image. Fields: `id`, `name`, `origin`, `extraOrigins`, `allowPrivateNetwork` (dev only), `screenshots`, `login` (url, selectors, `successPath`), `checkout` (null or `pagePath`, `submitPath`, summary selectors). Accounts bind to a site id; the helper binds each credential to an origin. Adapters are code-reviewed, not agent-supplied.

## Why not
- Agent-supplied URLs and selectors: removes the allowlist.
- Learning selectors automatically: unreviewable.
- Per-site code plugins: more power than needed.

## Consequences
- Adding a site is a reviewed commit and an image rebuild.
- Sites drift; selectors break and need maintenance.
- `checkout: null` is the safe default and means manual checkout.
