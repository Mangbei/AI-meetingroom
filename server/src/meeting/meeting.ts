import { CDPSession } from '../browser/cdp.js'
import { ADAPTER_REGISTRY, DEFAULT_MEETING_MODEL_CONFIGS, MeetingModelConfigs, MeetingModelName } from '../browser/adapters/index.js'
import { withRetry, type ModelConfig, type SiteAdapter } from '../browser/adapters/base.js'
import {
  agendaItems, meetingArtifacts, meetingFiles, meetingLogs, meetingMessages, meetings,
  type AgendaItemRow, type MeetingMode,
  type MeetingFileRow,
} from '../storage/repository.js'
import {
  agendaPrompt,
  agendaSummaryPrompt,
  finalSummaryPrompt,
  minutesExtractionPrompt,
  type MeetingContext,
  type MeetingTurnInput,
  type ModelPostures,
} from './prompts.js'
import { parseStructuredMinutes, EMPTY_MINUTES, type StructuredMinutes } from './minutes.js'
import { archiveMeeting } from './archive.js'
import { notifyMeetingDone } from './notify.js'
import type { UploadedMeetingFile } from './files.js'

export type { UploadedMeetingFile } from './files.js'

export type MeetingEvent =
  | { type: 'agenda_started'; meetingId: string; agendaId: number; agendaIndex: number; question: string }
  | { type: 'turn_started'; meetingId: string; agendaId?: number | null; turnIndex: number; roundIndex?: number; role: string; model: MeetingModelName }
  | { type: 'delta'; meetingId: string; agendaId?: number | null; turnIndex: number; roundIndex?: number; role: string; model: MeetingModelName; content: string }
  | { type: 'message_complete'; meetingId: string; agendaId?: number | null; turnIndex: number; roundIndex?: number; role: string; model: MeetingModelName; content: string }
  | { type: 'model_status'; meetingId: string; model: MeetingModelName; status: 'opening' | 'ready' | 'speaking' | 'complete' | 'skipped' | 'error'; detail?: string }
  | { type: 'file_delivery'; meetingId: string; model: MeetingModelName; filename?: string; status: 'trying' | 'uploaded' | 'fallback' | 'error'; method?: FileDeliveryMode; attempt?: number; detail?: string }
  | { type: 'agenda_summary'; meetingId: string; agendaId: number; agendaIndex: number; content: string }
  | { type: 'final_summary'; meetingId: string; content: string; archiveDir?: string; summaryPath?: string; jsonPath?: string }
  | { type: 'structured_minutes'; meetingId: string; actionItems: StructuredMinutes['actionItems']; openProblems: StructuredMinutes['openProblems'] }
  | { type: 'human_note'; meetingId: string; agendaId?: number | null; content: string }
  | { type: 'done'; meetingId: string }
  | { type: 'error'; meetingId: string; agendaId?: number | null; model?: MeetingModelName; error: string }

type Emit = (event: MeetingEvent) => void
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173'

/**
 * Pending human-moderator interventions, keyed by meeting id. The HTTP layer
 * appends a note while a meeting is running; the meeting loop drains the queue
 * at the start of each round and folds the notes into the next prompts so the
 * models must respond — like a chair interjecting in a live meeting.
 */
const humanNoteQueue = new Map<string, string[]>()

export function addHumanNote(meetingId: string, text: string): void {
  const note = text.trim()
  if (!note) return
  const queue = humanNoteQueue.get(meetingId) ?? []
  queue.push(note)
  humanNoteQueue.set(meetingId, queue)
}

function drainHumanNotes(meetingId: string): string[] {
  const queue = humanNoteQueue.get(meetingId)
  if (!queue || !queue.length) return []
  humanNoteQueue.set(meetingId, [])
  return queue
}

export function isMeetingRunning(meetingId: string): boolean {
  return runningMeetings.has(meetingId)
}

const runningMeetings = new Set<string>()

type FileDeliveryMode = 'original-upload' | 'text-fallback'

interface AdapterBundle {
  adapters: Partial<Record<MeetingModelName, SiteAdapter>>
  activeParticipants: MeetingModelName[]
  moderator: MeetingModelName
  fileDelivery: Partial<Record<MeetingModelName, FileDeliveryMode>>
}

export interface CreateMeetingInput {
  title: string
  goal: string
  mode: MeetingMode
  agendaRounds?: number
  modelPostures?: ModelPostures
  participants: MeetingModelName[]
  moderator: MeetingModelName
  agenda: string[]
  files: UploadedMeetingFile[]
  modelConfigs?: Partial<MeetingModelConfigs>
}

