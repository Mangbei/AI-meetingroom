import express, { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { runDebate, DEFAULT_MODEL_CONFIGS } from '../orchestrator/debate.js'
import type { WSEvent, ModelConfigs, DebatePhase } from '../orchestrator/debate.js'
import { CDPSession } from '../browser/cdp.js'
import { ADAPTER_REGISTRY, MEETING_MODELS, MODELS } from '../browser/adapters/index.js'
import type { DebateModelName, MeetingModelName, ModelName } from '../browser/adapters/index.js'
import {
  agendaItems, debates, meetingArtifacts, meetingFiles, meetingMessages, meetings,
  messages, summaries,
} from '../storage/repository.js'
import { parsePhase5Output } from '../orchestrator/parsers.js'
import { runMeeting, type CreateMeetingInput, type MeetingEvent, type UploadedMeetingFile } from '../meeting/meeting.js'
import { renderMeetingMarkdown } from '../meeting/archive.js'

type WsClients = Map<string, Set<(event: WSEvent | MeetingEvent) => void>>

export function createRouter(cdp: CDPSession, wsClients: WsClients): Router {
  const router = Router()
  router.use(express.json({ limit: '12mb' }))

  // POST /api/debates — create & start a new debate
  router.post('/debates', async (req, res) => {
    const { topic, principles = '', synthesizer, deepseekConfig, claudeConfig } = req.body as {
      topic?: string; principles?: string; synthesizer?: DebateModelName
      deepseekConfig?: ModelConfigs['deepseek']; claudeConfig?: ModelConfigs['claude']
    }
    if (!topic || !synthesizer) {
      return res.status(400).json({ error: 'topic and synthesizer are required' })
    }

    const modelConfigs: ModelConfigs = {
      deepseek: deepseekConfig ?? DEFAULT_MODEL_CONFIGS.deepseek,
      claude: claudeConfig ?? DEFAULT_MODEL_CONFIGS.claude,
      chatgpt: {},
    }

    const id = uuid()
    debates.create({
      id, topic, principles, synthesizer,
      deepseekConfigJson: JSON.stringify(modelConfigs.deepseek),
      claudeConfigJson: JSON.stringify(modelConfigs.claude),
    })

    res.json({ id })

    const emit = (event: WSEvent) => {
      const listeners = wsClients.get(id)
      listeners?.forEach(fn => fn(event))
    }

    runDebate(id, topic, principles, synthesizer, cdp, emit, modelConfigs).catch(err => {
      console.error('[debate] fatal error:', err)
      emit({ type: 'error', debateId: id, error: String(err) })
      debates.setStatus(id, 'error')
    })
  })

  // GET /api/debates — list all
  router.get('/debates', (_req, res) => {
    res.json(debates.list())
  })

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

  // GET /api/debates/:id — detail
  router.get('/debates/:id', (req, res) => {
    const debate = debates.get(req.params.id)
    if (!debate) return res.status(404).json({ error: 'not found' })
    res.json({
      debate,
      messages: messages.listByDebate(req.params.id),
      summary: summaries.get(req.params.id),
    })
  })

  // GET /api/debates/:id/export — Markdown export
  // The :filename segment is decorative — the URL's basename is what the
  // browser uses to name the downloaded file when neither the download
  // attribute nor Content-Disposition is honored (browser extensions,
  // synthetic-click edge cases). Pin it to end in .md so the file always
  // has the right extension. Both /:id/export and /:id/export/:filename
  // are accepted so legacy callers still work.
  router.get(['/debates/:id/export', '/debates/:id/export/:filename'], (req, res) => {
    const debate = debates.get(req.params.id)
    if (!debate) return res.status(404).json({ error: 'not found' })
    const msgs = messages.listByDebate(req.params.id)
    const summary = summaries.get(req.params.id)

    // Phase + model label tables — kept here on purpose; the web mirrors
    // these in lib/phases.ts and lib/models.ts. If these get out of sync
    // the export will just have slightly different labels than the page,
    // not break.
    const PHASE_LABEL: Record<number, { roman: string; name: string }> = {
      2: { roman: 'I',   name: '各自方案' },
      3: { roman: 'II',  name: '匿名互评 + 排名' },
      4: { roman: 'III', name: '作者修订' },
      5: { roman: 'IV',  name: '综合裁决' },
      6: { roman: 'V',   name: '终稿复核' },
    }
    const MODEL_LABEL: Record<string, string> = {
      claude: 'Claude', chatgpt: 'ChatGPT', deepseek: 'DeepSeek',
    }

    // The topic field accepts a pasted markdown document. Use only its
    // first non-empty line (with leading #/list markers stripped) as the
    // H1; the remainder goes into a separate "## 议题原文" section so the
    // export's outline stays clean.
    const topicLines = debate.topic.split('\n')
    const firstNonEmpty = topicLines.findIndex(l => l.trim()) ?? -1
    const firstLine = firstNonEmpty >= 0 ? topicLines[firstNonEmpty].trim() : ''
    const titleLine = firstLine.replace(/^#+\s*/, '').replace(/^[*_>-]+\s*/, '').trim()
    const restLines = firstNonEmpty >= 0 ? topicLines.slice(firstNonEmpty + 1).join('\n').trim() : ''

    const dateStr = new Date(debate.created_at).toLocaleString('zh-CN')

    let md = ''
    md += `# ${titleLine || '（无标题）'}\n\n`
    md += `*综合者 · ${MODEL_LABEL[debate.synthesizer] ?? debate.synthesizer} | ${dateStr}*\n\n`
    if (debate.principles) {
      md += `> **设计原则**：${debate.principles}\n\n`
    }
    if (restLines) {
      md += `## 议题原文\n\n${restLines}\n\n`
    }
    md += `---\n\n`

    let currentPhase = 0
    for (const msg of msgs) {
      if (msg.phase !== currentPhase) {
        currentPhase = msg.phase
        const meta = PHASE_LABEL[currentPhase]
        const header = meta ? `${meta.roman} · ${meta.name}` : `第 ${currentPhase} 阶段`
        md += `## ${header}\n\n`
      }
      md += `### ${MODEL_LABEL[msg.model] ?? msg.model}\n\n${msg.content}\n\n`
    }

    if (summary) {
      md += `## 终稿 · 异同对照 + 关键分歧裁决\n\n${summary.comparison}\n\n`
      md += `## 终稿 · 迭代后的综合方案\n\n${summary.final_proposal}\n\n`
      if (summary.dissent) md += `## 终稿 · 少数派意见\n\n${summary.dissent}\n\n`
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="debate-${debate.id.slice(0, 8)}.md"`)
    res.send(md)
  })

  // DELETE /api/debates/:id — remove debate and all its messages/summary
  router.delete('/debates/:id', (req, res) => {
    const id = req.params.id
    const status = debates.getStatus(id)
    if (!status) return res.status(404).json({ error: 'not found' })
    if (status === 'running' || status === 'pending') {
      return res.status(409).json({ error: '进行中的辩论无法删除' })
    }
    debates.delete(id)
    res.json({ ok: true })
  })

  // POST /api/debates/:id/messages/refetch — recover the LATEST assistant
  // reply from the live model tab and overwrite the stored content. Use
  // when the orchestrator captured an error placeholder (rate limit, JS
  // error) but the model later produced a real reply we want to keep.
  // Body: { phase: 2..6, model: 'claude'|'chatgpt'|'deepseek' }
  router.post('/debates/:id/messages/refetch', async (req, res) => {
    const { phase, model } = req.body as { phase?: DebatePhase; model?: DebateModelName }
    if (!phase || !model) return res.status(400).json({ error: 'phase and model required' })
    if (!MODELS.includes(model)) return res.status(400).json({ error: 'unknown model' })

    const debate = debates.get(req.params.id)
    if (!debate) return res.status(404).json({ error: 'debate not found' })

    try {
      const page = await cdp.ensurePage(model)
      const adapter = ADAPTER_REGISTRY[model].ctor()
      adapter.setPage(page)
      // Reload first — some sites cache a transient error placeholder that
      // gets replaced by the real reply once the page refreshes (most often
      // ChatGPT's "Unusual activity" notice). Then poll the adapter (which
      // owns the per-site selectors) until at least one assistant message
      // renders, up to 15s.
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await adapter.ensureReady()
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        if (await adapter.hasAssistantMessage()) break
        await new Promise(r => setTimeout(r, 500))
      }
      const content = await adapter.readLastAssistantMessage()
      if (!content.trim()) {
        return res.status(409).json({ error: 'live tab has no assistant message to capture' })
      }

      const updated = messages.updateLatest(req.params.id, phase, model, content)
      if (!updated) return res.status(404).json({ error: 'no prior message row to update' })

      // If we just refetched the synthesizer's Phase 5, re-parse the summary.
      if (phase === 5 && model === debate.synthesizer) {
        const { comparison, finalProposal, dissent } = parsePhase5Output(content)
        summaries.upsert(req.params.id, comparison, finalProposal, dissent)
      }

      res.json({ ok: true, content, length: content.length })
    } catch (err) {
      console.error('[refetch] failed:', err)
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
