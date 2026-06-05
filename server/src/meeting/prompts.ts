import { ADAPTER_REGISTRY, type MeetingModelName } from '../browser/adapters/index.js'
import type { MeetingMode } from '../storage/repository.js'

export interface MeetingFileInput {
  filename: string
  content: string
}

export interface MeetingContext {
  title: string
  goal: string
  mode: MeetingMode
  participants: MeetingModelName[]
  moderator: MeetingModelName
  files: MeetingFileInput[]
}

function modelRole(model: MeetingModelName): string {
  return ADAPTER_REGISTRY[model]?.meetingRole ?? '独立参会者：负责提出清晰判断、证据和可执行建议。'
}

export function buildMaterialPack(ctx: MeetingContext): string {
  const files = ctx.files.map((f, i) => {
    const content = f.content.length > 18_000
      ? `${f.content.slice(0, 18_000)}\n\n[内容过长，已在本轮提示中截断。]`
      : f.content
    return `## 材料 ${i + 1}: ${f.filename}\n\n${content}`
  }).join('\n\n---\n\n')

  const roles = ctx.participants
    .map(model => `- ${model}: ${modelRole(model)}`)
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
    : '并行模式：各模型先独立判断，主持人再综合交叉比较。'}

## 上传材料
${files || '（无上传材料）'}
`.trim()
}

export function agendaPrompt(args: {
  ctx: MeetingContext
  agendaIndex: number
  question: string
  model: MeetingModelName
  previousTurns: { model: MeetingModelName; content: string }[]
}): string {
  const prior = args.previousTurns.length
    ? args.previousTurns.map(t => `### ${t.model}\n${t.content}`).join('\n\n')
    : '暂无前序发言。'

  const interactionRule = args.previousTurns.length
    ? '你必须点名回应至少一个前序观点：可以同意并补强，也可以指出漏洞、边界或替代方案。不要简单复述。'
    : '你是本议程的首轮发言者之一，请先给出独立判断，不要写泛泛的开场白。'

  return `
你正在参加一个本地多模型会议。请用中文，站在自己的分工角度发言。

${buildMaterialPack(args.ctx)}

## 当前议程 ${args.agendaIndex + 1}
${args.question}

## 前序发言
${prior}

## 你的固定分工
${modelRole(args.model)}

## 发言要求
${interactionRule}

请严格输出以下结构：

## 核心判断
用 2-4 句话给出你对本议程的明确判断。

## 依据
列出最关键的材料依据、逻辑依据或经验依据。

## 对其他观点的回应
如果有前序发言，说明你同意、补充、反驳或修正了什么。

## 风险与不确定性
指出本议程里最容易误判的地方。

## 可执行建议
给出下一步具体怎么做。
`.trim()
}

export function agendaSummaryPrompt(args: {
  ctx: MeetingContext
  agendaIndex: number
  question: string
  turns: { model: MeetingModelName; content: string }[]
}): string {
  const turns = args.turns.map(t => `### ${t.model}\n${t.content}`).join('\n\n')
  return `
你是本次会议的主持人 ${args.ctx.moderator}。请像真实会议主持人一样收束讨论，而不是简单摘要。

${buildMaterialPack(args.ctx)}

## 当前议程 ${args.agendaIndex + 1}
${args.question}

## 参会模型发言
${turns}

请严格输出：

## 议程结论
一句话到三句话说明本议程目前最可信的结论。

## 共识
列出各模型共同认可的判断。

## 分歧点
列出模型之间真正不同的判断、假设或优先级。

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