function recordModelStatus(
  meetingId: string,
  model: MeetingModelName,
  status: 'opening' | 'ready' | 'speaking' | 'complete' | 'skipped' | 'error',
  emit: Emit,
  detail = '',
): void {
  meetingLogs.insert({ meetingId, kind: 'model_status', model, status, detail })
  emit({ type: 'model_status', meetingId, model, status, detail })
}

function safeParsePostures(json: string | undefined): ModelPostures {
  if (!json) return {}
  try {
    return JSON.parse(json) as ModelPostures
  } catch {
    return {}
  }
}

function recordFileDelivery(
  meetingId: string,
  model: MeetingModelName,
  status: 'trying' | 'uploaded' | 'fallback' | 'error',
  emit: Emit,
  args: { filename?: string; method?: FileDeliveryMode; attempt?: number; detail?: string } = {},
): void {
  meetingLogs.insert({
    meetingId,
    kind: 'file_delivery',
    model,
    filename: args.filename ?? null,
    status,
    detail: args.detail ?? '',
  })
  emit({
    type: 'file_delivery',
    meetingId,
    model,
    status,
    filename: args.filename,
    method: args.method,
    attempt: args.attempt,
    detail: args.detail,
  })
}

async function runModelTurn(args: {
  meetingId: string
  agendaId: number | null
  turnIndex: number
  roundIndex?: number
  role: string
  model: MeetingModelName
  adapter: SiteAdapter
  prompt: string
  emit: Emit
}): Promise<string> {
  const { meetingId, agendaId, turnIndex, roundIndex, role, model, adapter, prompt, emit } = args
  emit({ type: 'turn_started', meetingId, agendaId, turnIndex, roundIndex, role, model })
  console.log(`[meeting ${meetingId}] turn ${turnIndex} start: ${role}/${model}`)
  try {
    recordModelStatus(meetingId, model, 'speaking', emit, role)
    await adapter.focus?.()
    // Sending can fail transiently (input not yet rendered, slow page). The
    // failure happens before the message is actually dispatched, so retrying is
    // safe and avoids losing a whole turn to a momentary hiccup.
    await withRetry(() => adapter.sendMessage(prompt), { attempts: 2, delayMs: 1000, label: `${model} sendMessage` })
    const content = await adapter.streamResponse(delta => {
      emit({ type: 'delta', meetingId, agendaId, turnIndex, roundIndex, role, model, content: delta })
    })
    // Validate before persisting so an empty/failed capture is recorded as an
    // error turn rather than a misleading "complete" with no content.
    if (!content.trim()) throw new Error(`${model} returned empty content`)
    meetingMessages.insert({ meetingId, agendaId, turnIndex, roundIndex: roundIndex ?? 0, role, model, content })
    emit({ type: 'message_complete', meetingId, agendaId, turnIndex, roundIndex, role, model, content })
    recordModelStatus(meetingId, model, 'complete', emit, role)
    console.log(`[meeting ${meetingId}] turn ${turnIndex} complete: ${role}/${model}, ${content.length} chars`)
    return content
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const content = `[ERROR: ${error}]`
    meetingMessages.insert({ meetingId, agendaId, turnIndex, roundIndex: roundIndex ?? 0, role, model, content })
    emit({ type: 'error', meetingId, agendaId, model, error })
    recordModelStatus(meetingId, model, 'error', emit, `${role}: ${error}`)
    console.error(`[meeting ${meetingId}] turn ${turnIndex} error: ${role}/${model}: ${error}`)
    throw err
  }
}

