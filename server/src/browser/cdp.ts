import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { SITE_CONNECT, ALL_MODELS, type SiteConnect, type MeetingModelName } from './adapters/sites.js'
import { maybeBringToFront } from './foreground.js'

// Site connection details now live in one place (adapters/sites.ts) so the CDP
// layer and the adapter registry can never drift apart on which models exist.
type SiteName = MeetingModelName

export class CDPSession {
  private browser!: Browser
  private context!: BrowserContext
  private pages: Map<SiteName, Page> = new Map()

  async connect(port: number): Promise<void> {
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const contexts = this.browser.contexts()
    this.context = contexts[0] ?? await this.browser.newContext()
  }

  async ensurePage(site: SiteName): Promise<Page> {
    const existing = this.pages.get(site)
    if (existing && !existing.isClosed()) return existing

    for (const page of this.context.pages()) {
      if (!page.isClosed() && SITE_CONNECT[site].urlPrefixes.some(prefix => page.url().startsWith(prefix))) {
        this.pages.set(site, page)
        return page
      }
    }

    const page = await this.context.newPage()
    try {
      await page.goto(SITE_CONNECT[site].url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    } catch (err) {
      // Don't leak a blank tab if the initial navigation times out.
      await page.close().catch(() => {})
      throw err
    }
    this.pages.set(site, page)
    return page
  }

  async openUrl(url: string): Promise<string> {
    const target = new URL(url)
    const prefix = `${target.protocol}//${target.host}`

    for (const page of this.context.pages()) {
      if (!page.isClosed() && page.url().startsWith(prefix)) {
        if (page.url() !== url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
        }
        await maybeBringToFront(page)
        return page.url()
      }
    }

    const page = await this.context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await maybeBringToFront(page)
    return page.url()
  }

  async openSites(sites: SiteName[]): Promise<Record<SiteName, string>> {
    const opened = {} as Record<SiteName, string>
    for (const site of sites) {
      const page = await this.ensurePage(site)
      await maybeBringToFront(page)
      opened[site] = page.url()
    }
    return opened
  }

  getContext(): BrowserContext {
    return this.context
  }

  async checkLoginStatus(site: SiteName): Promise<boolean> {
    try {
      const page = await this.ensurePage(site)
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {})

      const url = page.url()
      const conn: SiteConnect = SITE_CONNECT[site]
      const fragments = conn.loginUrlFragments
      if (fragments.length > 0 && fragments.some(f => url.includes(f))) return false

      const loggedOutSel = conn.loggedOutSelector
      if (loggedOutSel) {
        const loggedOutEl = await page.locator(loggedOutSel).first().isVisible({ timeout: 1500 }).catch(() => false)
        if (loggedOutEl) return false
      }

      return true
    } catch {
      return false
    }
  }

  async allLoggedIn(): Promise<Record<SiteName, boolean>> {
    const results = await Promise.all(ALL_MODELS.map(s => this.checkLoginStatus(s)))
    return Object.fromEntries(ALL_MODELS.map((s, i) => [s, results[i]])) as Record<SiteName, boolean>
  }

  async disconnect(): Promise<void> {
    await this.browser.close()
  }
}
