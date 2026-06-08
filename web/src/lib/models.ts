export type MeetingModelName =
  | 'chatgpt' | 'gemini' | 'deepseek'
  | 'claude' | 'doubao' | 'zhipu' | 'qwen' | 'yuanbao' | 'kimi'
export type ModelCandidateName = MeetingModelName

export interface ModelMeta {
  tone: string
  display: string
  latin: string
  targetModel: string
  enabled: boolean
  role: string
  capabilities: string[]
}

const WEB_CAPS = ['登录检测', '附件直传', '页面结构自检']

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
    targetModel: '网页端最高可用模型（请手动确认）',
    enabled: true,
    role: '长文审校与表达润色',
    capabilities: WEB_CAPS,
  },
  doubao: {
    tone: '#58b6a8',
    display: '豆包',
    latin: 'ByteDance',
    targetModel: '网页端最高可用模型（请手动确认）',
    enabled: true,
    role: '中文表达与大众传播视角',
    capabilities: WEB_CAPS,
  },
  zhipu: {
    tone: '#b8a7ff',
    display: '智谱清言',
    latin: 'Zhipu AI',
    targetModel: '网页端最高可用模型（请手动确认）',
    enabled: true,
    role: '中文知识与本土语境',
    capabilities: WEB_CAPS,
  },
  qwen: {
    tone: '#7db7ff',
    display: '通义千问',
    latin: 'Alibaba',
    targetModel: '网页端最高可用模型（请手动确认）',
    enabled: true,
    role: '工程化与中文资料补充',
    capabilities: WEB_CAPS,
  },
  yuanbao: {
    tone: '#5b8ff9',
    display: '腾讯元宝',
    latin: 'Tencent',
    targetModel: '网页端最高可用模型（请手动确认）',
    enabled: true,
    role: '综合搜索与事实核验',
    capabilities: WEB_CAPS,
  },
  kimi: {
    tone: '#9b8cff',
    display: 'Kimi',
    latin: 'Moonshot AI',
    targetModel: '网页端最高可用模型（请手动确认）',
    enabled: true,
    role: '长上下文综合',
    capabilities: WEB_CAPS,
  },
}

export const MODEL_META: Record<MeetingModelName, ModelMeta> = MODEL_CANDIDATES

export const MODEL_ABBR: Record<MeetingModelName, string> = {
  chatgpt: 'GP',
  gemini: 'GM',
  deepseek: 'DS',
  claude: 'CL',
  doubao: 'DB',
  zhipu: 'ZP',
  qwen: 'QW',
  yuanbao: 'YB',
  kimi: 'KM',
}

// Every model that has a working adapter and can be selected for a meeting.
export const MEETING_MODELS: MeetingModelName[] =
  ['chatgpt', 'gemini', 'deepseek', 'claude', 'doubao', 'zhipu', 'qwen', 'yuanbao', 'kimi']

// Selected (and status-checked) by default, to avoid opening every tab at once.
// Users can add any of the others from the participant list.
export const DEFAULT_PARTICIPANTS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']

export const MODEL_CANDIDATE_ORDER: ModelCandidateName[] = [...MEETING_MODELS]
