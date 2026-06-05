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
  displayName: string
  provider: string
  targetModel: string
  capabilities: {
    fileUpload: 'best-effort' | 'unsupported'
    loginCheck: 'best-effort' | 'manual'
    modelSelection: 'best-effort' | 'manual'
  }
  meetingRole: string
}

export const ADAPTER_REGISTRY: Record<ModelName, ModelEntry> = {
  chatgpt: {
    ctor: () => new ChatGPTAdapter(),
    defaultConfig: { targetModel: 'highest-thinking', manualConfirm: true },
    displayName: 'ChatGPT',
    provider: 'OpenAI',
    targetModel: 'Highest thinking / reasoning model',
    capabilities: { fileUpload: 'best-effort', loginCheck: 'best-effort', modelSelection: 'manual' },
    meetingRole: '结构化策略与写作方案负责人：负责把讨论落成清晰框架、优先级和可执行写作路径。',
  },
  deepseek: {
    ctor: () => new DeepSeekAdapter(),
    defaultConfig: { mode: 'fast', deepThink: false, smartSearch: false },
    displayName: 'DeepSeek',
    provider: 'DeepSeek',
    targetModel: 'R1 / deep thinking',
    capabilities: { fileUpload: 'best-effort', loginCheck: 'best-effort', modelSelection: 'best-effort' },
    meetingRole: '反方与推理审稿人：负责挑战薄弱假设、找逻辑漏洞、提出风险和替代解释。',
  },
  gemini: {
    ctor: () => new GeminiAdapter(),
    defaultConfig: { targetModel: 'gemini-pro', manualConfirm: true },
    displayName: 'Gemini',
    provider: 'Google',
    targetModel: 'Gemini Pro / highest Pro model',
    capabilities: { fileUpload: 'best-effort', loginCheck: 'best-effort', modelSelection: 'manual' },
    meetingRole: '资料综合与外部视角负责人：负责从材料中找证据、补充背景、发现跨领域连接。',
  },
}

export const MEETING_MODELS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']

export const DEFAULT_MEETING_MODEL_CONFIGS: MeetingModelConfigs = {
  chatgpt: ADAPTER_REGISTRY.chatgpt.defaultConfig as ChatGPTConfig,
  gemini: ADAPTER_REGISTRY.gemini.defaultConfig as GeminiConfig,
  deepseek: { mode: 'expert', deepThink: true, smartSearch: true },
}
