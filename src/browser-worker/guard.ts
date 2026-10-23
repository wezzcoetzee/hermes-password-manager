/**
 * Network policy for a session. Applied to every request the page makes
 * (navigations, redirects, sub-resources), not just to agent-issued URLs.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { siteOrigins, type Site } from '../shared/sites.ts'

/** Generic purchase-like paths. Used only for sites without a checkout adapter, to force manual checkout. */
const CHECKOUT_LIKE = /(checkout|place[-_]?order|purchase|payment|pay|billing|order)/i

export type Verdict =
  | { allow: true }
  | { allow: false; reason: 'origin_not_allowed' | 'private_network' | 'scheme_not_allowed' | 'manual_checkout_required' }
  | { allow: 'transaction' }

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7))
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')
  }
  const [a = 0, b = 0] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

export async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return isPrivateAddress(host)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true
  try {
    const addresses = await lookup(host, { all: true })
    return addresses.some((a) => isPrivateAddress(a.address))
  } catch {
    return true // fail closed: unresolvable hosts are not navigable
  }
}

/** Lenient servers route /Checkout/Place-Order/;x=1 to /checkout/place-order, so the guard must too. */
export function normalisePath(pathname: string): string {
  let path = pathname.split(';')[0] ?? ''
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep the raw path; it still gets matched
  }
  return path.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')
}

export function createGuard(site: Site) {
  const allowed = new Set(siteOrigins(site))
  const submitPath = site.checkout ? new RegExp(site.checkout.submitPath, 'i') : null

  return async function check(rawUrl: string, method: string): Promise<Verdict> {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return { allow: false, reason: 'scheme_not_allowed' }
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return { allow: true } // inline content, no network egress
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { allow: false, reason: 'scheme_not_allowed' }
    if (!allowed.has(url.origin)) return { allow: false, reason: 'origin_not_allowed' }
    if (!site.allowPrivateNetwork && await resolvesToPrivate(url.hostname)) return { allow: false, reason: 'private_network' }
    const path = normalisePath(url.pathname)
    if (submitPath?.test(path)) {
      // The boundary lives on the site's own origin; the same path on an extra origin is never auto-approvable.
      return url.origin === site.origin ? { allow: 'transaction' } : { allow: false, reason: 'manual_checkout_required' }
    }
    // Backstop for every site, adapter or not: other purchase-like submissions need a human at the keyboard.
    if (method !== 'GET' && method !== 'HEAD' && CHECKOUT_LIKE.test(path)) return { allow: false, reason: 'manual_checkout_required' }
    return { allow: true }
  }
}
