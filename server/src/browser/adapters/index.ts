import { SiteAdapter, DeepSeekConfig, ChatGPTConfig, GeminiConfig, ModelConfig } from './base.js'
import { ChatGPTAdapter } from './chatgpt.js'
import { DeepSeekAdapter } from './deepseek.js'
import { GeminiAdapter } from './gemini.js'

export type MeetingModelConfigs = {
  chatgpt: ChatGPTConfig
  gemini: GeminiConfig
  deepseek: DeepSeekConfig
}

export type ModelName = keyof MeetingModelConfigs
export type MeetingModelName = ModelName

interface ModelEntry {
  ctor: () => SiteAdapter
  defaultConfig: ModelConfig
}

export const ADAPTER_REGISTRY: Record<ModelName, ModelEntry> = {
  chatgpt:  { ctor: () => new ChatGPTAdapter(),  defaultConfig: { targetModel: 'highest-thinking', manualConfirm: true } },
  deepseek: { ctor: () => new DeepSeekAdapter(), defaultConfig: { mode: 'fast', deepThink: false, smartSearch: false } },
  gemini:   { ctor: () => new GeminiAdapter(),   defaultConfig: { targetModel: 'gemini-pro', manualConfirm: true } },
}

export const MEETING_MODELS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']

export const DEFAULT_MEETING_MODEL_CONFIGS: MeetingModelConfigs = {
  chatgpt: ADAPTER_REGISTRY.chatgpt.defaultConfig as ChatGPTConfig,
  gemini: ADAPTER_REGISTRY.gemini.defaultConfig as GeminiConfig,
  deepseek: { mode: 'expert', deepThink: true, smartSearch: true },
}
