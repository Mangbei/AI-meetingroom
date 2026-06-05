import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { MeetingModelName } from '../browser/adapters/index.js'
import type { AgendaItemRow, MeetingFileRow, MeetingMessageRow, MeetingRow } from '../storage/repository.js'

export interface ArchiveInput {
  meeting: MeetingRow
  files: MeetingFileRow[]
  agenda: AgendaItemRow[]
  messages: MeetingMessageRow[]
  finalSummary: string
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LOCAL_DATA_DIR = resolve(PROJECT_ROOT, '.local-data', 'meetings')

const label: Record<MeetingModelName, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
}

export function renderMeetingMarkdown(input: ArchiveInput): string {
  const participants = JSON.parse(input.meeting.participants_json) as MeetingModelName[]
  let md = `# ${input.meeting.title}\n\n`
  md += `*模式：${input.meeting.mode} | 轮数：${input.meeting.agenda_rounds} | 主持人：${label[input.meeting.moderator]} | 参会者：${participants.map(p => label[p]).join('、')}*\n\n`
  md += `## 会议目标\n\n${input.meeting.goal}\n\n`

  if (input.files.length) {
    md += `## 上传资料\n\n`
    for (const f of input.files) md += `- ${f.filename} (${f.kind})\n`
    md += '\n'
  }

  for (const item of input.agenda) {
    md += `---\n\n## 议程 ${item.position + 1}: ${item.question}\n\n`
    const turns = input.messages.filter(m => m.agenda_id === item.id && m.role === 'participant')
    const rounds = [...new Set(turns.map(turn => turn.round_index ?? 0))].sort((a, b) => a - b)
    for (const round of rounds) {
      md += `### 第 ${round + 1} 轮\n\n`
      for (const turn of turns.filter(t => (t.round_index ?? 0) === round)) {
        md += `#### ${label[turn.model] ?? turn.model}\n\n${turn.content}\n\n`
      }
    }
    if (item.summary) md += `### 议程小结\n\n${item.summary}\n\n`
  }

  md += `---\n\n## 最终会议纪要\n\n${input.finalSummary}\n`
  return md
}

export function archiveMeeting(input: ArchiveInput): { archiveDir: string; summaryPath: string; jsonPath: string } {
  const archiveDir = join(LOCAL_DATA_DIR, input.meeting.id)
  mkdirSync(archiveDir, { recursive: true })
  const summaryPath = join(archiveDir, 'summary.md')
  const jsonPath = join(archiveDir, 'meeting.json')
  writeFileSync(summaryPath, renderMeetingMarkdown(input), 'utf-8')
  writeFileSync(jsonPath, JSON.stringify(input, null, 2), 'utf-8')
  return { archiveDir, summaryPath, jsonPath }
}
