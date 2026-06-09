import { ADAPTER_REGISTRY, type MeetingModelName } from '../browser/adapters/index.js'
import type { MeetingMode } from '../storage/repository.js'

export type ModelPosture = 'cooperative' | 'balanced' | 'critical'
export type ModelPostures = Partial<Record<MeetingModelName, ModelPosture>>

export interface MeetingFileInput {
  filename: string
  content: string
}

export interface MeetingTurnInput {
  model: MeetingModelName
  content: string
  roundIndex?: number
}

export interface MeetingContext {
  title: string
  goal: string
  mode: MeetingMode
  agendaRounds: number
  participants: MeetingModelName[]
  moderator: MeetingModelName
  modelPostures: ModelPostures
  files: MeetingFileInput[]
}

function modelRole(model: MeetingModelName): string {
  return ADAPTER_REGISTRY[model]?.meetingRole ?? '独立参会者：负责提出清晰判断、证据和可执行建议。'
}

function postureLabel(posture: ModelPosture): string {
  if (posture === 'cooperative') return '协作型'
  if (posture === 'critical') return '反骨质疑型'
  return '默认独立型'
}

function postureInstruction(model: MeetingModelName, ctx: MeetingContext): string {
  const posture = ctx.modelPostures[model] ?? 'balanced'
  if (posture === 'cooperative') {
    return '你的讨论姿态是协作型：优先寻找他人观点中可以吸收、整合、补强的部分，像真实职场里的协调者一样推动共识。但你不能无原则附和；如果有明显问题，要温和指出并给出改法。'
  }
  if (posture === 'critical') {
    return '你的讨论姿态是反骨质疑型：主动寻找他人观点中的漏洞、过度乐观、证据不足、逻辑跳跃和被忽略的风险。你要保持独立思考，可以明确反驳，但必须给出建设性替代方案，不能为了反对而反对。'
  }
  return '你的讨论姿态是默认独立型：既不刻意附和，也不过度反对。你要基于材料和逻辑保持独立判断，吸收有价值的观点，同时指出你认为需要修正的部分。'
}

export function buildMaterialPack(ctx: MeetingContext): string {
  const files = ctx.files.map((f, i) => {
    const content = f.content.length > 18_000
      ? `${f.content.slice(0, 18_000)}\n\n[内容过长，已在本轮提示中截断。]`
      : f.content
    return `## 材料 ${i + 1}: ${f.filename}\n\n${content}`
  }).join('\n\n---\n\n')

  const roles = ctx.participants
    .map(model => {
      const posture = ctx.modelPostures[model] ?? 'balanced'
      return `- ${model}: ${modelRole(model)}；讨论姿态：${postureLabel(posture)}`
    })
    .join('\n')

  return `
# 会议资料包

## 会议标题
${ctx.title}

## 会议目标
${ctx.goal}

## 参会模型与分工
${roles}

## 讨论模式
${ctx.mode === 'relay'
    ? '接力模式：后发言者必须吸收前序观点，并明确补充、反驳或修正。'
    : '并行模式：每一轮中各模型先独立判断，之后进入下一轮交叉回应。'}

## 议程轮数
每个议程讨论 ${ctx.agendaRounds} 轮。第一轮建立观点，后续轮次重点质疑、澄清、修正和收束。

## 上传材料
${files || '（无上传材料）'}
`.trim()
}

function humanNoteSection(notes?: string[]): string {
  if (!notes || !notes.length) return ''
  const list = notes.map((n, i) => `${i + 1}. ${n}`).join('\n')
  return `

## 人类主持人插话（最高优先级，必须正面回应）
真实主持人在会议进行中提出了以下内容，你必须在发言里优先、明确地回应，不能回避：
${list}`
}

