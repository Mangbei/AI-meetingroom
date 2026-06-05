import type { MeetingModelName } from '../browser/adapters/index.js'
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

export function buildMaterialPack(ctx: MeetingContext): string {
  const files = ctx.files.map((f, i) => {
    const content = f.content.length > 18_000
      ? `${f.content.slice(0, 18_000)}\n\n[内容过长，已在首版中截断。]`
      : f.content
    return `## 材料 ${i + 1}: ${f.filename}\n\n${content}`
  }).join('\n\n---\n\n')

  return `
# 会议资料包

## 会议标题
${ctx.title}

## 会议目标
${ctx.goal}

## 参会模型
${ctx.participants.join(', ')}

## 讨论模式
${ctx.mode === 'relay' ? '接力模式：后发言者必须参考前面发言。' : '并行模式：各模型独立回答同一议程。'}

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

  return `
你正在参加一个本地多模型会议。请用中文，直接给出对当前议程的实质性意见。

${buildMaterialPack(args.ctx)}

## 当前议程 ${args.agendaIndex + 1}
${args.question}

## 前序发言
${prior}

## 你的角色
你是 ${args.model}。请基于资料和前序发言完成：
1. 对议程问题的核心判断。
2. 你认为最重要的证据或理由。
3. 对前序发言的补充、反驳或修正（如果有）。
4. 明确给出可执行建议。

输出保持结构化，不要写寒暄。
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
你是本次会议的主持人 ${args.ctx.moderator}。请综合以下议程讨论，生成该议程的小结。

${buildMaterialPack(args.ctx)}

## 当前议程 ${args.agendaIndex + 1}
${args.question}

## 参会模型发言
${turns}

请输出：
## 议程结论
## 共识
## 分歧
## 下一步建议
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
你是本次会议的最终归纳者 ${args.ctx.moderator}。请基于所有议程小结，形成一份可直接保存的会议纪要。

${buildMaterialPack(args.ctx)}

# 议程小结
${summaries}

请输出：
## 最终结论
## 推荐方案或优先级
## 关键依据
## 主要风险与不确定性
## 行动清单
## 少数意见或保留意见
`.trim()
}
