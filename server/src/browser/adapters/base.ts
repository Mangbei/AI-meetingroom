import { Page } from 'playwright'

export interface DeepSeekConfig {
  mode: 'fast' | 'expert'   // 快速(V3) vs 专家(R1)
  deepThink: boolean         // 深度思考
  smartSearch: boolean       // 智能搜索
}

export interface ClaudeConfig {
  model: 'sonnet-4-6' | 'opus-4-7'
}

export interface GeminiConfig {
  targetModel: 'gemini-pro'
  manualConfirm: boolean
}

export interface ChatGPTConfig {
  targetModel: 'highest-thinking'
  manualConfirm: boolean
}

export interface RuntimeStatus {
  loggedIn: boolean
  requestedModel?: string
  detectedModel?: string
  configured: boolean
  needsManualConfirmation: boolean
  warning?: string
}

export type ModelConfig = DeepSeekConfig | ClaudeConfig | GeminiConfig | ChatGPTConfig | Record<string, never>

export interface SiteAdapter {
  readonly name: string
  setPage(page: Page): void
  ensureReady(): Promise<void>
  newConversation(): Promise<void>
  sendMessage(text: string): Promise<void>
  streamResponse(onDelta: (chunk: string) => void): Promise<string>
  /**
   * Read the most-recent assistant message currently rendered on the page,
   * without sending anything. Used by the refetch endpoint to recover from
   * cases where streamResponse captured an error placeholder (e.g., a rate-
   * limit notice) but the model later filled in a real reply that we missed.
   */
  readLastAssistantMessage(): Promise<string>
  /**
   * Returns true when at least one assistant message has rendered on the
   * current conversation page. Used after a reload to poll for content to
   * appear before reading. Keeps DOM-selector knowledge per-site here in
   * the adapter rather than leaking into the HTTP route.
   */
  hasAssistantMessage(): Promise<boolean>
  configure?(config: ModelConfig): Promise<void>
  getRuntimeStatus?(): Promise<RuntimeStatus>
}

export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.focus(selector)
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 50) + 20 })
  }
}

export async function waitFor(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