async function prepareAdapters(
  meetingId: string,
  cdp: CDPSession,
  participants: MeetingModelName[],
  moderator: MeetingModelName,
  configs: MeetingModelConfigs,
  files: MeetingFileRow[],
  emit: Emit,
): Promise<AdapterBundle> {
  const adapters: Partial<Record<MeetingModelName, SiteAdapter>> = {}
  const activeParticipants: MeetingModelName[] = []
  const fileDelivery: Partial<Record<MeetingModelName, FileDeliveryMode>> = {}
  for (const model of participants) {
    recordModelStatus(meetingId, model, 'opening', emit, 'opening controlled browser tab')
    try {
      const page = await cdp.ensurePage(model)
      const adapter = ADAPTER_REGISTRY[model].ctor()
      adapter.setPage(page)
      await adapter.ensureReady()
      await adapter.newConversation()
      // Self-check that critical DOM selectors still exist. If the site was
      // redesigned, fail fast here with a clear reason instead of producing a
      // mysterious empty/error turn mid-meeting.
      const pf = await adapter.preflight?.()
      if (pf && !pf.ok) {
        throw new Error(`页面结构自检失败，缺少关键元素: ${pf.missing.join(', ')}（${model} 网站可能已改版，需更新选择器）`)
      }
      if (adapter.configure) await adapter.configure(configs[model] as ModelConfig)
      fileDelivery[model] = await uploadOriginalFiles(meetingId, model, adapter, files, emit)
        ? 'original-upload'
        : 'text-fallback'
      adapters[model] = adapter
      activeParticipants.push(model)
      recordModelStatus(meetingId, model, 'ready', emit, 'ready for meeting')
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      recordModelStatus(meetingId, model, 'skipped', emit, detail)
      console.warn(`[meeting ${meetingId}] skipping ${model}: ${detail}`)
    }
  }

  if (activeParticipants.length < 2) {
    throw new Error(`At least two models must be ready. Ready models: ${activeParticipants.join(', ') || 'none'}`)
  }

  const activeModerator = activeParticipants.includes(moderator) ? moderator : activeParticipants[0]
  if (activeModerator !== moderator) {
    recordModelStatus(meetingId, moderator, 'skipped', emit, `moderator unavailable; switched to ${activeModerator}`)
  }

  return { adapters, activeParticipants, moderator: activeModerator, fileDelivery }
}

async function uploadOriginalFiles(
  meetingId: string,
  model: MeetingModelName,
  adapter: SiteAdapter,
  files: MeetingFileRow[],
  emit: Emit,
): Promise<boolean> {
  const originalFilePaths = files.map(f => f.original_path).filter(Boolean)
  if (!originalFilePaths.length) return false
  if (!adapter.uploadFiles) {
    console.warn(`[meeting ${meetingId}] ${model} has no file upload hook; using text fallback`)
    for (const file of files) {
      recordFileDelivery(meetingId, model, 'fallback', emit, {
        filename: file.filename,
        method: 'text-fallback',
        detail: 'adapter has no file upload hook',
      })
    }
    return false
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      recordFileDelivery(meetingId, model, 'trying', emit, { attempt, detail: 'uploading original files' })
      await adapter.focus?.()
      const ok = await adapter.uploadFiles(originalFilePaths)
      if (ok) {
        for (const file of files) {
          recordFileDelivery(meetingId, model, 'uploaded', emit, {
            filename: file.filename,
            method: 'original-upload',
            attempt,
          })
        }
        console.log(`[meeting ${meetingId}] uploaded original files to ${model} on attempt ${attempt}`)
        return true
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      recordFileDelivery(meetingId, model, 'error', emit, { attempt, detail })
      console.warn(`[meeting ${meetingId}] original file upload failed for ${model} on attempt ${attempt}:`, err)
    }
    await new Promise(r => setTimeout(r, 1000))
  }

  for (const file of files) {
    recordFileDelivery(meetingId, model, 'fallback', emit, {
      filename: file.filename,
      method: 'text-fallback',
      detail: 'original upload failed after two attempts',
    })
  }
  console.warn(`[meeting ${meetingId}] original file upload unavailable for ${model}; using text fallback`)
  return false
}

export async function runMeeting(
  meetingId: string,
  input: CreateMeetingInput,
  cdp: CDPSession,
  emit: Emit,
): Promise<void> {
  runningMeetings.add(meetingId)
  try {
    await runMeetingInner(meetingId, input, cdp, emit)
  } finally {
    runningMeetings.delete(meetingId)
    humanNoteQueue.delete(meetingId)
  }
}

