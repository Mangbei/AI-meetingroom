import { Locator, Page } from 'playwright'
import { maybeBringToFront } from '../foreground.js'
import { SiteAdapter, PreflightResult, waitFor, streamUntilComplete } from './base.js'
import { htmlToMarkdown } from '../markdown.js'

/**
 * Declarative selector spec for a web-AI chat site. Most chat UIs follow the
 * same shape — a text input, a send/stop control, and a list of response
 * bubbles — so a single configurable adapter can drive them instead of a
 * near-identical class per site. Sites with genuine quirks (ChatGPT's
 * data-stream-active, DeepSeek's nested markdown + mode toggles, Gemini's
 * model picker) keep their own dedicated adapter classes.
 */
export interface SiteSpec {
  name: string
  homeUrl: string
  /** Extra URLs to try when homeUrl doesn't show a chat input (site moved). */
  fallbackUrls?: string[]
  urlPrefixes: string[]
  inputBox: string
  /** Response bubble candidates, in order of preference; outermost-last is read. */
  responseContainers: string[]
  newChatButton?: string
  sendButton?: string
  /** Visible only while generating — used as the "still streaming" signal. */
  stopButton?: string
  attachButton?: string
  fileInput?: string
  /** Rich (contenteditable) editors need keyboard insertion, not fill(). */
  inputMode?: 'fill' | 'type'
  /** Quiet window that counts as "done" when no explicit stop signal is seen. */
  stableMs?: number
}

// Last-resort input candidates appended after the site's own selectors: any
// visible editor-ish element. Chat UIs virtually always expose one of these.
const GENERIC_INPUT_FALLBACK = 'div[contenteditable="true"], [role="textbox"], textarea'

const LOGIN_WALL_SELECTOR = [
  'button:has-text("登录")', 'a:has-text("登录")', 'button:has-text("登 录")',
  'button:has-text("Log in")', 'button:has-text("Sign in")', 'a:has-text("Log in")',
].join(', ')

export class GenericWebChatAdapter implements SiteAdapter {
  readonly name: string
  private page!: Page

  constructor(private readonly spec: SiteSpec) {
    this.name = spec.name
  }

  setPage(page: Page) {
    this.page = page
  }

  async focus(): Promise<void> {
    await maybeBringToFront(this.page)
  }

