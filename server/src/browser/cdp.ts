import { chromium, Browser, BrowserContext, Page } from 'playwright'

type SiteName = 'chatgpt' | 'deepseek' | 'gemini'

const SITE_URLS: Record<SiteName, string> = {
  chatgpt: 'https://chatgpt.com',
  deepseek: 'https://chat.deepseek.com',
  gemini: 'https://gemini.google.com',
}

// Each site's login-page URL fragment (when NOT logged in)
const LOGIN_URL_FRAGMENTS: Record<SiteName, string[]> = {
  chatgpt: [],                         // ChatGPT stays at / even when logged out — use DOM check
  deepseek: ['/sign_in', '/signin'],
  gemini: ['accounts.google.com'],
}

// DOM selector that is present ONLY when logged out
const LOGGED_OUT_SELECTOR: Partial<Record<SiteName, string>> = {
  chatgpt: 'button[data-testid="login-button"]',
  gemini: 'a[href*="accounts.google.com"], button:has-text("Sign in"), button:has-text("登录")',
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

    // reuse an existing tab already on that domain
    for (const page of this.context.pages()) {
      if (page.url().startsWith(SITE_URLS[site])) {
        this.pages.set(site, page)
        return page
      }
    }

    const page = await this.context.newPage()
    await page.goto(SITE_URLS[site], { waitUntil: 'domcontentloaded' })
    this.pages.set(site, page)
    return page
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
      await page.waitForLoadState('domcontentloaded').catch(() => {})

      const url = page.url()

      // URL-based check
      const fragments = LOGIN_URL_FRAGMENTS[site]
      if (fragments.length > 0 && fragments.some(f => url.includes(f))) return false

      // DOM-based check
      const loggedOutSel = LOGGED_OUT_SELECTOR[site]
      if (loggedOutSel) {
        const loggedOutEl = await page.$(loggedOutSel)
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
