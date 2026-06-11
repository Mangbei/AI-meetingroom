import { Page } from 'playwright'
import { SiteAdapter, PreflightResult, waitFor, streamUntilComplete } from './base.js'
import { htmlToMarkdown } from '../markdown.js'
import { maybeBringToFront } from '../foreground.js'

// All ChatGPT selectors — update here if UI changes
const SEL = {
  newChatButton: '[data-testid="create-new-chat-button"]',
  inputBox: '#prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  attachButton: [
    '[data-testid="file-upload-button"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Upload"]',
    'button[aria-label*="Add"]',
  ].join(', '),
  fileInput: 'input[type="file"]',
  // During streaming, ChatGPT adds data-stream-active to a root element
  streamingIndicator: '[data-stream-active]',
  assistantMessage: '[data-message-author-role="assistant"]',
  responseContent: '[data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"] .prose',
}

export class ChatGPTAdapter implements SiteAdapter {
  readonly name = 'chatgpt'
  private page!: Page

  setPage(page: Page) {
    this.page = page
  }

  async focus(): Promise<void> {
    await maybeBringToFront(this.page)
  }

  async ensureReady(): Promise<void> {
    const url = this.page.url()
    if (!url.startsWith('https://chatgpt.com') && !url.startsWith('https://chat.openai.com')) {
      await this.page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' })
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
      await this.page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' })
      await waitFor(800)
    }
    await this.page.locator(SEL.inputBox).waitFor({ timeout: 10_000 }).catch(() => {})
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
    await input.waitFor({ timeout: 10_000 })
    await input.fill(text)
    await waitFor(300)
    const sendBtn = this.page.locator(SEL.sendButton).first()
    await sendBtn.waitFor({ timeout: 5000 })
    await sendBtn.click()
  }

  private countMsgs(): Promise<number> {
    return this.page.evaluate(() =>
      document.querySelectorAll('[data-message-author-role="assistant"]').length
    ).catch(() => 0)
  }

  async hasAssistantMessage(): Promise<boolean> {
    return (await this.countMsgs()) > 0
  }

  async readLastAssistantMessage(): Promise<string> {
    const html = await this.page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
      const last = msgs[msgs.length - 1]
      if (!last) return ''
      const md = last.querySelector('.markdown, .prose')
      return ((md ?? last) as HTMLElement).outerHTML ?? ''
    }).catch(() => '')
    return htmlToMarkdown(html)
  }

  async preflight(): Promise<PreflightResult> {
    const missing: string[] = []
    if (!(await this.page.locator(SEL.inputBox).first().count().catch(() => 0))) missing.push('inputBox')
    return { ok: missing.length === 0, missing }
  }

  async streamResponse(onDelta: (chunk: string) => void): Promise<string> {
    // Baseline: messages already present before this send (same-session continuity).
    const baselineCount = await this.countMsgs()
    return streamUntilComplete({
      onDelta,
      hardTimeoutMs: 5 * 60 * 1000,
      newMessageAppeared: async () => (await this.countMsgs()) > baselineCount,
      readText: () => this.readLastAssistantMessage(),
      // ChatGPT marks an element with data-stream-active while generating.
      isStreaming: () =>
        this.page.evaluate(() => !!document.querySelector('[data-stream-active]')).catch(() => undefined),
    })
  }
}
