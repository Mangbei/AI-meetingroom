import { Page } from 'playwright'
import { SiteAdapter, PreflightResult, DeepSeekConfig, ModelConfig, waitFor, streamUntilComplete } from './base.js'
import { htmlToMarkdown } from '../markdown.js'

// All DeepSeek selectors — update here if UI changes
// Verified against live chat.deepseek.com DOM on 2026-05-12
const SEL = {
  fileInput: 'input[type="file"]',
  newChatButton: 'button:has-text("New Chat"), [class*="newChat"], a:has-text("新对话"), button:has-text("新建对话")',
  // DeepSeek uses a <textarea> for input
  inputBox: 'textarea#chat-input, textarea[class*="chat"], textarea[class*="input"], textarea[placeholder]',
  sendButton: 'button[aria-label="send"], [class*="sendButton"]:not([class*="cancel"]), button[class*="send"]:not([class*="cancel"])',
  // While generating, the send control swaps to a stop/cancel button. Best-effort
  // signal: presence means "still streaming". If the selector misses, the shared
  // stream loop safely falls back to content-stability detection.
  stopButton: 'div[role="button"][aria-label*="停止"], button[aria-label*="Stop"], [class*="cancel"][role="button"], [class*="stop-icon"]',
  // 快速模式/专家模式 radios live in a [role="radiogroup"]; each radio carries
  // data-model-type="default" (fast) or "expert", with aria-checked reflecting state.
  modeRadioFast: 'div[role="radio"][data-model-type="default"]',
  modeRadioExpert: 'div[role="radio"][data-model-type="expert"]',
  // Feature toggle buttons in the toolbar below the input box
  // State: aria-pressed="true" or class ds-toggle-button--selected = currently active
  deepThinkBtn: 'div.ds-toggle-button[role="button"]:has-text("深度思考")',
  smartSearchBtn: 'div.ds-toggle-button[role="button"]:has-text("智能搜索")',
  // Response container selectors (in order of preference)
  responseContainerSelectors: [
    '[class*="ds-markdown"]',
    '[class*="markdown"]',
    '[class*="message-content"]:not([class*="user"])',
    '[class*="ai-message"]',
    '[class*="assistant"]',
  ],
}

export class DeepSeekAdapter implements SiteAdapter {
  readonly name = 'deepseek'
  private page!: Page

  setPage(page: Page) {
    this.page = page
  }

  async focus(): Promise<void> {
    await this.page.bringToFront().catch(() => {})
  }

  // Set a toggle to a specific state (true = on/active, false = off/inactive)
  private async setToggle(selector: string, label: string, desiredOn: boolean): Promise<void> {
    try {
      const btn = this.page.locator(selector).first()
      await btn.waitFor({ timeout: 3000 })
      const pressed = await btn.getAttribute('aria-pressed').catch(() => null)
      const cls = await btn.getAttribute('class').catch(() => '')
      const currentlyOn = pressed === 'true' || (cls ?? '').includes('ds-toggle-button--selected')
      if (currentlyOn !== desiredOn) {
        await btn.click()
        await waitFor(400)
        console.log(`[deepseek] ${desiredOn ? 'enabled' : 'disabled'}: ${label}`)
      } else {
        console.log(`[deepseek] ${label} already ${desiredOn ? 'on' : 'off'}, no change`)
      }
    } catch {
      console.warn(`[deepseek] configure: cannot find toggle "${label}" — skipping`)
    }
  }

  // Click the radio matching `mode` if it isn't already selected.
  private async setModeRadio(mode: 'fast' | 'expert'): Promise<void> {
    const sel = mode === 'expert' ? SEL.modeRadioExpert : SEL.modeRadioFast
    const label = mode === 'expert' ? '专家模式' : '快速模式'
    try {
      const radio = this.page.locator(sel).first()
      await radio.waitFor({ timeout: 5000 })
      const checked = await radio.getAttribute('aria-checked').catch(() => null)
      if (checked !== 'true') {
        await radio.click()
        await waitFor(500)
        console.log(`[deepseek] selected mode: ${label}`)
      } else {
        console.log(`[deepseek] mode already ${label}, no change`)
      }
    } catch {
      console.warn(`[deepseek] configure: cannot find mode radio "${label}" — skipping`)
    }
  }

