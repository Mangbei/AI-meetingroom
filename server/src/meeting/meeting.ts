import { CDPSession } from '../browser/cdp.js'
import { ADAPTER_REGISTRY, DEFAULT_MEETING_MODEL_CONFIGS, MeetingModelConfigs, MeetingModelName } from '../browser/adapters/index.js'
import type { ModelConfig, SiteAdapter } from '../browser/adapters/base.js'
import {
  agendaItems, meetingArtifacts, meetingFiles, meetingMessages, meetings,
  type AgendaItemRow, type MeetingMode,
} from '../storage/repository.js'
import { agendaPrompt, agendaSummaryPrompt, finalSummaryPrompt, type MeetingContext } from './prompts.js'
import { archiveMeeting } from './archive.js'
import { notifyMeetingDone } from './notify.js'

export type MeetingEvent =
  | { type: 'agenda_started'; meetingId: string; agendaId: number; agendaIndex: number; question: string }
  | { type: 'turn_started'; meetingId: string; agendaId?: number | null; turnIndex: number; role: string; model: MeetingModelName }
  | { type: 'delta'; meetingId: string; agendaId?: number | null; turnIndex: number; role: string; model: MeetingModelName; content: string }
  | { type: 'message_complete'; meetingId: string; agendaId?: number | null; turnIndex: number; role: string; model: MeetingModelName; content: string }
  | { type: 'agenda_summary'; meetingId: string; agendaId: number; agendaIndex: number; content: string }
  | { type: 'final_summary'; meetingId: string; content: string; archiveDir?: string; summaryPath?: string; jsonPath?: string }
  | { type: 'done'; meetingId: string }
  | { type: 'error'; meetingId: string; agendaId?: number | null; model?: MeetingModelName; error: string }

type Emit = (event: MeetingEvent) => void
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173'

export interface UploadedMeetingFile {
  filename: string
  kind: 'txt' | 'md'
  content: string
}

export interface CreateMeetingInput {
  title: string
  goal: string
  mode: MeetingMode
  participants: MeetingModelName[]
  moderator: MeetingModelName
  agenda: string[]
  files: UploadedMeetingFile[]
  modelConfigs?: Partial<MeetingModelConfigs>
}

async function runModelTurn(args: {
  meetingId: string
  agendaId: number | null
  turnIndex: number
  role: string
  model: MeetingModelName
  adapter: SiteAdapter
  prompt: string
  emit: Emit
}): Promise<string> {
  const { meetingId, agendaId, turnIndex, role, model, adapter, prompt, emit } = args
  emit({ type: 'turn_started', meetingId, agendaId, turnIndex, role, model })
  console.log(`[meeting ${meetingId}] turn ${turnIndex} start: ${role}/${model}`)
  try {
    await adapter.focus?.()
    await adapter.sendMessage(prompt)
    const content = await adapter.streamResponse(delta => {
      emit({ type: 'delta', meetingId, agendaId, turnIndex, role, model, content: delta })
    })
    meetingMessages.insert({ meetingId, agendaId, turnIndex, role, model, content })
    emit({ type: 'message_complete', meetingId, agendaId, turnIndex, role, model, content })
    if (!content.trim()) throw new Error(`${model} returned empty content`)
    console.log(`[meeting ${meetingId}] turn ${turnIndex} complete: ${role}/${model}, ${content.length} chars`)
    return content
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const content = `[ERROR: ${error}]`
    meetingMessages.insert({ meetingId, agendaId, turnIndex, role, model, content })
    emit({ type: 'error', meetingId, agendaId, model, error })
    console.error(`[meeting ${meetingId}] turn ${turnIndex} error: ${role}/${model}: ${error}`)
    throw err
  }
}

async function prepareAdapters(
  cdp: CDPSession,
  participants: MeetingModelName[],
  configs: MeetingModelConfigs,
): Promise<Record<MeetingModelName, SiteAdapter>> {
  const adapters = {} as Record<MeetingModelName, SiteAdapter>
  for (const model of participants) {
    const page = await cdp.ensurePage(model)
    const adapter = ADAPTER_REGISTRY[model].ctor()
    adapter.setPage(page)
    await adapter.ensureReady()
    await adapter.newConversation()
    if (adapter.configure) await adapter.configure(configs[model] as ModelConfig)
    adapters[model] = adapter
  }
  return adapters
}

