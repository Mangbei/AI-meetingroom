import { SiteAdapter, DeepSeekConfig, ClaudeConfig, ChatGPTConfig, GeminiConfig, ModelConfig } from './base.js'
import { ClaudeAdapter } from './claude.js'
import { ChatGPTAdapter } from './chatgpt.js'
import { DeepSeekAdapter } from './deepseek.js'
import { GeminiAdapter } from './gemini.js'

export type ModelConfigs = {
  claude: ClaudeConfig
  chatgpt: Record<string, never>
  deepseek: DeepSeekConfig
}

export type MeetingModelConfigs = {
  chatgpt: ChatGPTConfig
  gemini: GeminiConfig
  deepseek: DeepSeekConfig
}

export type ModelName = 'claude' | 'chatgpt' | 'deepseek' | 'gemini'
export type DebateModelName = keyof ModelConfigs
export type MeetingModelName = keyof MeetingModelConfigs

interface ModelEntry {
  ctor: () => SiteAdapter
  defaultConfig: ModelConfig
}

export const ADAPTER_REGISTRY: Record<ModelName, ModelEntry> = {
  claude:   { ctor: () => new ClaudeAdapter(),   defaultConfig: { model: 'sonnet-4-6' } },
  chatgpt:  { ctor: () => new ChatGPTAdapter(),  defaultConfig: { targetModel: 'highest-thinking', manualConfirm: true } },
  deepseek: { ctor: () => new DeepSeekAdapter(), defaultConfig: { mode: 'fast', deepThink: false, smartSearch: false } },
  gemini:   { ctor: () => new GeminiAdapter(),   defaultConfig: { targetModel: 'gemini-pro', manualConfirm: true } },
}

export const DEBATE_MODELS: DebateModelName[] = ['claude', 'chatgpt', 'deepseek']
export const MEETING_MODELS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']
export const MODELS = DEBATE_MODELS

export function makeAdapters(): Record<DebateModelName, SiteAdapter> {
  return Object.fromEntries(
    MODELS.map(name => [name, ADAPTER_REGISTRY[name].ctor()])
  ) as Record<DebateModelName, SiteAdapter>
}

export const DEFAULT_MODEL_CONFIGS: ModelConfigs = {
  claude: ADAPTER_REGISTRY.claude.defaultConfig as ClaudeConfig,
  chatgpt: {},
  deepseek: ADAPTER_REGISTRY.deepseek.defaultConfig as DeepSeekConfig,
}

export const DEFAULT_MEETING_MODEL_CONFIGS: MeetingModelConfigs = {
  chatgpt: ADAPTER_REGISTRY.chatgpt.defaultConfig as ChatGPTConfig,
  gemini: ADAPTER_REGISTRY.gemini.defaultConfig as GeminiConfig,
  deepseek: { mode: 'expert', deepThink: true, smartSearch: true },
}
