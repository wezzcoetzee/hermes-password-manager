import { randomBytes } from 'node:crypto'
import type { Browser, BrowserContext, Page, Route } from 'playwright'
import { sha256 } from '../shared/ids.ts'
import type { Logger } from '../shared/logger.ts'
import { orderSummarySchema, type OrderSummary, type Site } from '../shared/sites.ts'
import type { WorkerAction } from '../shared/worker-protocol.ts'
import { createGuard, type Verdict } from './guard.ts'
import { UNTRUSTED_NOTICE, injectionWarnings, scrub, truncate } from './sanitize.ts'
import { collectSnapshot } from './snapshot.ts'

export type ConsumeApproval = (sessionId: string, summaryHash: string) => Promise<{ allowed: boolean; reason: string }>

interface Blocked { url: string; reason: string }
interface TransactionEvent { status: 'submitted' | 'blocked'; reason: string }

export interface ActionResult {
  url: string
  title: string
  blocked?: Blocked[]
  transaction?: TransactionEvent
  snapshot?: unknown
  screenshot?: string
  orderSummary?: OrderSummary
  summaryHash?: string
}

/** Canonical hash of what the user is shown, so approval binds to the exact order. */
export const hashSummary = (summary: OrderSummary) => sha256(JSON.stringify(orderSummarySchema.parse(summary)))

export class BrowserSession {
  readonly id: string
  readonly site: Site
  private readonly context: BrowserContext
  private readonly page: Page
  private readonly refAttr = `data-av-${randomBytes(6).toString('hex')}`
  private readonly secrets = new Set<string>()
  private readonly guard: (url: string, method: string) => Promise<Verdict>
  private readonly pending = new Set<Promise<void>>()
  private blocked: Blocked[] = []
  private transaction: TransactionEvent | undefined
  /** Order summary read just before the current action; the page DOM is unreadable mid-navigation. */
  private summaryBeforeAction: OrderSummary | undefined
  private navigationBlocked = false
  private queue: Promise<unknown> = Promise.resolve()
  private expiryTimer: NodeJS.Timeout | undefined
  closed = false

  private constructor(id: string, site: Site, context: BrowserContext, page: Page) {
    this.id = id
    this.site = site
    this.context = context
    this.page = page
    this.guard = createGuard(site)
  }

