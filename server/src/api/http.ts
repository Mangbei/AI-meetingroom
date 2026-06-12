import express, { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { CDPSession } from '../browser/cdp.js'
import { ADAPTER_REGISTRY, DEFAULT_MEETING_MODEL_CONFIGS, MEETING_MODELS } from '../browser/adapters/index.js'
import type { MeetingModelName } from '../browser/adapters/index.js'
import type { ModelConfig, RuntimeStatus } from '../browser/adapters/base.js'
import {
  agendaItems,
  meetingArtifacts,
  meetingFiles,
  meetingLogs,
  meetingMessages,
  meetings,
} from '../storage/repository.js'
import { runMeeting, addHumanNote, isMeetingRunning, type CreateMeetingInput, type MeetingEvent } from '../meeting/meeting.js'
import { safeParseMinutes } from '../meeting/minutes.js'
import { renderMeetingMarkdown } from '../meeting/archive.js'
import {
  agendaDraftPrompt,
  type MeetingContext,
  type ModelPosture,
  type ModelPostures,
} from '../meeting/prompts.js'
import {
  ACCEPTED_FILE_EXTENSIONS,
  isAcceptableUpload,
  prepareMeetingFiles,
  type PreparedMeetingFile,
  type UploadedMeetingFile,
} from '../meeting/files.js'

type WsClients = Map<string, Set<(event: MeetingEvent) => void>>
const MODEL_POSTURES = new Set<ModelPosture>(['cooperative', 'balanced', 'critical'])

interface AgendaDraftRecord {
  id: string
  title: string
  goal: string
  mode: 'relay' | 'parallel'
  agendaRounds: number
  participants: MeetingModelName[]
  moderator: MeetingModelName
  modelPostures: ModelPostures
  preparedFiles: PreparedMeetingFile[]
  suggestedAgenda: string[]
  raw: string
  warning: string
  createdAt: number
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs)
    promise
      .then(value => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(fallback)
      })
  })
}

function pickModels(value: unknown): MeetingModelName[] {
  if (!Array.isArray(value)) return [...MEETING_MODELS]
  const seen = new Set<MeetingModelName>()
  for (const raw of value) {
    if (MEETING_MODELS.includes(raw as MeetingModelName)) seen.add(raw as MeetingModelName)
  }
  return [...seen]
}

function pickAgendaRounds(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 2
  return Math.min(5, Math.max(1, Math.floor(parsed)))
}

function pickModelPostures(value: unknown, participants: MeetingModelName[]): ModelPostures {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  const result: ModelPostures = {}
  for (const model of participants) {
    const posture = input[model]
    if (typeof posture === 'string' && MODEL_POSTURES.has(posture as ModelPosture)) result[model] = posture as ModelPosture
  }
  return result
}

function defaultRuntimeStatus(model: MeetingModelName, loggedIn: boolean, warning?: string): RuntimeStatus {
  return {
    loggedIn,
    requestedModel: model === 'chatgpt'
      ? 'Highest thinking model'
      : model === 'gemini'
        ? 'Gemini Pro'
        : 'DeepSeek R1 / 深度思考',
    configured: model === 'deepseek' && loggedIn,
    needsManualConfirmation: model !== 'deepseek',
    warning,
  }
}

function fallbackAgenda(goal: string, seedAgenda: string[]): string[] {
  const cleaned = seedAgenda.map(item => item.trim()).filter(Boolean)
  if (cleaned.length >= 3) return cleaned.slice(0, 5)
  return [
    `基于当前资料，先判断这个主题最值得讨论的核心问题是什么？`,
    `围绕“${goal.slice(0, 42) || '会议目标'}”，有哪些主要方案、方向或候选路径值得比较？`,
    '目前材料中最强的证据、最薄弱的假设和最大的风险分别是什么？',
    '如果要马上推进，下一步应该采取什么具体行动，并如何验证效果？',
  ].slice(0, 5)
}

