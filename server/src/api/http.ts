import express, { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { CDPSession } from '../browser/cdp.js'
import { ADAPTER_REGISTRY, MEETING_MODELS } from '../browser/adapters/index.js'
import type { MeetingModelName } from '../browser/adapters/index.js'
import {
  agendaItems, meetingArtifacts, meetingFiles, meetingMessages, meetings,
} from '../storage/repository.js'
import { runMeeting, type CreateMeetingInput, type MeetingEvent, type UploadedMeetingFile } from '../meeting/meeting.js'
import { renderMeetingMarkdown } from '../meeting/archive.js'

type WsClients = Map<string, Set<(event: MeetingEvent) => void>>

export function createRouter(cdp: CDPSession, wsClients: WsClients): Router {
  const router = Router()
  router.use(express.json({ limit: '12mb' }))

  router.post('/meetings', async (req, res) => {
    const body = req.body as Partial<CreateMeetingInput> & {
      confirmations?: Partial<Record<MeetingModelName, boolean>>
    }
    const title = (body.title ?? '').trim()
    const goal = (body.goal ?? '').trim()
    const mode = body.mode === 'parallel' ? 'parallel' : 'relay'
    const participants = (body.participants ?? []).filter((m): m is MeetingModelName =>
      MEETING_MODELS.includes(m as MeetingModelName))
    const moderator = body.moderator as MeetingModelName | undefined
    const agenda = (body.agenda ?? []).map(q => q.trim()).filter(Boolean)
    const files = (body.files ?? []) as UploadedMeetingFile[]

    if (!title || !goal) return res.status(400).json({ error: 'title and goal are required' })
    if (participants.length !== 3) return res.status(400).json({ error: '请选择 ChatGPT、Gemini、DeepSeek 三位参会者' })
    if (!moderator || !participants.includes(moderator)) {
      return res.status(400).json({ error: 'moderator must be one of the participants' })
    }
    if (agenda.length === 0) return res.status(400).json({ error: 'at least one agenda question is required' })
    for (const model of participants) {
      if (!body.confirmations?.[model]) {
        return res.status(400).json({ error: `请先确认 ${model} 已选择最高可用模型` })
      }
    }
    for (const file of files) {
      if (!file.filename || !file.content) return res.status(400).json({ error: 'uploaded files require filename and content' })
      const lower = file.filename.toLowerCase()
      if (!lower.endsWith('.txt') && !lower.endsWith('.md')) {
        return res.status(400).json({ error: '首版仅支持 .txt 和 .md 文件' })
      }
    }

    const id = uuid()
    meetings.create({ id, title, goal, mode, participants, moderator })
    files.forEach(file => meetingFiles.insert(id, file.filename, file.kind, file.content))
    agenda.forEach((question, position) => agendaItems.insert(id, position, question))

    res.json({ id })

    const input: CreateMeetingInput = {
      title, goal, mode, participants, moderator, agenda, files,
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

  router.post('/browser/open-meeting-tabs', async (_req, res) => {
    try {
      const opened = await cdp.openSites([...MEETING_MODELS])
      res.json({ ok: true, opened })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // GET /api/status — browser readiness
  router.get('/status', async (_req, res) => {
    try {
      const loginStatus = await cdp.allLoggedIn()
      const runtimeStatus = Object.fromEntries(await Promise.all(MEETING_MODELS.map(async model => {
        try {
          const page = await cdp.ensurePage(model)
          const adapter = ADAPTER_REGISTRY[model].ctor()
          adapter.setPage(page)
          await adapter.ensureReady()
          const status = adapter.getRuntimeStatus
            ? await adapter.getRuntimeStatus()
            : {
                loggedIn: loginStatus[model],
                requestedModel: model === 'chatgpt' ? 'Highest thinking model' :
                  model === 'deepseek' ? 'DeepSeek R1 / 深度思考' : 'Highest available model',
                configured: model === 'deepseek',
                needsManualConfirmation: model !== 'deepseek',
              }
          return [model, status]
        } catch (err) {
          return [model, {
            loggedIn: false,
            configured: false,
            needsManualConfirmation: true,
            warning: String(err),
          }]
        }
      })))
      res.json({ ready: true, loginStatus, runtimeStatus })
    } catch (err) {
      res.json({ ready: false, error: String(err) })
    }
  })

  return router
}
