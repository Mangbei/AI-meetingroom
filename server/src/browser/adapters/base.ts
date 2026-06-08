import { Page } from 'playwright'

export interface DeepSeekConfig {
  mode: 'fast' | 'expert'   // 快速(V3) vs 专家(R1)
  deepThink: boolean         // 深度思考
  smartSearch: boolean       // 智能搜索
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

export type ModelConfig = DeepSeekConfig | GeminiConfig | ChatGPTConfig | Record<string, never>

export interface SiteAdapter {
  readonly name: string
  setPage(page: Page): void
  focus?(): Promise<void>
  ensureReady(): Promise<void>
  newConversation(): Promise<void>
  uploadFiles?(filePaths: string[]): Promise<boolean>
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
  /**
   * Self-check that the DOM selectors this adapter depends on still exist on a
   * ready conversation page. Run before a meeting so a site redesign surfaces
   * as a clear, upfront "selectors missing" skip instead of a mysterious
   * mid-meeting failure. `ok: false` means a critical element is gone.
   */
  preflight?(): Promise<PreflightResult>
}

export interface PreflightResult {
  ok: boolean
  missing: string[]
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

/**
 * Reject if `p` does not settle within `ms`. Use to put a hard ceiling on any
 * single page interaction so one stuck action can't hang a whole meeting.
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

/**
 * Retry a flaky page interaction with linear backoff. Intended for actions
 * whose common failure mode is transient (selector not yet rendered, slow
 * network) rather than a state mutation that must not be repeated.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseDelay = opts.delayMs ?? 800
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i)
    } catch (err) {
      lastErr = err
      if (opts.label) console.warn(`[retry] ${opts.label} attempt ${i + 1}/${attempts} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (i < attempts - 1) await waitFor(baseDelay * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * How a streaming response is observed on a given site. The adapter supplies
 * the site-specific DOM knowledge; the shared loop owns the timing/lifecycle.
 */
export interface StreamSpec {
  /** Read the current full text of the latest assistant message (markdown). */
  readText: () => Promise<string>
  /** True once a NEW assistant message has appeared beyond the pre-send baseline. */
  newMessageAppeared: () => Promise<boolean>
  /** Emit incremental text as it streams in. */
  onDelta: (chunk: string) => void
  /**
   * Optional explicit "model is still generating" signal (e.g. a streaming
   * attribute or a visible Stop button). When present and reliable it lets a
   * reply finish promptly; when absent the loop falls back to stability.
   */
  isStreaming?: () => Promise<boolean | undefined>
  appearTimeoutMs?: number
  hardTimeoutMs?: number
  /** Quiet window (no text change) that counts as "done" when no explicit signal. */
  stableMs?: number
  /** Grace after an explicit "done" signal, to capture trailing text. */
  graceMs?: number
  pollMs?: number
}

/**
 * Unified streaming loop shared by every adapter. Completion is decided by
 * whichever fires first:
 *   1. an explicit `isStreaming() === false` — but ONLY after streaming was
 *      actually observed once (`sawStreaming`), so a flaky/wrong signal
 *      selector degrades safely to stability detection instead of cutting the
 *      reply off the instant it starts; or
 *   2. the text has not changed for `stableMs` (deliberately generous so a
 *      mid-reply thinking pause is not mistaken for the end).
 */
export async function streamUntilComplete(spec: StreamSpec): Promise<string> {
  const appearTimeout = spec.appearTimeoutMs ?? 30_000
  const hardDeadline = Date.now() + (spec.hardTimeoutMs ?? 6 * 60 * 1000)
  const stableMs = spec.stableMs ?? 8_000
  const graceMs = spec.graceMs ?? 1_200
  const pollMs = spec.pollMs ?? 350

  // Phase 1: wait for a new assistant message to appear.
  const appearDeadline = Date.now() + appearTimeout
  while (Date.now() < appearDeadline) {
    if (await spec.newMessageAppeared().catch(() => false)) break
    await waitFor(pollMs)
  }

  // Phase 2: stream content until complete.
  let lastText = ''
  let lastChangeAt = Date.now()
  let sawStreaming = false

  while (Date.now() < hardDeadline) {
    const current = await spec.readText().catch(() => lastText)
    if (current && current !== lastText) {
      const delta = current.slice(lastText.length)
      if (delta) spec.onDelta(delta)
      lastText = current
      lastChangeAt = Date.now()
    }

    if (spec.isStreaming) {
      const streaming = await spec.isStreaming().catch(() => undefined)
      if (streaming === true) sawStreaming = true
      if (streaming === false && sawStreaming) {
        await waitFor(graceMs)
        const final = await spec.readText().catch(() => lastText)
        if (final && final.length > lastText.length) spec.onDelta(final.slice(lastText.length))
        return final || lastText
      }
    }

    if (lastText.length > 0 && Date.now() - lastChangeAt >= stableMs) {
      return lastText
    }

    await waitFor(pollMs)
  }

  return lastText
}
