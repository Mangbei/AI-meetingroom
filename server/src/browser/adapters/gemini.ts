import { Page } from 'playwright'
import { maybeBringToFront } from '../foreground.js'
import { GeminiConfig, PreflightResult, RuntimeStatus, SiteAdapter, waitFor, streamUntilComplete } from './base.js'

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
  attachButton: [
    'button[aria-label*="Upload"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Add files"]',
    'button:has(mat-icon:has-text("add"))',
    'button:has(mat-icon:has-text("attach_file"))',
  ].join(', '),
  fileInput: 'input[type="file"]',
  responseCandidates: [
    'message-content.model-response-text',
    '.model-response-text',
    'message-content',
    '[data-test-id*="response"]',
    '.markdown',
  ],
  // While generating, Gemini shows a Stop button in place of Send. Best-effort
  // signal; if it misses, the shared stream loop falls back to stability.
  stopButton: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    'button:has(mat-icon:has-text("stop"))',
  ].join(', '),
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
    await maybeBringToFront(this.page)
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

  async uploadFiles(filePaths: string[]): Promise<boolean> {
    if (!filePaths.length) return true
    await this.ensureReady()

    let input = this.page.locator(SEL.fileInput).first()
    if ((await this.page.locator(SEL.fileInput).count().catch(() => 0)) === 0) {
      const attach = this.page.locator(SEL.attachButton).first()
      if (await attach.isVisible().catch(() => false)) {
        await attach.click().catch(() => {})
        await waitFor(500)
      }
      input = this.page.locator(SEL.fileInput).first()
    }

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

  private countResponses(): Promise<number> {
    return this.page.evaluate((selectors) => {
      for (const sel of selectors) {
        const n = document.querySelectorAll(sel).length
        if (n > 0) return n
      }
      return 0
    }, SEL.responseCandidates).catch(() => 0)
  }

  async preflight(): Promise<PreflightResult> {
    const missing: string[] = []
    if (!(await this.page.locator(SEL.inputBox).first().count().catch(() => 0))) missing.push('inputBox')
    return { ok: missing.length === 0, missing }
  }

  async streamResponse(onDelta: (chunk: string) => void): Promise<string> {
    // Gemini exposes no reliable streaming attribute, so the stability window is
    // the primary detector and is kept deliberately generous (12s) to avoid
    // cutting off during a mid-reply thinking pause. The Stop button, when
    // present, lets a reply finish promptly via the explicit-signal fast path.
    const baselineCount = await this.countResponses()
    return streamUntilComplete({
      onDelta,
      hardTimeoutMs: 6 * 60 * 1000,
      stableMs: 12_000,
      newMessageAppeared: async () => (await this.countResponses()) > baselineCount,
      readText: () => this.readLastAssistantMessage(),
      isStreaming: () => this.page.locator(SEL.stopButton).first().isVisible({ timeout: 400 }).catch(() => undefined),
    })
  }
}