async function runMeetingInner(
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
  const agendaRounds = Math.min(5, Math.max(1, Number(input.agendaRounds ?? meeting.agenda_rounds ?? 1)))
  const modelPostures: ModelPostures = {
    ...safeParsePostures(meeting.model_postures_json),
    ...(input.modelPostures ?? {}),
  }
  const configs: MeetingModelConfigs = {
    ...DEFAULT_MEETING_MODEL_CONFIGS,
    ...input.modelConfigs,
    deepseek: input.modelConfigs?.deepseek ?? DEFAULT_MEETING_MODEL_CONFIGS.deepseek,
    chatgpt: input.modelConfigs?.chatgpt ?? DEFAULT_MEETING_MODEL_CONFIGS.chatgpt,
    gemini: input.modelConfigs?.gemini ?? DEFAULT_MEETING_MODEL_CONFIGS.gemini,
  }

  const { adapters, activeParticipants, moderator, fileDelivery } = await prepareAdapters(
    meetingId,
    cdp,
    input.participants,
    input.moderator,
    configs,
    storedFiles,
    emit,
  )

  const baseCtx: Omit<MeetingContext, 'files'> = {
    title: input.title,
    goal: input.goal,
    mode: input.mode,
    agendaRounds,
    participants: activeParticipants,
    moderator,
    modelPostures,
  }

  // Even when the original file was attached in the chat UI, we still pass a
  // trimmed text excerpt as a backup: some sites silently drop or fail to
  // ingest an attachment, and without this the model would be left blind.
  const BACKUP_EXCERPT_CHARS = 4_000
  const ctxFor = (model: MeetingModelName): MeetingContext => ({
    ...baseCtx,
    files: fileDelivery[model] === 'original-upload'
      ? storedFiles.map(f => {
          const excerpt = f.content.length > BACKUP_EXCERPT_CHARS
            ? `${f.content.slice(0, BACKUP_EXCERPT_CHARS)}\n\n[文本兜底摘录已截断，完整内容以聊天窗口中附上的原文件为准。]`
            : f.content
          return {
            filename: f.filename,
            content: `[原文件已直接上传到本次会话：${f.filename}，请优先以聊天窗口中的附件为准。若网站未能正确读取附件，可改用下面的文本兜底摘录，并明确说明你是基于摘录而非完整附件作答。]\n\n${excerpt}`,
          }
        })
      : storedFiles.map(f => ({ filename: f.filename, content: f.content })),
  })
  const agendaSummaries: { question: string; summary: string }[] = []
  const failedModels = new Set<MeetingModelName>()
  let turnIndex = 0

  const runnableParticipants = () => activeParticipants.filter(model => !failedModels.has(model) && adapters[model])

  const runParticipantTurn = async (args: {
    agendaId: number
    agendaIndex: number
    question: string
    model: MeetingModelName
    roundIndex: number
    previousTurns: MeetingTurnInput[]
    humanNotes?: string[]
  }): Promise<MeetingTurnInput | null> => {
    const adapter = adapters[args.model]
    if (!adapter) return null
    try {
      const content = await runModelTurn({
        meetingId,
        agendaId: args.agendaId,
        turnIndex: turnIndex++,
        roundIndex: args.roundIndex,
        role: 'participant',
        model: args.model,
        adapter,
        prompt: agendaPrompt({
          ctx: ctxFor(args.model),
          agendaIndex: args.agendaIndex,
          roundIndex: args.roundIndex,
          question: args.question,
          model: args.model,
          previousTurns: args.previousTurns,
          humanNotes: args.humanNotes,
        }),
        emit,
      })
      return { model: args.model, content, roundIndex: args.roundIndex }
    } catch {
      failedModels.add(args.model)
      return null
    }
  }

  const runSummaryTurn = async (args: {
    agendaId: number | null
    agendaIndex?: number
    question?: string
    turns?: MeetingTurnInput[]
    agendaSummaries?: { question: string; summary: string }[]
    finalSummary?: string
    humanNotes?: string[]
    role: 'agenda_summary' | 'final_summary' | 'minutes'
  }): Promise<{ model: MeetingModelName; content: string }> => {
    const candidates = [moderator, ...activeParticipants.filter(model => model !== moderator)]
      .filter(model => !failedModels.has(model) && adapters[model])

    for (const model of candidates) {
      const adapter = adapters[model]
      if (!adapter) continue
      try {
        const content = await runModelTurn({
          meetingId,
          agendaId: args.agendaId,
          turnIndex: turnIndex++,
          role: args.role,
          model,
          adapter,
          prompt: args.role === 'agenda_summary'
            ? agendaSummaryPrompt({
                ctx: ctxFor(model),
                agendaIndex: args.agendaIndex ?? 0,
                question: args.question ?? '',
                turns: args.turns ?? [],
                humanNotes: args.humanNotes,
              })
            : args.role === 'minutes'
            ? minutesExtractionPrompt({
                ctx: ctxFor(model),
                agendaSummaries: args.agendaSummaries ?? [],
                finalSummary: args.finalSummary ?? '',
              })
            : finalSummaryPrompt({ ctx: ctxFor(model), agendaSummaries: args.agendaSummaries ?? [] }),
          emit,
        })
        return { model, content }
      } catch {
        failedModels.add(model)
      }
    }

    throw new Error('No available moderator model can summarize the meeting')
  }

  for (let agendaIndex = 0; agendaIndex < storedAgenda.length; agendaIndex++) {
    const item: AgendaItemRow = storedAgenda[agendaIndex]
    emit({ type: 'agenda_started', meetingId, agendaId: item.id, agendaIndex, question: item.question })
    const turns: MeetingTurnInput[] = []
    // All human-moderator interventions raised during this agenda, so the
    // agenda summary can reflect anything raised in the final round too.
    const agendaHumanNotes: string[] = []

    for (let roundIndex = 0; roundIndex < agendaRounds; roundIndex++) {
      const roundParticipants = runnableParticipants()
      if (!roundParticipants.length) break

      // Pick up anything the human chair submitted since the last round and
      // surface it in the live transcript before the models respond to it.
      const humanNotes = drainHumanNotes(meetingId)
      if (humanNotes.length) {
        agendaHumanNotes.push(...humanNotes)
        for (const note of humanNotes) emit({ type: 'human_note', meetingId, agendaId: item.id, content: note })
      }

      if (input.mode === 'parallel') {
        const previousTurns = [...turns]
        const results = await Promise.all(roundParticipants.map(model =>
          runParticipantTurn({ agendaId: item.id, agendaIndex, roundIndex, question: item.question, model, previousTurns, humanNotes })
        ))
        turns.push(...results.filter((result): result is MeetingTurnInput => !!result))
      } else {
        for (const model of roundParticipants) {
          const result = await runParticipantTurn({
            agendaId: item.id,
            agendaIndex,
            roundIndex,
            question: item.question,
            model,
            previousTurns: turns,
            humanNotes,
          })
          if (result) turns.push(result)
        }
      }
    }

    if (!turns.length) throw new Error(`No model produced a usable answer for agenda ${agendaIndex + 1}`)

    // Drain any note submitted during the final round so the summary addresses it.
    const tailNotes = drainHumanNotes(meetingId)
    if (tailNotes.length) {
      agendaHumanNotes.push(...tailNotes)
      for (const note of tailNotes) emit({ type: 'human_note', meetingId, agendaId: item.id, content: note })
    }

    const { content: summary } = await runSummaryTurn({
      agendaId: item.id,
      agendaIndex,
      question: item.question,
      turns,
      humanNotes: agendaHumanNotes,
      role: 'agenda_summary',
    })
    agendaItems.updateSummary(item.id, summary)
    agendaSummaries.push({ question: item.question, summary })
    emit({ type: 'agenda_summary', meetingId, agendaId: item.id, agendaIndex, content: summary })
  }

  const { content: finalSummary } = await runSummaryTurn({
    agendaId: null,
    role: 'final_summary',
    agendaSummaries,
  })

  // Extract structured action items + carry-forward problems from the minutes.
  // Best-effort: a parse/model failure must not fail an otherwise-good meeting.
  let structured: StructuredMinutes = { ...EMPTY_MINUTES }
  try {
    const { content: rawMinutes } = await runSummaryTurn({
      agendaId: null,
      role: 'minutes',
      agendaSummaries,
      finalSummary,
    })
    structured = parseStructuredMinutes(rawMinutes)
  } catch (err) {
    console.warn(`[meeting ${meetingId}] structured minutes extraction failed:`, err)
  }

  const freshMeeting = meetings.get(meetingId)
  if (!freshMeeting) throw new Error(`meeting record lost before archiving: ${meetingId}`)
  const archive = archiveMeeting({
    meeting: freshMeeting,
    files: meetingFiles.listByMeeting(meetingId),
    agenda: agendaItems.listByMeeting(meetingId),
    messages: meetingMessages.listByMeeting(meetingId),
    finalSummary,
  })
  meetingArtifacts.upsert(meetingId, finalSummary, archive.archiveDir, archive.summaryPath, archive.jsonPath, JSON.stringify(structured))
  meetings.setArchive(meetingId, archive.archiveDir, archive.summaryPath, archive.jsonPath)
  meetings.markDone(meetingId)
  emit({ type: 'final_summary', meetingId, content: finalSummary, ...archive })
  emit({ type: 'structured_minutes', meetingId, actionItems: structured.actionItems, openProblems: structured.openProblems })
  emit({ type: 'done', meetingId })
  await cdp.openUrl(`${APP_ORIGIN}/meetings/${meetingId}`).catch(() => {})
  console.log(`[meeting ${meetingId}] done: ${archive.summaryPath}`)
  await notifyMeetingDone(input.title, archive.summaryPath)
}