export function agendaPrompt(args: {
  ctx: MeetingContext
  agendaIndex: number
  roundIndex: number
  question: string
  model: MeetingModelName
  previousTurns: MeetingTurnInput[]
  humanNotes?: string[]
}): string {
  const prior = args.previousTurns.length
    ? args.previousTurns
        .map(t => `### 第 ${(t.roundIndex ?? 0) + 1} 轮 · ${t.model}\n${t.content}`)
        .join('\n\n')
    : '暂无前序发言。'

  const roundRule = args.roundIndex === 0
    ? '这是本议程第 1 轮。请先给出你的独立判断，不要泛泛开场。'
    : `这是本议程第 ${args.roundIndex + 1} 轮。你必须回应前面至少一个具体观点：可以追问、反驳、修正、补强或提出折中方案。不要重复自己上一轮的内容。`

  return `
你正在参加一个本地多模型会议。请用中文，站在自己的分工角度发言。

${buildMaterialPack(args.ctx)}

## 当前议程 ${args.agendaIndex + 1}
${args.question}

## 当前轮次
第 ${args.roundIndex + 1} / ${args.ctx.agendaRounds} 轮
${humanNoteSection(args.humanNotes)}

## 前序发言
${prior}

## 你的固定分工
${modelRole(args.model)}

## 你的讨论姿态
${postureInstruction(args.model, args.ctx)}

## 本轮要求
${roundRule}

请严格输出以下结构：

## 核心判断
用 2-4 句话给出你对本议程的明确判断。

## 回应与交锋
点名回应前序发言中的具体观点；第 1 轮可写“暂无前序观点，先给出独立判断”。

## 依据
列出最关键的材料依据、逻辑依据或经验依据。

## 风险与不确定性
指出本议程里最容易误判的地方。

## 可执行建议
给出下一步具体怎么做。
`.trim()
}

export function agendaDraftPrompt(args: {
  ctx: MeetingContext
  seedAgenda: string[]
}): string {
  const seed = args.seedAgenda.length
    ? args.seedAgenda.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '用户没有手动指定议程，请你从主题、目标和材料中自行提出。'

  return `
你是本次多模型会议的主持人 ${args.ctx.moderator}。正式开会前，请先为这场会议拟定 3-5 个议程问题。

${buildMaterialPack(args.ctx)}

## 用户已有议程或提示
${seed}

## 任务
请生成 3-5 个会议议程。每个议程尽量控制在一句到两句话，必须能引发后续讨论、质疑、比较和收束，而不是泛泛的大标题。

请严格按以下格式输出，不要添加解释：

1. 议程问题
2. 议程问题
3. 议程问题
`.trim()
}

export function agendaSummaryPrompt(args: {
  ctx: MeetingContext
  agendaIndex: number
  question: string
  turns: MeetingTurnInput[]
  humanNotes?: string[]
}): string {
  const turns = args.turns
    .map(t => `### 第 ${(t.roundIndex ?? 0) + 1} 轮 · ${t.model}\n${t.content}`)
    .join('\n\n')

  return `
你是本次会议的主持人 ${args.ctx.moderator}。请像真实会议主持人一样收束多轮讨论，而不是简单摘要。

${buildMaterialPack(args.ctx)}

## 当前议程 ${args.agendaIndex + 1}
${args.question}
${humanNoteSection(args.humanNotes)}

## 多轮发言记录
${turns}

请严格输出：

## 议程结论
一句话到三句话说明本议程目前最可信的结论。

## 共识
列出各模型共同认可的判断。

## 分歧点
列出模型之间真正不同的判断、假设或优先级。

## 交锋后发生的修正
说明哪些观点在后续轮次中被质疑、修正、补强或放弃。

## 证据缺口
说明还缺什么材料、事实或验证。

## 下一步建议
给出可执行动作，不要只写原则。
`.trim()
}

export function finalSummaryPrompt(args: {
  ctx: MeetingContext
  agendaSummaries: { question: string; summary: string }[]
}): string {
  const summaries = args.agendaSummaries
    .map((s, i) => `## 议程 ${i + 1}: ${s.question}\n\n${s.summary}`)
    .join('\n\n---\n\n')

  return `
你是本次会议的最终归纳者 ${args.ctx.moderator}。请形成一份能直接指导用户行动的会议纪要。

${buildMaterialPack(args.ctx)}

# 议程小结
${summaries}

请严格输出：

## 最终结论
给出本次会议的总判断。

## 共同点
列出所有 AI 最一致的观点。

## 分歧点
列出仍然存在的分歧，并说明这些分歧为什么重要。

## 讨论带来的观点变化
说明哪些观点经过多轮质疑后发生了修正。

## 推荐方案
给出最推荐的方案或优先级排序。

## 具体指导
把建议拆成用户可以马上执行的步骤。

## 需要补充的材料
列出下一轮会议或人工判断还需要哪些信息。

## 保留意见
列出少数意见、风险和不确定性。
`.trim()
}