function parseAgendaDraft(text: string, goal: string, seedAgenda: string[]): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*(?:[-*]|\d+[.)、]|[（(]\d+[）)])\s*/, '')
      .replace(/^议程\s*\d+\s*[:：-]?\s*/i, '')
      .trim())
    .filter(line => line.length >= 6 && !/^#+\s*/.test(line))

  const seen = new Set<string>()
  const agenda: string[] = []
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, '')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    agenda.push(line.length > 180 ? `${line.slice(0, 180)}...` : line)
    if (agenda.length >= 5) break
  }

  return agenda.length >= 3 ? agenda : fallbackAgenda(goal, seedAgenda)
}

export function createRouter(cdp: CDPSession, wsClients: WsClients): Router {
  const router = Router()
  const agendaDrafts = new Map<string, AgendaDraftRecord>()
  // Drafts are an in-memory staging area before a meeting starts. Evict stale
  // ones so abandoned drafts (generated but never started) don't accumulate.
  const DRAFT_TTL_MS = 30 * 60 * 1000
  setInterval(() => {
    const now = Date.now()
    for (const [id, draft] of agendaDrafts) {
      if (now - draft.createdAt > DRAFT_TTL_MS) agendaDrafts.delete(id)
    }
  }, 5 * 60 * 1000).unref()
  router.use(express.json({ limit: '80mb' }))

  // Opt-in bearer-token auth: only enforced when MEETING_API_TOKEN is set, so
  // default local use (and the bundled web UI) is unaffected. Enable it when
  // exposing the API to agents/headless callers over a shared port.
  const apiToken = process.env.MEETING_API_TOKEN
  if (apiToken) {
    router.use((req, res, next) => {
      const header = req.header('authorization') ?? ''
      const provided = header.startsWith('Bearer ') ? header.slice(7) : (req.header('x-api-token') ?? '')
      if (provided === apiToken) return next()
      return res.status(401).json({ error: 'unauthorized: missing or invalid API token' })
    })
  }

  router.post('/meetings/agenda-draft', async (req, res) => {
    try {
      const body = req.body as Partial<CreateMeetingInput> & {
        confirmations?: Partial<Record<MeetingModelName, boolean>>
      }
      const title = (body.title ?? '').trim()
      const goal = (body.goal ?? '').trim()
      const mode = body.mode === 'parallel' ? 'parallel' : 'relay'
      const participants = pickModels(body.participants)
      const agendaRounds = pickAgendaRounds(body.agendaRounds)
      const modelPostures = pickModelPostures(body.modelPostures, participants)
      const moderator = body.moderator as MeetingModelName | undefined
      const seedAgenda = (body.agenda ?? []).map(q => q.trim()).filter(Boolean)
      const files = (body.files ?? []) as UploadedMeetingFile[]

      if (!title || !goal) return res.status(400).json({ error: '会议标题和会议目标必填' })
      if (participants.length < 2 || participants.length > 5) {
        return res.status(400).json({ error: '请选择 2 到 5 位参会模型' })
      }
      if (!moderator || !participants.includes(moderator)) {
        return res.status(400).json({ error: '主持人必须是参会模型之一' })
      }
      if (!body.confirmations?.[moderator]) {
        return res.status(400).json({ error: `请先确认主持人 ${moderator} 已选择最高可用模型` })
      }
      for (const file of files) {
        if (!file.filename || (!file.dataBase64 && file.content == null)) {
          return res.status(400).json({ error: '上传文件需要文件名和原始内容' })
        }
        if (!isAcceptableUpload(file)) {
          return res.status(400).json({
            error: `暂不支持该文件格式：${file.filename}。支持常见文档（${ACCEPTED_FILE_EXTENSIONS.slice(0, 9).join(', ')} 等）、代码与文本文件。`,
          })
        }
      }

      const draftId = `draft-${uuid()}`
      const preparedFiles = await prepareMeetingFiles(draftId, files)
      const ctx: MeetingContext = {
        title,
        goal,
        mode,
        agendaRounds,
        participants,
        moderator,
        modelPostures,
        files: preparedFiles.map(file => ({ filename: file.filename, content: file.content })),
      }

      const prompt = agendaDraftPrompt({ ctx, seedAgenda })
      const useProvidedAgenda = (req.body as { useProvidedAgenda?: boolean }).useProvidedAgenda === true
      let raw = ''
      let warning = ''
      let agenda: string[]
      if (useProvidedAgenda && seedAgenda.length) {
        // User opted to use their own agenda verbatim — skip the moderator
        // re-draft entirely. They can still tweak it on the review page.
        agenda = seedAgenda.slice(0, 5)
      } else {
        try {
          const page = await cdp.ensurePage(moderator)
          const adapter = ADAPTER_REGISTRY[moderator].ctor()
          adapter.setPage(page)
          await adapter.ensureReady()
          await adapter.newConversation()
          if (adapter.configure) await adapter.configure(DEFAULT_MEETING_MODEL_CONFIGS[moderator] as ModelConfig)
          await adapter.focus?.()
          await adapter.sendMessage(prompt)
          raw = await adapter.streamResponse(() => {})
        } catch (err) {
          warning = `主持人网页生成议程失败，已使用本地保底议程：${err instanceof Error ? err.message : String(err)}`
        }
        agenda = parseAgendaDraft(raw, goal, seedAgenda)
      }

      agendaDrafts.set(draftId, {
        id: draftId,
        title,
        goal,
        mode,
        agendaRounds,
        participants,
        moderator,
        modelPostures,
        preparedFiles,
        suggestedAgenda: agenda,
        raw,
        warning,
        createdAt: Date.now(),
      })
      res.json({ draftId, agenda, raw, warning })
    } catch (err) {
      console.error('[agenda draft] failed:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.get('/meetings/agenda-drafts/:draftId', (req, res) => {
    const draft = agendaDrafts.get(req.params.draftId)
    if (!draft) return res.status(404).json({ error: 'agenda draft not found or expired' })
    res.json({
      id: draft.id,
      title: draft.title,
      goal: draft.goal,
      mode: draft.mode,
      agendaRounds: draft.agendaRounds,
      participants: draft.participants,
      moderator: draft.moderator,
      modelPostures: draft.modelPostures,
      suggestedAgenda: draft.suggestedAgenda,
      raw: draft.raw,
      warning: draft.warning,
      createdAt: draft.createdAt,
      files: draft.preparedFiles.map(file => ({
        filename: file.filename,
        kind: file.kind,
        size: file.size,
      })),
    })
  })

  router.post('/meetings/agenda-drafts/:draftId/start', async (req, res) => {
    try {
      const draft = agendaDrafts.get(req.params.draftId)
      if (!draft) return res.status(404).json({ error: 'agenda draft not found or expired' })
      const agenda = ((req.body?.agenda ?? draft.suggestedAgenda) as unknown[])
        .map(item => String(item ?? '').trim())
        .filter(Boolean)
      if (agenda.length === 0) return res.status(400).json({ error: '至少需要一个议程问题' })

      const id = uuid()
      meetings.create({
        id,
        title: draft.title,
        goal: draft.goal,
        mode: draft.mode,
        agendaRounds: draft.agendaRounds,
        modelPostures: draft.modelPostures,
        participants: draft.participants,
        moderator: draft.moderator,
      })
      draft.preparedFiles.forEach(file => meetingFiles.insert(id, file.filename, file.kind, file.content, file.originalPath))
      agenda.forEach((question, position) => agendaItems.insert(id, position, question))
      agendaDrafts.delete(req.params.draftId)

      res.json({ id })

      const input: CreateMeetingInput = {
        title: draft.title,
        goal: draft.goal,
        mode: draft.mode,
        agendaRounds: draft.agendaRounds,
        modelPostures: draft.modelPostures,
        participants: draft.participants,
        moderator: draft.moderator,
        agenda,
        files: draft.preparedFiles.map(file => ({
          filename: file.filename,
          kind: file.kind,
          content: file.content,
        })),
      }
      const emit = (event: MeetingEvent) => {
        const listeners = wsClients.get(id)
        listeners?.forEach(fn => fn(event))
      }
      runMeeting(id, input, cdp, emit).catch(err => {
        console.error('[meeting] fatal error:', err)
        emit({ type: 'error', meetingId: id, error: String(err) })
        meetings.setStatus(id, 'error')
      })
    } catch (err) {
      console.error('[agenda draft start] failed:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/meetings', async (req, res) => {
    try {
      const body = req.body as Partial<CreateMeetingInput> & {
        confirmations?: Partial<Record<MeetingModelName, boolean>>
      }
      const title = (body.title ?? '').trim()
      const goal = (body.goal ?? '').trim()
      const mode = body.mode === 'parallel' ? 'parallel' : 'relay'
      const participants = pickModels(body.participants)
      const agendaRounds = pickAgendaRounds(body.agendaRounds)
      const modelPostures = pickModelPostures(body.modelPostures, participants)
      const moderator = body.moderator as MeetingModelName | undefined
      const agenda = (body.agenda ?? []).map(q => q.trim()).filter(Boolean)
      const files = (body.files ?? []) as UploadedMeetingFile[]

      if (!title || !goal) return res.status(400).json({ error: '会议标题和会议目标必填' })
      if (participants.length < 2 || participants.length > 5) {
        return res.status(400).json({ error: '请选择 2 到 5 位参会模型' })
      }
      if (!moderator || !participants.includes(moderator)) {
        return res.status(400).json({ error: '主持人必须是参会模型之一' })
      }
      if (agenda.length === 0) return res.status(400).json({ error: '至少需要一个议程问题' })
      for (const model of participants) {
        if (!body.confirmations?.[model]) {
          return res.status(400).json({ error: `请先确认 ${model} 已选择最高可用模型` })
        }
      }
      for (const file of files) {
        if (!file.filename || (!file.dataBase64 && file.content == null)) {
          return res.status(400).json({ error: '上传文件需要文件名和原始内容' })
        }
        if (!isAcceptableUpload(file)) {
          return res.status(400).json({
            error: `暂不支持该文件格式：${file.filename}。支持常见文档（${ACCEPTED_FILE_EXTENSIONS.slice(0, 9).join(', ')} 等）、代码与文本文件。`,
          })
        }
      }

      const id = uuid()
      const preparedFiles = await prepareMeetingFiles(id, files)
      meetings.create({ id, title, goal, mode, agendaRounds, modelPostures, participants, moderator })
      preparedFiles.forEach(file => meetingFiles.insert(id, file.filename, file.kind, file.content, file.originalPath))
      agenda.forEach((question, position) => agendaItems.insert(id, position, question))

      res.json({ id })

      const input: CreateMeetingInput = {
        title,
        goal,
        mode,
        agendaRounds,
        modelPostures,
        participants,
        moderator,
        agenda,
        files: preparedFiles.map(file => ({
          filename: file.filename,
          kind: file.kind,
          content: file.content,
        })),
        modelConfigs: body.modelConfigs,
      }
      const emit = (event: MeetingEvent) => {
        const listeners = wsClients.get(id)
        listeners?.forEach(fn => fn(event))
      }
      runMeeting(id, input, cdp, emit).catch(err => {
        console.error('[meeting] fatal error:', err)
        emit({ type: 'error', meetingId: id, error: String(err) })
        meetings.setStatus(id, 'error')
      })
    } catch (err) {
      console.error('[meetings create] failed:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.get('/meetings', (_req, res) => {
    res.json(meetings.list())
  })

  router.get('/meetings/:id', (req, res) => {
    const meeting = meetings.get(req.params.id)
    if (!meeting) return res.status(404).json({ error: 'not found' })
    res.json({
      meeting,
      files: meetingFiles.listByMeeting(req.params.id).map(f => ({ ...f, content: undefined })),
      agenda: agendaItems.listByMeeting(req.params.id),
      messages: meetingMessages.listByMeeting(req.params.id),
      logs: meetingLogs.listByMeeting(req.params.id),
      artifact: meetingArtifacts.get(req.params.id),
    })
  })

  router.get(['/meetings/:id/export', '/meetings/:id/export/:filename'], (req, res) => {
    const meeting = meetings.get(req.params.id)
    if (!meeting) return res.status(404).json({ error: 'not found' })
    const artifact = meetingArtifacts.get(req.params.id)
    const md = renderMeetingMarkdown({
      meeting,
      files: meetingFiles.listByMeeting(req.params.id),
      agenda: agendaItems.listByMeeting(req.params.id),
      messages: meetingMessages.listByMeeting(req.params.id),
      finalSummary: artifact?.final_summary ?? '',
    })
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="meeting-${meeting.id.slice(0, 8)}.md"`)
    res.send(md)
  })

  // Human-moderator intervention: inject a note/question into a running meeting.
  // The note is queued and folded into the next round's prompts so the models
  // must respond, and echoed to all live viewers immediately.
  router.post('/meetings/:id/intervene', (req, res) => {
    const id = req.params.id
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text) return res.status(400).json({ error: 'empty note' })
    if (text.length > 2000) return res.status(400).json({ error: 'note too long' })
    if (!meetings.get(id)) return res.status(404).json({ error: 'meeting not found' })
    if (!isMeetingRunning(id)) return res.status(409).json({ error: 'meeting is not running' })

    addHumanNote(id, text)
    const listeners = wsClients.get(id)
    if (listeners) for (const send of listeners) send({ type: 'human_note', meetingId: id, content: text })
    res.json({ ok: true })
  })

  // Carry-forward: open a follow-up meeting seeded with the unresolved problems
  // from a finished meeting, plus a synthesized brief of the prior conclusions.
  router.post('/meetings/:id/continue', async (req, res) => {
    try {
      const prior = meetings.get(req.params.id)
      if (!prior) return res.status(404).json({ error: 'meeting not found' })

      const artifact = meetingArtifacts.get(req.params.id)
      const minutes = safeParseMinutes(artifact?.structured_json)
      const bodyProblems = Array.isArray(req.body?.problems)
        ? (req.body.problems as unknown[]).map(p => String(p ?? '').trim()).filter(Boolean)
        : []
      const problems = bodyProblems.length ? bodyProblems : minutes.openProblems.map(p => p.problem)
      if (!problems.length) {
        return res.status(400).json({ error: '本次会议没有标记为未解决的问题，无法自动续会' })
      }

      const agenda = problems.slice(0, 5)
      const participants = JSON.parse(prior.participants_json) as MeetingModelName[]
      let modelPostures: Record<string, string> = {}
      try { modelPostures = JSON.parse(prior.model_postures_json) } catch { /* keep default */ }

      const briefName = `上一场会议背景-${prior.title}.md`.replace(/[/\\]/g, '_').slice(0, 120)
      const brief = [
        `# 上一场会议背景：${prior.title}`,
        '',
        `## 上一场最终纪要`,
        artifact?.final_summary || '（无最终纪要）',
        '',
        `## 待本次续会解决的未决问题`,
        ...(minutes.openProblems.length
          ? minutes.openProblems.map((p, i) => `${i + 1}. ${p.problem}${p.why ? `（仍未解决的原因：${p.why}）` : ''}`)
          : agenda.map((q, i) => `${i + 1}. ${q}`)),
      ].join('\n')

      const id = uuid()
      const title = `续会 · ${prior.title}`.slice(0, 200)
      meetings.create({
        id,
        title,
        goal: prior.goal,
        mode: prior.mode,
        agendaRounds: prior.agenda_rounds,
        modelPostures,
        participants,
        moderator: prior.moderator,
      })
      meetingFiles.insert(id, briefName, 'md', brief, '')
      agenda.forEach((question, position) => agendaItems.insert(id, position, question))

      res.json({ id })

      const input: CreateMeetingInput = {
        title,
        goal: prior.goal,
        mode: prior.mode,
        agendaRounds: prior.agenda_rounds,
        modelPostures: modelPostures as CreateMeetingInput['modelPostures'],
        participants,
        moderator: prior.moderator,
        agenda,
        files: [{ filename: briefName, kind: 'md', content: brief }],
      }
      const emit = (event: MeetingEvent) => {
        wsClients.get(id)?.forEach(fn => fn(event))
      }
      runMeeting(id, input, cdp, emit).catch(err => {
        console.error('[meeting continue] fatal error:', err)
        emit({ type: 'error', meetingId: id, error: String(err) })
        meetings.setStatus(id, 'error')
      })
    } catch (err) {
      console.error('[meeting continue] failed:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  router.post('/meetings/:id/messages/refetch', async (req, res) => {
    const { agendaId, model } = req.body as { agendaId?: number | null; model?: MeetingModelName }
    if (!model || !MEETING_MODELS.includes(model)) return res.status(400).json({ error: 'unknown model' })
    const meeting = meetings.get(req.params.id)
    if (!meeting) return res.status(404).json({ error: 'meeting not found' })

    try {
      const page = await cdp.ensurePage(model)
      const adapter = ADAPTER_REGISTRY[model].ctor()
      adapter.setPage(page)
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await adapter.ensureReady()
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        if (await adapter.hasAssistantMessage()) break
        await new Promise(r => setTimeout(r, 500))
      }
      const content = await adapter.readLastAssistantMessage()
      if (!content.trim()) return res.status(409).json({ error: 'live tab has no assistant message to capture' })
      const updated = meetingMessages.updateLatest(req.params.id, agendaId ?? null, model, content)
      if (!updated) return res.status(404).json({ error: 'no prior message row to update' })
      res.json({ ok: true, content, length: content.length })
    } catch (err) {
      console.error('[meeting refetch] failed:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  router.post('/browser/open-meeting-tabs', async (req, res) => {
    try {
      const requested = pickModels(req.body?.models)
      const opened = await cdp.openSites(requested.length ? requested : [...MEETING_MODELS])
      res.json({ ok: true, opened })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.post('/browser/open-app', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url : 'http://localhost:5173/meetings/new'
      const opened = await cdp.openUrl(url)
      res.json({ ok: true, opened })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/status', async (req, res) => {
    try {
      const models = typeof req.query.models === 'string'
        ? pickModels(String(req.query.models).split(','))
        : [...MEETING_MODELS]
      const entries = await Promise.all(models.map(async model => {
        const basicLoggedIn = await withTimeout(cdp.checkLoginStatus(model), 6_000, false)
        const fallback = defaultRuntimeStatus(
          model,
          basicLoggedIn,
          basicLoggedIn ? undefined : 'Login check timed out or found a logged-out page.',
        )

        const runtime = await withTimeout((async () => {
          const page = await cdp.ensurePage(model)
          const adapter = ADAPTER_REGISTRY[model].ctor()
          adapter.setPage(page)
          if (!adapter.getRuntimeStatus) return fallback
          const status = await adapter.getRuntimeStatus()
          return { ...status, loggedIn: status.loggedIn || basicLoggedIn }
        })(), 10_000, fallback)

        return [model, runtime] as const
      }))

      const runtimeStatus = Object.fromEntries(entries)
      const loginStatus = Object.fromEntries(entries.map(([model, status]) => [model, status.loggedIn]))
      res.json({ ready: true, loginStatus, runtimeStatus })
    } catch (err) {
      res.json({ ready: false, error: String(err) })
    }
  })

  return router
}