  /**
   * Find the chat input across the main page AND child iframes (Playwright
   * locators don't pierce iframes, so a fixed main-frame selector misses
   * inputs rendered inside one). Tries the site's own selectors first, then a
   * generic editor fallback, polling until timeout so slow SPAs get a chance
   * to render.
   */
  private async findInput(timeoutMs = 12_000): Promise<Locator | null> {
    const selectors = [this.spec.inputBox, GENERIC_INPUT_FALLBACK]
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        for (const frame of this.page.frames()) {
          const loc = frame.locator(selector).first()
          if (await loc.isVisible().catch(() => false)) return loc
        }
      }
      await waitFor(500)
    }
    return null
  }

  /** Make sure a chat input is on screen, trying fallback URLs if the primary
   *  page doesn't show one (e.g. the site moved its chat path). */
  private async ensureInputPresent(): Promise<Locator | null> {
    let input = await this.findInput()
    if (input) return input
    for (const url of this.spec.fallbackUrls ?? []) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await waitFor(1200)
      input = await this.findInput(8_000)
      if (input) return input
    }
    return null
  }

  async ensureReady(): Promise<void> {
    if (!this.spec.urlPrefixes.some(p => this.page.url().startsWith(p))) {
      await this.page.goto(this.spec.homeUrl, { waitUntil: 'domcontentloaded' })
    }
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  }

  async newConversation(): Promise<void> {
    await this.ensureReady()
    if (this.spec.newChatButton) {
      const btn = this.page.locator(this.spec.newChatButton).first()
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {})
        await waitFor(800)
      } else {
        await this.page.goto(this.spec.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
        await waitFor(800)
      }
    } else {
      await this.page.goto(this.spec.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await waitFor(800)
    }
    await this.ensureInputPresent()
  }

  async uploadFiles(filePaths: string[]): Promise<boolean> {
    if (!filePaths.length) return true
    if (!this.spec.fileInput && !this.spec.attachButton) return false
    await this.ensureReady()

    const fileInputSel = this.spec.fileInput ?? 'input[type="file"]'
    if ((await this.page.locator(fileInputSel).count().catch(() => 0)) === 0 && this.spec.attachButton) {
      const attach = this.page.locator(this.spec.attachButton).first()
      if (await attach.isVisible().catch(() => false)) {
        await attach.click().catch(() => {})
        await waitFor(500)
      }
    }
    if ((await this.page.locator(fileInputSel).count().catch(() => 0)) === 0) return false
    try {
      await this.page.locator(fileInputSel).first().setInputFiles(filePaths)
    } catch {
      for (const filePath of filePaths) {
        if ((await this.page.locator(fileInputSel).count().catch(() => 0)) === 0) return false
        await this.page.locator(fileInputSel).first().setInputFiles(filePath)
        await waitFor(1000)
      }
    }
    await waitFor(5000)
    return true
  }

  async sendMessage(text: string): Promise<void> {
    const input = await this.findInput()
    if (!input) throw new Error(`${this.name}: 找不到输入框（当前页面 ${this.page.url()}）`)
    if (this.spec.inputMode === 'type') {
      await input.click()
      await this.page.keyboard.insertText(text)
    } else {
      // fill() works on both textarea and contenteditable; fall back to typing
      // when a custom editor rejects it.
      try {
        await input.fill(text)
      } catch {
        await input.click()
        await this.page.keyboard.insertText(text)
      }
    }
    await waitFor(300)

    if (this.spec.sendButton) {
      const sendBtn = this.page.locator(this.spec.sendButton).first()
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click()
        return
      }
    }
    await this.page.keyboard.press('Enter')
  }

  /**
   * Read the outermost response containers (some sites nest markdown inside
   * markdown) and return [count, lastOuterHTML]. Used both for counting new
   * messages and reading the latest reply.
   */
  private getState(): Promise<[number, string]> {
    return this.page.evaluate((selectors) => {
      for (const sel of selectors) {
        const all = document.querySelectorAll(sel)
        const outermost: Element[] = []
        for (let i = 0; i < all.length; i++) {
          let nested = false
          for (let j = 0; j < all.length; j++) {
            if (j !== i && all[j] !== all[i] && all[j].contains(all[i])) { nested = true; break }
          }
          if (!nested) outermost.push(all[i])
        }
        if (outermost.length > 0) {
          const last = outermost[outermost.length - 1] as HTMLElement
          return [outermost.length, last.outerHTML ?? ''] as [number, string]
        }
      }
      return [0, ''] as [number, string]
    }, this.spec.responseContainers).catch(() => [0, ''] as [number, string])
  }

  async hasAssistantMessage(): Promise<boolean> {
    return (await this.getState())[0] > 0
  }

  async readLastAssistantMessage(): Promise<string> {
    const [, html] = await this.getState()
    return htmlToMarkdown(html)
  }

  async preflight(): Promise<PreflightResult> {
    // newConversation already tried hard (incl. fallback URLs); a short
    // confirmation pass is enough here.
    const input = await this.findInput(4_000)
    if (input) return { ok: true, missing: [] }

    // Enrich the failure so the user can tell "not logged in / wrong page"
    // apart from "site redesigned, selectors stale".
    const url = this.page.url()
    const loginWall = await this.page.locator(LOGIN_WALL_SELECTOR).first().isVisible().catch(() => false)
    const hint = loginWall
      ? `页面上有登录按钮，疑似未登录。请在受控浏览器中登录 ${this.name} 后重试`
      : `当前页面 ${url}，未发现任何输入框。可运行 npm run inspect -w server -- ${this.name} 抓取页面结构`
    return { ok: false, missing: [`inputBox（${hint}）`] }
  }

  async streamResponse(onDelta: (chunk: string) => void): Promise<string> {
    const [baselineCount] = await this.getState()
    return streamUntilComplete({
      onDelta,
      stableMs: this.spec.stableMs ?? 9_000,
      hardTimeoutMs: 6 * 60 * 1000,
      newMessageAppeared: async () => (await this.getState())[0] > baselineCount,
      readText: () => this.readLastAssistantMessage(),
      isStreaming: this.spec.stopButton
        ? () => this.page.locator(this.spec.stopButton!).first().isVisible({ timeout: 400 }).catch(() => undefined)
        : undefined,
    })
  }
}
