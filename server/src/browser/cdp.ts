import { chromium, Browser, BrowserContext, Page } from 'playwright'

type SiteName = 'chatgpt' | 'deepseek' | 'gemini'

const SITE_URLS: Record<SiteName, string> = {
  chatgpt: 'https://chatgpt.com',
  deepseek: 'https://chat.deepseek.com',
  gemini: 'https://gemini.google.com',
}

const SITE_URL_PREFIXES: Record<SiteName, string[]> = {
  chatgpt: ['https://chatgpt.com', 'https://chat.openai.com'],
  deepseek: ['https://chat.deepseek.com'],
  gemini: ['https://gemini.google.com'],
}

const LOGIN_URL_FRAGMENTS: Record<SiteName, string[]> = {
  chatgpt: [],
  deepseek: ['/sign_in', '/signin'],
  gemini: ['accounts.google.com'],
}

const LOGGED_OUT_SELECTOR: Partial<Record<SiteName, string>> = {
  chatgpt: [
    'button[data-testid="login-button"]',
    'a[href*="/auth/login"]',
    'button:has-text("Log in")',
    'a:has-text("Log in")',
    'button:has-text("登录")',
    'a:has-text("登录")',
  ].join(', '),
  gemini: [
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    'button:has-text("登录")',
    'a:has-text("登录")',
  ].join(', '),
}

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
      if (!page.isClosed() && SITE_URL_PREFIXES[site].some(prefix => page.url().startsWith(prefix))) {
        this.pages.set(site, page)
        return page
      }
    }

    const page = await this.context.newPage()
    await page.goto(SITE_URLS[site], { waitUntil: 'domcontentloaded', timeout: 20_000 })
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
        await page.bringToFront().catch(() => {})
        return page.url()
      }
    }

    const page = await this.context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.bringToFront().catch(() => {})
    return page.url()
  }

  async openSites(sites: SiteName[]): Promise<Record<SiteName, string>> {
    const opened = {} as Record<SiteName, string>
    for (const site of sites) {
      const page = await this.ensurePage(site)
      await page.bringToFront().catch(() => {})
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
      const fragments = LOGIN_URL_FRAGMENTS[site]
      if (fragments.length > 0 && fragments.some(f => url.includes(f))) return false

      const loggedOutSel = LOGGED_OUT_SELECTOR[site]
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
    const sites: SiteName[] = ['chatgpt', 'gemini', 'deepseek']
    const results = await Promise.all(sites.map(s => this.checkLoginStatus(s)))
    return Object.fromEntries(sites.map((s, i) => [s, results[i]])) as Record<SiteName, boolean>
  }

  async disconnect(): Promise<void> {
    await this.browser.close()
  }
}
