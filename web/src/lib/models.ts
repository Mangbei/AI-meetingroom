export type MeetingModelName = 'chatgpt' | 'gemini' | 'deepseek'

export interface ModelMeta {
  tone: string
  display: string
  latin: string
}

export const MODEL_META: Record<MeetingModelName, ModelMeta> = {
  chatgpt:  { tone: 'var(--sage)',   display: 'ChatGPT',  latin: 'OpenAI'   },
  gemini:   { tone: 'var(--violet)', display: 'Gemini',   latin: 'Google'   },
  deepseek: { tone: 'var(--azure)',  display: 'DeepSeek', latin: 'Hangzhou' },
}

export const MODEL_ABBR: Record<MeetingModelName, string> = {
  chatgpt: 'GP',
  gemini: 'GM',
  deepseek: 'DS',
}

export const MEETING_MODELS: MeetingModelName[] = ['chatgpt', 'gemini', 'deepseek']
