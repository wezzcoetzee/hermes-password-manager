# 0003: Transaction boundary enforced at the network layer

Status: Accepted

## Context
Purchases must need explicit human approval. Blocking the "place order" button or trusting the agent's description of its actions is fragile: pages change, scripts submit forms, the agent may be prompt-injected.

## Decision
The worker routes every request. A request matching a site's `checkout.submitPath` (on its own origin) is held while the worker asks the broker to `consume` an approval for the order summary read from the DOM just before the action. The broker allows it only if an approval is approved, unexpired, hash-equal and atomically marked consumed (single use). Sites without a checkout adapter block non-GET/HEAD requests to checkout-like paths (regex over `checkout|place-order|purchase|payment|pay|billing|order`) and force manual checkout. Redirect hops are fetched with `maxRedirects: 0` and re-vetted.

## Why not
- DOM-level button blocking: bypassable by script, keyboard, or a different element.
- Trusting the agent to call an approval tool first: no enforcement.
- Blocking all non-GET: breaks logins and carts.

## Consequences
- Strong for sites with a reviewed adapter; heuristic and best-effort elsewhere.
- Approval binds to the displayed summary, not the server-side cart (limitation 8).
- The worker only asks; it cannot approve. A compromised worker cannot mint approvals but sits inside the credential TCB.
