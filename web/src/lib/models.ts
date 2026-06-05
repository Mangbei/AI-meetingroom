// Canonical domain type for the participating models. Server's adapter
// registry (server/src/browser/adapters/index.ts) is the upstream source of
// truth — keep this list in lockstep.
export type ModelName = 'claude' | 'chatgpt' | 'deepseek' | 'gemini'
export type DebateModelName = 'claude' | 'chatgpt' | 'deepseek'
export type MeetingModelName = 'chatgpt' | 'gemini' | 'deepseek'

// Single source of truth for per-model display metadata on the web side.
// Server-side model names live in server/src/browser/adapters/index.ts; that
// is the canonical set. The web's useDebateSocket.ts exports the matching
// type. If you add a model there, add it here.

export interface ModelMeta {
  /** Accent color (CSS variable name including var(...)). */
  tone: string
  /** Display name shown to readers (capitalized brand form). */
  display: string
  /** Subtitle / vendor tag (rendered in monospace small caps). */
  latin: string
}

export const MODEL_META: Record<ModelName, ModelMeta> = {
  claude:   { tone: 'var(--ochre)', display: 'Claude',   latin: 'Anthropic' },
  chatgpt:  { tone: 'var(--sage)',  display: 'ChatGPT',  latin: 'OpenAI'    },
  deepseek: { tone: 'var(--azure)', display: 'DeepSeek', latin: 'Hangzhou'  },
  gemini:   { tone: 'var(--violet)', display: 'Gemini',  latin: 'Google'    },
}

/** Short abbreviation for tight inline contexts (e.g., per-critique bullets). */
export const MODEL_ABBR: Record<ModelName, string> = {
  claude:   'CL',
  chatgpt:  'GP',
  deepseek: 'DS',
  gemini:   'GM',
}

/** Canonical model display order, matching server's MODELS order. */
export const MODELS: DebateModelName[] = ['claude', 'chatgpt', 'deepseek']
export const MEETING_MODELS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']
