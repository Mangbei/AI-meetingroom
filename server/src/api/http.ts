import express, { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { CDPSession } from '../browser/cdp.js'
import { ADAPTER_REGISTRY, MEETING_MODELS } from '../browser/adapters/index.js'
import type { MeetingModelName } from '../browser/adapters/index.js'
import type { RuntimeStatus } from '../browser/adapters/base.js'
import {
  agendaItems,
  meetingArtifacts,
  meetingFiles,
  meetingLogs,
  meetingMessages,
  meetings,
} from '../storage/repository.js'
import { runMeeting, type CreateMeetingInput, type MeetingEvent } from '../meeting/meeting.js'
import { renderMeetingMarkdown } from '../meeting/archive.js'
import {
  ACCEPTED_FILE_EXTENSIONS,
  kindFromFilename,
  prepareMeetingFiles,
  type UploadedMeetingFile,
} from '../meeting/files.js'

type WsClients = Map<string, Set<(event: MeetingEvent) => void>>

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

export function createRouter(cdp: CDPSession, wsClients: WsClients): Router {
  const router = Router()
  router.use(express.json({ limit: '80mb' }))

  router.post('/meetings', async (req, res) => {
    try {
      const body = req.body as Partial<CreateMeetingInput> & {
        confirmations?: Partial<Record<MeetingModelName, boolean>>
      }
      const title = (body.title ?? '').trim()
      const goal = (body.goal ?? '').trim()
      const mode = body.mode === 'parallel' ? 'parallel' : 'relay'
      const participants = pickModels(body.participants)
      const moderator = body.moderator as MeetingModelName | undefined
      const agenda = (body.agenda ?? []).map(q => q.trim()).filter(Boolean)
      const files = (body.files ?? []) as UploadedMeetingFile[]

      if (!title || !goal) return res.status(400).json({ error: '会议标题和会议目标必填' })
      if (participants.length < 2 || participants.length > 5) {
        return res.status(400).json({ error: '请选择 2 到 5 位参会模型；当前已接入 ChatGPT、Gemini、DeepSeek' })
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
        if (!kindFromFilename(file.filename)) {
          return res.status(400).json({
            error: `暂不支持该文件格式：${file.filename}。当前支持：${ACCEPTED_FILE_EXTENSIONS.join(', ')}`,
          })
        }
      }

      const id = uuid()
      const preparedFiles = await prepareMeetingFiles(id, files)
      meetings.create({ id, title, goal, mode, participants, moderator })
      preparedFiles.forEach(file => meetingFiles.insert(id, file.filename, file.kind, file.content, file.originalPath))
      agenda.forEach((question, position) => agendaItems.insert(id, position, question))

      res.json({ id })

      const input: CreateMeetingInput = {
        title,
        goal,
        mode,
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
