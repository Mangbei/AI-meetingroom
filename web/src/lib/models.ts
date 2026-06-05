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
    targetModel: '最高 Thinking / Reasoning 模型',
    enabled: true,
    role: '结构化策略与写作方案',
    capabilities: ['登录检测', '附件直传', '手动最高模型确认'],
  },
  gemini: {
    tone: 'var(--violet)',
    display: 'Gemini',
    latin: 'Google',
    targetModel: 'Gemini Pro / 最高 Pro 模型',
    enabled: true,
    role: '资料综合与外部视角',
    capabilities: ['登录检测', '附件直传', '手动最高模型确认'],
  },
  deepseek: {
    tone: 'var(--azure)',
    display: 'DeepSeek',
    latin: 'DeepSeek',
    targetModel: 'DeepSeek R1 + 深度思考',
    enabled: true,
    role: '反方推理与风险审稿',
    capabilities: ['登录检测', '附件直传', '深度思考配置'],
  },
  claude: {
    tone: '#d89562',
    display: 'Claude',
    latin: 'Anthropic',
    targetModel: 'Claude highest available',
    enabled: false,
    role: '长文审稿与表达润色',
    capabilities: ['规划中'],
  },
  doubao: {
    tone: '#58b6a8',
    display: '豆包',
    latin: 'ByteDance',
    targetModel: '豆包最高可用模型',
    enabled: false,
    role: '中文表达与大众传播视角',
    capabilities: ['规划中'],
  },
  zhipu: {
    tone: '#b8a7ff',
    display: '智谱',
    latin: 'Zhipu AI',
    targetModel: 'GLM 最高可用模型',
    enabled: false,
    role: '中文知识与政策语境',
    capabilities: ['规划中'],
  },
  qwen: {
    tone: '#7db7ff',
    display: '千问',
    latin: 'Alibaba',
    targetModel: '通义千问最高可用模型',
    enabled: false,
    role: '工程化与中文资料补充',
    capabilities: ['规划中'],
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