export async function runMeeting(
  meetingId: string,
  input: CreateMeetingInput,
  cdp: CDPSession,
  emit: Emit,
): Promise<void> {
  meetings.setStatus(meetingId, 'running')
  console.log(`[meeting ${meetingId}] started: ${input.title}`)

  const meeting = meetings.get(meetingId)
  if (!meeting) throw new Error(`meeting not found: ${meetingId}`)
  const storedFiles = meetingFiles.listByMeeting(meetingId)
  const storedAgenda = agendaItems.listByMeeting(meetingId)
  const configs: MeetingModelConfigs = {
    ...DEFAULT_MEETING_MODEL_CONFIGS,
    ...input.modelConfigs,
    deepseek: input.modelConfigs?.deepseek ?? DEFAULT_MEETING_MODEL_CONFIGS.deepseek,
    chatgpt: input.modelConfigs?.chatgpt ?? DEFAULT_MEETING_MODEL_CONFIGS.chatgpt,
    gemini: input.modelConfigs?.gemini ?? DEFAULT_MEETING_MODEL_CONFIGS.gemini,
  }

  const ctx: MeetingContext = {
    title: input.title,
    goal: input.goal,
    mode: input.mode,
    participants: input.participants,
    moderator: input.moderator,
    files: storedFiles.map(f => ({ filename: f.filename, content: f.content })),
  }

  const adapters = await prepareAdapters(cdp, input.participants, configs)
  const agendaSummaries: { question: string; summary: string }[] = []
  let turnIndex = 0

  for (let agendaIndex = 0; agendaIndex < storedAgenda.length; agendaIndex++) {
    const item: AgendaItemRow = storedAgenda[agendaIndex]
    emit({ type: 'agenda_started', meetingId, agendaId: item.id, agendaIndex, question: item.question })
    const turns: { model: MeetingModelName; content: string }[] = []

    if (input.mode === 'parallel') {
      const results = await Promise.all(input.participants.map(async model => {
        const content = await runModelTurn({
          meetingId,
          agendaId: item.id,
          turnIndex: turnIndex++,
          role: 'participant',
          model,
          adapter: adapters[model],
          prompt: agendaPrompt({ ctx, agendaIndex, question: item.question, model, previousTurns: [] }),
          emit,
        })
        return { model, content }
      }))
      turns.push(...results)
    } else {
      for (const model of input.participants) {
        const content = await runModelTurn({
          meetingId,
          agendaId: item.id,
          turnIndex: turnIndex++,
          role: 'participant',
          model,
          adapter: adapters[model],
          prompt: agendaPrompt({ ctx, agendaIndex, question: item.question, model, previousTurns: turns }),
          emit,
        })
        turns.push({ model, content })
      }
    }

    const summary = await runModelTurn({
      meetingId,
      agendaId: item.id,
      turnIndex: turnIndex++,
      role: 'agenda_summary',
      model: input.moderator,
      adapter: adapters[input.moderator],
      prompt: agendaSummaryPrompt({ ctx, agendaIndex, question: item.question, turns }),
      emit,
    })
    agendaItems.updateSummary(item.id, summary)
    agendaSummaries.push({ question: item.question, summary })
    emit({ type: 'agenda_summary', meetingId, agendaId: item.id, agendaIndex, content: summary })
  }

  const finalSummary = await runModelTurn({
    meetingId,
    agendaId: null,
    turnIndex: turnIndex++,
    role: 'final_summary',
    model: input.moderator,
    adapter: adapters[input.moderator],
    prompt: finalSummaryPrompt({ ctx, agendaSummaries }),
    emit,
  })

  const freshMeeting = meetings.get(meetingId)!
  const archive = archiveMeeting({
    meeting: freshMeeting,
    files: meetingFiles.listByMeeting(meetingId),
    agenda: agendaItems.listByMeeting(meetingId),
    messages: meetingMessages.listByMeeting(meetingId),
    finalSummary,
  })
  meetingArtifacts.upsert(meetingId, finalSummary, archive.archiveDir, archive.summaryPath, archive.jsonPath)
  meetings.setArchive(meetingId, archive.archiveDir, archive.summaryPath, archive.jsonPath)
  meetings.markDone(meetingId)
  emit({ type: 'final_summary', meetingId, content: finalSummary, ...archive })
  emit({ type: 'done', meetingId })
  await cdp.openUrl(`${APP_ORIGIN}/meetings/${meetingId}`).catch(() => {})
  console.log(`[meeting ${meetingId}] done: ${archive.summaryPath}`)
  await notifyMeetingDone(input.title, archive.summaryPath)
}
