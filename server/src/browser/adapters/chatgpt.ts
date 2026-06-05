import { Page } from 'playwright'
import { SiteAdapter, waitFor } from './base.js'
import { htmlToMarkdown } from '../markdown.js'

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
    await this.page.bringToFront().catch(() => {})
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

  async hasAssistantMessage(): Promise<boolean> {
    return this.page.evaluate(() =>
      document.querySelectorAll('[data-message-author-role="assistant"]').length > 0
    ).catch(() => false)
  }

  async readLastAssistantMessage(): Promise<string> {
    const html = await this.page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
      const last = msgs[msgs.length - 1]
      if (!last) return ''
      const md = last.querySelector('.markdown, .prose')
      return ((md ?? last) as HTMLElement).outerHTML ?? ''
    })
    return htmlToMarkdown(html)
  }

  async streamResponse(onDelta: (chunk: string) => void): Promise<string> {
    const HARD_TIMEOUT = Date.now() + 5 * 60 * 1000

    const countMsgs = (): Promise<number> =>
      this.page.evaluate(() =>
        document.querySelectorAll('[data-message-author-role="assistant"]').length
      )

    const getHtml = (): Promise<string> =>
      this.page.evaluate(() => {
        const msgs = document.querySelectorAll('[data-message-author-role="assistant"]')
        const last = msgs[msgs.length - 1]
        if (!last) return ''
        const md = last.querySelector('.markdown, .prose')
        return ((md ?? last) as HTMLElement).outerHTML ?? ''
      })

    const getText = async (): Promise<string> => htmlToMarkdown(await getHtml())

    const isStreaming = (): Promise<boolean> =>
      this.page.evaluate(() => !!document.querySelector('[data-stream-active]'))

    // Baseline: messages already present before this send (same-session continuity)
    const baselineCount = await countMsgs()

    // Phase 1: wait for a NEW assistant message beyond the baseline
    const deadline1 = Date.now() + 30_000
    while (Date.now() < deadline1) {
      if (await countMsgs() > baselineCount) break
      await waitFor(300)
    }

    // Phase 2: stream content until data-stream-active disappears
    let lastText = ''
    let lastChangeAt = Date.now()

    while (Date.now() < HARD_TIMEOUT) {
      const current = await getText()
      if (current !== lastText) {
        const delta = current.slice(lastText.length)
        if (delta) onDelta(delta)
        lastText = current
        lastChangeAt = Date.now()
      }

      const streaming = await isStreaming()

      if (!streaming) {
        // Double-check: give 1s for any trailing content
        await waitFor(1000)
        const final = await getText()
        if (final !== lastText) onDelta(final.slice(lastText.length))
        return final || lastText
      }

      await waitFor(300)
    }

    return lastText
  }
}
