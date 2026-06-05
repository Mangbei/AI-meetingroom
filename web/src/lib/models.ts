export type MeetingModelName = 'chatgpt' | 'gemini' | 'deepseek'
export type PlannedModelName = 'claude' | 'doubao' | 'zhipu' | 'qwen'
export type ModelCandidateName = MeetingModelName | PlannedModelName

export interface ModelMeta {
  tone: string
  display: string
  latin: string
  targetModel: string
  enabled: boolean
  role: string
  capabilities: string[]
}

export const MODEL_CANDIDATES: Record<ModelCandidateName, ModelMeta> = {
  chatgpt: {
    tone: 'var(--sage)',
    display: 'ChatGPT',
    latin: 'OpenAI',
    targetModel: '最高 Thinking / Reasoning 档位',
    enabled: true,
    role: '结构化策略与写作方案',
    capabilities: ['登录检测', '附件直传', '人工最高模型确认'],
  },
  gemini: {
    tone: 'var(--violet)',
    display: 'Gemini',
    latin: 'Google',
    targetModel: 'Gemini Pro / 最高 Pro 档位',
    enabled: true,
    role: '资料综合与外部视角',
    capabilities: ['登录检测', '附件直传', '人工最高模型确认'],
  },
  deepseek: {
    tone: 'var(--azure)',
    display: 'DeepSeek',
    latin: 'DeepSeek',
    targetModel: 'DeepSeek R1 + 深度思考',
    enabled: true,
    role: '反方推理与风险审查',
    capabilities: ['登录检测', '附件直传', '深度思考配置'],
  },
  claude: {
    tone: '#d89562',
    display: 'Claude',
    latin: 'Anthropic',
    targetModel: '已确认未接入：等待 Claude 网页端适配器',
    enabled: false,
    role: '长文审校与表达润色',
    capabilities: ['未接入'],
  },
  doubao: {
    tone: '#58b6a8',
    display: '豆包',
    latin: 'ByteDance',
    targetModel: '已确认未接入：等待豆包网页端适配器',
    enabled: false,
    role: '中文表达与大众传播视角',
    capabilities: ['未接入'],
  },
  zhipu: {
    tone: '#b8a7ff',
    display: '智谱',
    latin: 'Zhipu AI',
    targetModel: '已确认未接入：等待智谱网页端适配器',
    enabled: false,
    role: '中文知识与政策语境',
    capabilities: ['未接入'],
  },
  qwen: {
    tone: '#7db7ff',
    display: '千问',
    latin: 'Alibaba',
    targetModel: '已确认未接入：等待通义千问网页端适配器',
    enabled: false,
    role: '工程化与中文资料补充',
    capabilities: ['未接入'],
  },
}

export const MODEL_META: Record<MeetingModelName, ModelMeta> = {
  chatgpt: MODEL_CANDIDATES.chatgpt,
  gemini: MODEL_CANDIDATES.gemini,
  deepseek: MODEL_CANDIDATES.deepseek,
}

export const MODEL_ABBR: Record<MeetingModelName, string> = {
  chatgpt: 'GP',
  gemini: 'GM',
  deepseek: 'DS',
}

export const MEETING_MODELS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']
export const MODEL_CANDIDATE_ORDER: ModelCandidateName[] = ['chatgpt', 'gemini', 'deepseek', 'claude', 'doubao', 'zhipu', 'qwen']