  async configure(config: ModelConfig): Promise<void> {
    const cfg = config as DeepSeekConfig
    await waitFor(600)  // let input toolbar settle after newConversation

    // 快速模式/专家模式 is now a dedicated radiogroup, distinct from 深度思考.
    await this.setModeRadio(cfg.mode)

    // 深度思考 / 智能搜索 are independent toggles that may or may not be
    // visible depending on mode; treat missing as best-effort.
    await this.setToggle(SEL.deepThinkBtn, '深度思考', cfg.deepThink)
    await this.setToggle(SEL.smartSearchBtn, '智能搜索', cfg.smartSearch)
  }

  async ensureReady(): Promise<void> {
    if (!this.page.url().startsWith('https://chat.deepseek.com')) {
      await this.page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded' })
    }
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  }

  async newConversation(): Promise<void> {
    await this.ensureReady()
    try {
      const btn = this.page.locator(SEL.newChatButton).first()
      await btn.waitFor({ timeout: 5000 })
      await btn.click()
      await waitFor(800)
    } catch {
      await this.page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded' })
      await waitFor(800)
    }
    await this.page.locator(SEL.inputBox).waitFor({ timeout: 10_000 }).catch(() => {})
  }

  async uploadFiles(filePaths: string[]): Promise<boolean> {
    if (!filePaths.length) return true
    await this.ensureReady()

    let input = this.page.locator(SEL.fileInput).first()
    if ((await this.page.locator(SEL.fileInput).count().catch(() => 0)) === 0) return false
    try {
      await input.setInputFiles(filePaths)
    } catch {
      for (const filePath of filePaths) {
        input = this.page.locator(SEL.fileInput).first()
        if ((await this.page.locator(SEL.fileInput).count().catch(() => 0)) === 0) return false
        await input.setInputFiles(filePath)
        await waitFor(1000)
      }
    }
    await waitFor(5000)
    return true
  }

  async sendMessage(text: string): Promise<void> {
    const input = this.page.locator(SEL.inputBox).first()
    await input.waitFor({ timeout: 10_000 })
    await input.fill(text)
    await waitFor(400)

    // Try send button first, fallback to Enter
    const sendBtn = this.page.locator(SEL.sendButton).first()
    const btnVisible = await sendBtn.isVisible().catch(() => false)
    if (btnVisible) {
      await sendBtn.click()
    } else {
      await this.page.keyboard.press('Enter')
    }
  }

  async hasAssistantMessage(): Promise<boolean> {
    return this.page.evaluate(
      selectors => selectors.some(s => document.querySelectorAll(s).length > 0),
      SEL.responseContainerSelectors,
    ).catch(() => false)
  }

  // Returns [count-of-outermost, outerHTML-of-last-outermost].
  // DeepSeek nests ds-markdown inside ds-markdown; we only want top-level
  // containers. HTML (not innerText) so turndown can preserve heading/list/
  // table structure into the final markdown.
  private getState(): Promise<[number, string]> {
    return this.page.evaluate((selectors) => {
      for (const sel of selectors) {
        const all = document.querySelectorAll(sel)
        const outermost: Element[] = []
        for (let i = 0; i < all.length; i++) {
          let nested = false
          for (let j = 0; j < all.length; j++) {
            if (j !== i && all[j] !== all[i] && all[j].contains(all[i])) {
              nested = true
              break
            }
          }
          if (!nested) outermost.push(all[i])
        }
        if (outermost.length > 0) {
          const last = outermost[outermost.length - 1] as HTMLElement
          return [outermost.length, last.outerHTML ?? ''] as [number, string]
        }
      }
      return [0, ''] as [number, string]
    }, SEL.responseContainerSelectors).catch(() => [0, ''] as [number, string])
  }

  async readLastAssistantMessage(): Promise<string> {
    const [, html] = await this.getState()
    return htmlToMarkdown(html)
  }

  async preflight(): Promise<PreflightResult> {
    const missing: string[] = []
    if (!(await this.page.locator(SEL.inputBox).first().count().catch(() => 0))) missing.push('inputBox')
    return { ok: missing.length === 0, missing }
  }

  async streamResponse(onDelta: (chunk: string) => void): Promise<string> {
    // Baseline: top-level response containers already on screen (same-session continuity).
    const [baselineCount] = await this.getState()
    return streamUntilComplete({
      onDelta,
      hardTimeoutMs: 5 * 60 * 1000,
      newMessageAppeared: async () => (await this.getState())[0] > baselineCount,
      readText: () => this.readLastAssistantMessage(),
      // Best-effort: a stop button is visible only while generating.
      isStreaming: () => this.page.locator(SEL.stopButton).first().isVisible({ timeout: 400 }).catch(() => undefined),
    })
  }
}
