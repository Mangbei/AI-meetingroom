import { Page } from 'playwright'
import { GeminiConfig, RuntimeStatus, SiteAdapter, waitFor } from './base.js'

const SEL = {
  newChatButton: [
    'button[aria-label*="New chat"]',
    'button[aria-label*="新聊天"]',
    'a[href="/app"]',
    'button:has-text("New chat")',
    'button:has-text("新对话")',
  ].join(', '),
  inputBox: [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ].join(', '),
  sendButton: [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button.send-button',
    'button:has(mat-icon:has-text("send"))',
  ].join(', '),
  responseCandidates: [
    'message-content.model-response-text',
    '.model-response-text',
    'message-content',
    '[data-test-id*="response"]',
    '.markdown',
  ],
  accountButton: 'button[aria-label*="Google Account"], a[href*="accounts.google.com"]',
}

export class GeminiAdapter implements SiteAdapter {
  readonly name = 'gemini'
  private page!: Page
  private requestedModel = 'Gemini Pro'

  setPage(page: Page) {
    this.page = page
  }

  async focus(): Promise<void> {
    await this.page.bringToFront().catch(() => {})
  }

  async ensureReady(): Promise<void> {
    if (!this.page.url().startsWith('https://gemini.google.com')) {
      await this.page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' })
    }
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  }

  async configure(config: GeminiConfig): Promise<void> {
    this.requestedModel = config.targetModel === 'gemini-pro' ? 'Gemini Pro' : 'Gemini'
    await this.ensureReady()
    // Gemini's model picker changes often. Treat model selection as best-effort
    // and require the preflight confirmation UI to lock the user's intent.
  }

  async getRuntimeStatus(): Promise<RuntimeStatus> {
    await this.ensureReady().catch(() => {})
    const loggedIn = await this.page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      if (/Sign in|登录|登入/.test(text)) return false
      return !location.href.includes('accounts.google.com')
    }).catch(() => false)
    const detectedModel = await this.page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      const match = text.match(/Gemini\s+(?:2\.\d+\s+)?(?:Pro|Advanced|Flash)/i)
      return match?.[0] ?? ''
    }).catch(() => '')
    return {
      loggedIn,
      requestedModel: this.requestedModel,
      detectedModel: detectedModel || undefined,
      configured: false,
      needsManualConfirmation: true,
      warning: 'Gemini 网页模型选择无法稳定自动检测，请手动确认已选择 Pro/最高模型。',
    }
  }

  async newConversation(): Promise<void> {
    await this.ensureReady()
    const btn = this.page.locator(SEL.newChatButton).first()
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {})
      await waitFor(800)
    } else {
      await this.page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' })
      await waitFor(800)
    }
    await this.page.locator(SEL.inputBox).first().waitFor({ timeout: 15_000 }).catch(() => {})
  }

  async sendMessage(text: string): Promise<void> {
    const input = this.page.locator(SEL.inputBox).first()
    await input.waitFor({ timeout: 15_000 })
    await input.click()
    await this.page.keyboard.insertText(text)
    await waitFor(300)

    const sendBtn = this.page.locator(SEL.sendButton).first()
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click()
    } else {
      await this.page.keyboard.press('Enter')
    }
  }

  async hasAssistantMessage(): Promise<boolean> {
    return this.page.evaluate((selectors) =>
      selectors.some(sel => document.querySelectorAll(sel).length > 0),
      SEL.responseCandidates,
    ).catch(() => false)
  }

  async readLastAssistantMessage(): Promise<string> {
    return this.page.evaluate((selectors) => {
      for (const sel of selectors) {
        const nodes = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
        const visible = nodes.filter(n => (n.innerText ?? '').trim().length > 0)
        if (visible.length > 0) return visible[visible.length - 1].innerText.trim()
      }
      return ''
    }, SEL.responseCandidates).catch(() => '')
  }

  async streamResponse(onDelta: (chunk: string) => void): Promise<string> {
    const HARD_TIMEOUT = Date.now() + 6 * 60 * 1000
    const STABILITY_MS = 3000
    let lastText = ''
    let lastChangeAt = Date.now()

    while (Date.now() < HARD_TIMEOUT) {
      const current = await this.readLastAssistantMessage()
      if (current && current !== lastText) {
        const delta = current.slice(lastText.length)
        if (delta) onDelta(delta)
        lastText = current
        lastChangeAt = Date.now()
      }
      if (lastText && Date.now() - lastChangeAt >= STABILITY_MS) return lastText
      await waitFor(500)
    }
    return lastText
  }
}
