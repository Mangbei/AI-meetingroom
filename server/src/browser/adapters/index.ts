import { SiteAdapter, DeepSeekConfig, ModelConfig } from './base.js'
import { ChatGPTAdapter } from './chatgpt.js'
import { DeepSeekAdapter } from './deepseek.js'
import { GeminiAdapter } from './gemini.js'
import { GenericWebChatAdapter } from './generic.js'
import { CLAUDE_SPEC, DOUBAO_SPEC, ZHIPU_SPEC, QWEN_SPEC, YUANBAO_SPEC, KIMI_SPEC } from './specs.js'
import { ALL_MODELS, type MeetingModelName } from './sites.js'

export type { MeetingModelName } from './sites.js'
export type ModelName = MeetingModelName

// Per-model runtime configs. The three flagship adapters take typed configs;
// generic-adapter sites need no extra configuration (empty object).
export type MeetingModelConfigs = Record<MeetingModelName, ModelConfig>

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

const GENERIC_CAPS = { fileUpload: 'best-effort', loginCheck: 'best-effort', modelSelection: 'manual' } as const

export const ADAPTER_REGISTRY: Record<MeetingModelName, ModelEntry> = {
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
  claude: {
    ctor: () => new GenericWebChatAdapter(CLAUDE_SPEC),
    defaultConfig: {},
    displayName: 'Claude',
    provider: 'Anthropic',
    targetModel: 'Highest available model (manual confirm)',
    capabilities: GENERIC_CAPS,
    meetingRole: '长文审校与表达负责人：负责打磨论证严谨度、结构连贯性与语言表达。',
  },
  doubao: {
    ctor: () => new GenericWebChatAdapter(DOUBAO_SPEC),
    defaultConfig: {},
    displayName: '豆包',
    provider: 'ByteDance',
    targetModel: 'Highest available model (manual confirm)',
    capabilities: GENERIC_CAPS,
    meetingRole: '中文表达与大众传播视角：负责让结论更贴近读者、更易传播。',
  },
  zhipu: {
    ctor: () => new GenericWebChatAdapter(ZHIPU_SPEC),
    defaultConfig: {},
    displayName: '智谱清言',
    provider: 'Zhipu AI',
    targetModel: 'Highest available model (manual confirm)',
    capabilities: GENERIC_CAPS,
    meetingRole: '中文知识与本土语境：负责补充本土背景、知识细节与合规视角。',
  },
  qwen: {
    ctor: () => new GenericWebChatAdapter(QWEN_SPEC),
    defaultConfig: {},
    displayName: '通义千问',
    provider: 'Alibaba',
    targetModel: 'Highest available model (manual confirm)',
    capabilities: GENERIC_CAPS,
    meetingRole: '工程化与资料补充：负责把方案拆成可执行步骤并补全中文资料。',
  },
  yuanbao: {
    ctor: () => new GenericWebChatAdapter(YUANBAO_SPEC),
    defaultConfig: {},
    displayName: '腾讯元宝',
    provider: 'Tencent',
    targetModel: 'Highest available model (manual confirm)',
    capabilities: GENERIC_CAPS,
    meetingRole: '综合搜索与事实核验：负责交叉核对事实、补充时效信息。',
  },
  kimi: {
    ctor: () => new GenericWebChatAdapter(KIMI_SPEC),
    defaultConfig: {},
    displayName: 'Kimi',
    provider: 'Moonshot AI',
    targetModel: 'Highest available model (manual confirm)',
    capabilities: GENERIC_CAPS,
    meetingRole: '长上下文综合：负责通读全部材料、提炼跨文档的整体脉络。',
  },
}

export const MEETING_MODELS: MeetingModelName[] = [...ALL_MODELS]

export const DEFAULT_MEETING_MODEL_CONFIGS: MeetingModelConfigs = {
  chatgpt: ADAPTER_REGISTRY.chatgpt.defaultConfig,
  gemini: ADAPTER_REGISTRY.gemini.defaultConfig,
  deepseek: { mode: 'expert', deepThink: true, smartSearch: true } as DeepSeekConfig,
  claude: {},
  doubao: {},
  zhipu: {},
  qwen: {},
  yuanbao: {},
  kimi: {},
}