  static async open(browser: Browser, id: string, site: Site, expiresAt: number, consume: ConsumeApproval, log: Logger, onExpire: () => void) {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block', // service workers would bypass request routing
      viewport: { width: 1280, height: 900 },
      locale: 'en-GB',
    })
    const page = await context.newPage()
    const session = new BrowserSession(id, site, context, page)
    await context.route('**/*', (route) => session.track(session.onRequest(route, consume, log)))
    await context.routeWebSocket(/.*/, async (ws) => {
      if ((await session.guard(ws.url().replace(/^ws/, 'http'), 'GET')).allow === true) ws.connectToServer()
      else ws.close()
    })
    context.on('page', (p) => { if (p !== page) void p.close() }) // single tab: no popups, no window.open escapes
    page.on('dialog', (d) => void d.dismiss())
    session.setExpiry(expiresAt, onExpire)
    return session
  }

  setExpiry(expiresAt: number, onExpire: () => void) {
    clearTimeout(this.expiryTimer)
    this.expiryTimer = setTimeout(onExpire, Math.max(0, expiresAt - Date.now()))
    this.expiryTimer.unref()
  }

  private track(work: Promise<void>) {
    this.pending.add(work)
    void work.finally(() => this.pending.delete(work))
    return work
  }

  private async onRequest(route: Route, consume: ConsumeApproval, log: Logger) {
    const request = route.request()
    const verdict = await this.guard(request.url(), request.method())
    if (verdict.allow === 'transaction') {
      const summary = this.summaryBeforeAction
      const decision = summary ? await consume(this.id, hashSummary(summary)) : { allowed: false, reason: 'order_summary_unreadable' }
      this.transaction = { status: decision.allowed ? 'submitted' : 'blocked', reason: decision.reason }
      log.info({ sessionId: this.id, allowed: decision.allowed, reason: decision.reason }, 'transaction boundary reached')
      return decision.allowed ? this.forward(route) : this.block(route)
    }
    if (verdict.allow === true) return this.forward(route)
    return this.reject(route, request.url(), verdict.reason)
  }

  private reject(route: Route, url: string, reason: Exclude<Verdict, { allow: true } | { allow: 'transaction' }>['reason']) {
    if (route.request().isNavigationRequest()) this.blocked.push({ url: new URL(url).origin, reason })
    if (reason === 'manual_checkout_required') this.transaction = { status: 'blocked', reason }
    return this.block(route)
  }

  /**
   * Playwright does not route redirect hops, so a request is fetched with redirects
   * disabled and each Location is checked by the guard before the browser may follow it.
   */
  private async forward(route: Route) {
    if (route.request().url().startsWith('data:')) return route.continue()
    const response = await route.fetch({ maxRedirects: 0 }).catch(() => undefined)
    if (!response) return route.abort('failed')
    const location = response.headers()['location']
    if (response.status() >= 300 && response.status() < 400 && location) {
      const target = new URL(location, route.request().url()).href
      const verdict = await this.guard(target, 'GET')
      if (verdict.allow !== true) return this.reject(route, target, verdict.allow === 'transaction' ? 'manual_checkout_required' : verdict.reason)
    }
    return route.fulfill({ response })
  }

  private block(route: Route) {
    if (route.request().isNavigationRequest() && route.request().frame() === this.page.mainFrame()) this.navigationBlocked = true
    return route.abort('blockedbyclient')
  }

  /** A blocked main-frame navigation lands on Chromium's error page; step back to where the agent was. */
  private async recoverFromBlockedNavigation() {
    if (!this.navigationBlocked) return
    this.navigationBlocked = false
    const onErrorPage = await this.page.waitForURL((u) => u.protocol === 'chrome-error:', { timeout: 2000 }).then(() => true, () => false)
    if (onErrorPage) await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
  }

  /** Serialise operations per session so concurrent tool calls cannot interleave on one page. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  async login(username: string, password: string): Promise<boolean> {
    const { login, origin } = this.site
    await this.page.goto(login.url, { waitUntil: 'domcontentloaded' })
    // Never type a credential into a page that is not the site's own origin.
    if (new URL(this.page.url()).origin !== origin) return false
    this.secrets.add(password)
    await this.page.fill(login.username, username)
    await this.page.fill(login.password, password)
    await this.page.click(login.submit)
    const success = new RegExp(login.successPath)
    try {
      await this.page.waitForURL((u) => u.origin === origin && success.test(u.pathname), { timeout: 15_000 })
      return true
    } catch {
      await this.page.fill(login.password, '').catch(() => undefined)
      return false
    }
  }

  private async locate(ref: string) {
    const locator = this.page.locator(`[${this.refAttr}="${ref}"]`)
    if (await locator.count() !== 1) throw new Error(`Unknown ref ${ref}; take a new browser_snapshot`)
    return locator
  }

  private onCheckoutPage(): boolean {
    const url = new URL(this.page.url())
    return Boolean(this.site.checkout) && url.origin === this.site.origin && new RegExp(this.site.checkout?.pagePath ?? '$^').test(url.pathname)
  }

  private async readOrderSummary(): Promise<OrderSummary> {
    const checkout = this.site.checkout
    if (!checkout) throw new Error('This site has no verified checkout adapter; checkout must be completed manually by the user.')
    if (!this.onCheckoutPage()) throw new Error('Not on the checkout page')
    const s = checkout.summary
    const text = (selector: string) => this.page.locator(selector).first().innerText({ timeout: 2000 }).then((t) => t.trim())
    const items = await this.page.locator(s.item).evaluateAll((nodes, sel) => nodes.map((n) => {
      const pick = (q: string) => n.querySelector(q)?.textContent?.trim() ?? ''
      return { name: pick(sel.name), variant: pick(sel.variant), quantity: pick(sel.quantity), unitPrice: pick(sel.unitPrice) }
    }), s)
    return orderSummarySchema.parse({
      merchant: this.site.name, items,
      shipping: await text(s.shipping), total: await text(s.total), currency: await text(s.currency),
      address: await text(s.address), paymentMethod: await text(s.paymentMethod),
    })
  }

  private async snapshot() {
    const raw = await this.page.evaluate(collectSnapshot, this.refAttr)
    const cookies = (await this.context.cookies()).map((c) => c.value)
    const secrets = [...this.secrets, ...cookies]
    const text = truncate(scrub(raw.text, secrets))
    const elements = raw.elements.map((e) => ({ ...e, name: scrub(e.name, secrets), ...(e.href ? { href: scrub(e.href, secrets) } : {}) }))
    return { untrusted: true, notice: UNTRUSTED_NOTICE, warnings: injectionWarnings(raw.text), title: scrub(raw.title, secrets), url: scrub(raw.url, secrets), text, elements }
  }

  async act(action: WorkerAction): Promise<ActionResult> {
    this.blocked = []
    this.transaction = undefined
    this.summaryBeforeAction = this.onCheckoutPage() ? await this.readOrderSummary().catch(() => undefined) : undefined
    const extra: Partial<ActionResult> = {}
    switch (action.type) {
      case 'navigate': await this.page.goto(action.url, { waitUntil: 'domcontentloaded' }).catch(this.ignoreAborted); break
      case 'click': await (await this.locate(action.ref)).click({ timeout: 5000 }); break
      case 'fill': await (await this.locate(action.ref)).fill(action.text, { timeout: 5000 }); break
      case 'select': await (await this.locate(action.ref)).selectOption({ label: action.option }, { timeout: 5000 }); break
      case 'scroll': await this.page.mouse.wheel(0, action.direction === 'down' ? action.amount : -action.amount); break
      case 'back': await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(this.ignoreAborted); break
      case 'wait':
        if (action.text) await this.page.getByText(action.text).first().waitFor({ timeout: action.timeoutMs })
        else await this.page.waitForLoadState('networkidle', { timeout: action.timeoutMs }).catch(() => undefined)
        break
      case 'snapshot': extra.snapshot = await this.snapshot(); break
      case 'screenshot':
        if (!this.site.screenshots) throw new Error('Screenshots are disabled for this site')
        extra.screenshot = (await this.page.screenshot({ mask: [this.page.locator('input, textarea, select')], animations: 'disabled' })).toString('base64')
        break
      case 'order_summary':
        extra.orderSummary = await this.readOrderSummary()
        extra.summaryHash = hashSummary(extra.orderSummary)
        break
    }
    await this.page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await Promise.all(this.pending)
    await this.recoverFromBlockedNavigation()
    return {
      url: scrub(this.page.url(), this.secrets), title: scrub(await this.page.title().catch(() => ''), this.secrets),
      ...(this.blocked.length ? { blocked: this.blocked } : {}),
      ...(this.transaction ? { transaction: this.transaction } : {}),
      ...extra,
    }
  }

  /** goto() rejects when the guard answers 204 or aborts; the blocked list already reports why. */
  private readonly ignoreAborted = (err: unknown) => {
    if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(String(err))) throw err
  }

  async close() {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.expiryTimer)
    this.secrets.clear()
    await this.context.close().catch(() => undefined)
  }
}
