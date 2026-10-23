/**
 * Site adapters describe how AgentVault logs in to a site and where its
 * purchase boundary is. They are reviewed config checked into `sites/`, never
 * something the agent can supply.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const selector = z.string().min(1).max(300)
const origin = z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin)

export const siteSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  origin,
  /** Extra origins the page may load (CDNs, auth domains). Navigation and sub-requests elsewhere are blocked. */
  extraOrigins: z.array(origin).default([]),
  /** Dev only: lets the mock shop live on a private Docker network. Real sites must leave this false. */
  allowPrivateNetwork: z.boolean().default(false),
  screenshots: z.boolean().default(false),
  login: z.object({
    url: z.url(),
    username: selector,
    password: selector,
    submit: selector,
    /** Login counts as successful once the URL path matches this pattern. */
    successPath: z.string().min(1),
  }),
  /**
   * Null means AgentVault cannot prove where this site's order submission is,
   * so any checkout-like submission is blocked and the user checks out manually.
   */
  checkout: z.object({
    pagePath: z.string().min(1),
    /** Requests matching this path pattern (any method) are the purchase boundary. */
    submitPath: z.string().min(1),
    summary: z.object({
      item: selector,
      name: selector,
      variant: selector,
      quantity: selector,
      unitPrice: selector,
      shipping: selector,
      total: selector,
      currency: selector,
      address: selector,
      paymentMethod: selector,
    }),
  }).nullable(),
})

export type Site = z.infer<typeof siteSchema>

export function loadSites(dir: string): Map<string, Site> {
  const sites = new Map<string, Site>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const site = siteSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    if (sites.has(site.id)) throw new Error(`Duplicate site id ${site.id}`)
    sites.set(site.id, site)
  }
  return sites
}

export const siteOrigins = (site: Site) => [site.origin, ...site.extraOrigins]

/** Order summary as read from the merchant's checkout page by the browser worker. */
/**
 * Bounded and free of control/format characters (bidi overrides, zero-width), so a page cannot pad
 * the native prompt or make it display something other than what is hashed. Out-of-bounds values
 * are rejected, not truncated, so the hash always covers exactly what the user saw.
 */
const field = z.string().max(120).refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v), 'contains control or format characters')
export const orderSummarySchema = z.object({
  merchant: field,
  items: z.array(z.object({ name: field, variant: field, quantity: field, unitPrice: field })).min(1).max(10),
  shipping: field,
  total: field,
  currency: field,
  address: z.string().max(200).refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v), 'contains control or format characters'),
  paymentMethod: field,
})
export type OrderSummary = z.infer<typeof orderSummarySchema>
