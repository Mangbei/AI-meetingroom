import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MODEL_META, type MeetingModelName } from '../lib/models.ts'
import { useMeetingSocket, type MeetingLogEntry, type MeetingMessageStream } from '../hooks/useMeetingSocket.ts'

interface MeetingRow {
  id: string
  title: string
  goal: string
  mode: 'relay' | 'parallel'
  participants_json: string
  moderator: MeetingModelName
  status: string
  created_at: number
  archive_dir?: string
  summary_path?: string
  json_path?: string
}

interface AgendaRow {
  id: number
  position: number
  question: string
  summary: string
}

interface StoredMessage {
  agenda_id: number | null
  turn_index: number
  role: string
  model: MeetingModelName
  content: string
}

interface Artifact {
  final_summary: string
  archive_dir: string
  summary_path: string
  json_path: string
}

export default function MeetingView() {
  const { id } = useParams<{ id: string }>()
  const [meeting, setMeeting] = useState<MeetingRow | null>(null)
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [staticStreams, setStaticStreams] = useState<MeetingMessageStream[]>([])
  const [staticLogs, setStaticLogs] = useState<MeetingLogEntry[]>([])
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [liveMode, setLiveMode] = useState(false)
  const [refetching, setRefetching] = useState<string | null>(null)
  const [localError, setLocalError] = useState('')
  const live = useMeetingSocket(id, liveMode)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const load = () => {
      fetch(`/api/meetings/${id}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled) return
          const isLive = data.meeting?.status === 'pending' || data.meeting?.status === 'running'
          setMeeting(data.meeting)
          setAgenda(data.agenda ?? [])
          setArtifact(data.artifact ?? null)
          setStaticLogs(data.logs ?? [])
          setLiveMode(isLive)
          setStaticStreams((data.messages ?? []).map((m: StoredMessage) => ({
            agendaId: m.agenda_id,
            turnIndex: m.turn_index,
            role: m.role,
            model: m.model,
            content: m.content,
            complete: true,
          })))
        })
        .catch(console.error)
    }

    load()
    timer = setInterval(load, 4000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [id])

  const streams = useMemo(() => {
    const merged = [...staticStreams]
    for (const stream of live.streams) {
      const idx = merged.findIndex(s => s.turnIndex === stream.turnIndex)
      if (idx >= 0) merged[idx] = stream
      else merged.push(stream)
    }
    return merged.sort((a, b) => a.turnIndex - b.turnIndex)
  }, [live.streams, staticStreams])

  const logs = useMemo(() => [...staticLogs, ...live.logs], [live.logs, staticLogs])

  const finalSummary = live.finalSummary || artifact?.final_summary || ''
  const summaryPath = live.summaryPath || artifact?.summary_path || meeting?.summary_path || ''
  const jsonPath = live.jsonPath || artifact?.json_path || meeting?.json_path || ''
  const archiveDir = live.archiveDir || artifact?.archive_dir || meeting?.archive_dir || ''
  const participants = meeting ? JSON.parse(meeting.participants_json) as MeetingModelName[] : []

  const exportMd = () => {
    if (!id) return
    const filename = `meeting-${id.slice(0, 8)}.md`
    const a = document.createElement('a')
    a.href = `/api/meetings/${id}/export/${filename}`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const refetchMessage = async (stream: MeetingMessageStream) => {
    if (!id) return
    const key = `${stream.turnIndex}-${stream.model}`
    setRefetching(key)
    setLocalError('')
    try {
      const res = await fetch(`/api/meetings/${id}/messages/refetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agendaId: stream.agendaId, model: stream.model }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      setStaticStreams(prev => prev.map(item =>
        item.turnIndex === stream.turnIndex ? { ...item, content: data.content, complete: true } : item
      ))
    } catch (err) {
      setLocalError(String(err instanceof Error ? err.message : err))
    } finally {
      setRefetching(null)
    }
  }

  return (
    <div style={{ margin: '0 auto', padding: '2rem 2.4rem 4rem', maxWidth: 1180 }}>
      <header style={{ marginBottom: '1.8rem', borderBottom: '1.5px solid var(--paper)', paddingBottom: '1.2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/" className="byline" style={{ borderBottom: 'none' }}>← 返回广场</Link>
          <span className="byline" style={{ color: meeting?.status === 'running' ? 'var(--vermilion)' : 'var(--paper-mute)' }}>
            {meeting?.status ?? 'loading'} · {meeting?.mode === 'parallel' ? '并行' : '接力'}
          </span>
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(34px, 4vw, 54px)', marginTop: '0.8rem' }}>
          {meeting?.title ?? '会议加载中...'}
        </h1>
        {meeting && (
          <p style={{ marginTop: '0.8rem', color: 'var(--paper-mute)', maxWidth: 820 }}>
            {meeting.goal}
          </p>
        )}
        <div className="byline" style={{ marginTop: '0.9rem', display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
          {participants.map(p => <span key={p} style={{ color: MODEL_META[p].tone }}>{MODEL_META[p].display}</span>)}
          {meeting && <span>主持人 · {MODEL_META[meeting.moderator]?.display ?? meeting.moderator}</span>}
        </div>
        {(live.error || localError) && <p style={{ color: 'var(--vermilion)', marginTop: '0.8rem' }}>{live.error || localError}</p>}
      </header>

      <RunConsole participants={participants} logs={logs} />

      {agenda.map(item => {
        const itemStreams = streams.filter(s => s.agendaId === item.id && s.role === 'participant')
        const summary = live.agendaSummaries[item.id] || item.summary
        return (
          <section key={item.id} style={{ marginBottom: '2.4rem', borderBottom: '1px solid var(--rule)', paddingBottom: '2rem' }}>
            <div className="byline">议程 {item.position + 1}</div>
            <h2 className="display" style={{ fontSize: 30, margin: '0.4rem 0 1.2rem' }}>{item.question}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem' }}>
              {itemStreams.map(stream => (
                <ModelTurn
                  key={stream.turnIndex}
                  stream={stream}
                  refetching={refetching === `${stream.turnIndex}-${stream.model}`}
                  onRefetch={() => void refetchMessage(stream)}
                />
              ))}
            </div>
            {summary && (
              <div style={{ marginTop: '1.5rem', borderLeft: '2px solid var(--vermilion)', paddingLeft: '1rem' }}>
                <div className="byline">议程小结</div>
                <div className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                </div>
              </div>
            )}
          </section>
        )
      })}

      <section style={{ marginTop: '2rem' }}>
        <div className="byline">最终会议纪要</div>
        {finalSummary ? (
          <div className="prose" style={{ marginTop: '0.8rem' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalSummary}</ReactMarkdown>
          </div>
        ) : (
          <p className="faint" style={{ fontStyle: 'italic', marginTop: '0.8rem' }}>
            {liveMode ? '会议仍在进行，最终纪要生成后会显示在这里。' : '暂无最终纪要。'}
          </p>
        )}
        <div style={{ marginTop: '1.4rem', display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
          <button className="primary" onClick={exportMd} disabled={!finalSummary}>导出 Markdown</button>
          {summaryPath && <span className="byline" style={{ textTransform: 'none', letterSpacing: 0 }}>summary: {summaryPath}</span>}
          {jsonPath && <span className="byline" style={{ textTransform: 'none', letterSpacing: 0 }}>json: {jsonPath}</span>}
          {archiveDir && <span className="byline" style={{ textTransform: 'none', letterSpacing: 0 }}>archive: {archiveDir}</span>}
        </div>
      </section>
    </div>
  )
}

function RunConsole({ participants, logs }: { participants: MeetingModelName[]; logs: MeetingLogEntry[] }) {
  const latestByModel = new Map<MeetingModelName, MeetingLogEntry>()
  for (const log of logs) {
    if (log.kind === 'model_status' && log.model) latestByModel.set(log.model, log)
  }
  const fileLogs = logs.filter(log => log.kind === 'file_delivery' && log.status !== 'trying').slice(-18)

  return (
    <section style={{ marginBottom: '2.2rem', paddingBottom: '1.4rem', borderBottom: '1px solid var(--rule)' }}>
      <div className="byline">运行控制台</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginTop: '0.8rem' }}>
        {participants.map(model => {
          const meta = MODEL_META[model]
          const latest = latestByModel.get(model)
          const color = latest?.status === 'error' || latest?.status === 'skipped'
            ? 'var(--vermilion)'
            : latest?.status === 'ready' || latest?.status === 'complete'
              ? meta.tone
              : 'var(--paper-mute)'
          return (
            <div key={model} style={{ borderLeft: `2px solid ${meta.tone}`, paddingLeft: '1rem' }}>
              <h3 className="display" style={{ fontSize: 20, color: meta.tone }}>{meta.display}</h3>
              <p className="byline" style={{ color, textTransform: 'none', letterSpacing: 0 }}>
                {latest?.status ?? '等待'}
              </p>
              {latest?.detail && <p className="faint" style={{ fontSize: 13 }}>{latest.detail}</p>}
            </div>
          )
        })}
      </div>

      {fileLogs.length > 0 && (
        <div style={{ marginTop: '1.2rem' }}>
          <div className="byline">文件分发</div>
          <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem' }}>
            {fileLogs.map((log, index) => (
              <div
                key={`${log.model}-${log.filename}-${log.status}-${index}`}
                style={{ display: 'grid', gridTemplateColumns: '120px minmax(160px, 1fr) 120px', gap: '0.7rem', alignItems: 'baseline' }}
              >
                <span style={{ color: log.model ? MODEL_META[log.model]?.tone : 'var(--paper-mute)' }}>
                  {log.model ? MODEL_META[log.model]?.display ?? log.model : 'system'}
                </span>
                <span className="faint">{log.filename ?? log.detail ?? '附件批次'}</span>
                <span className="byline" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  {log.status === 'uploaded' ? '原件直传' : log.status === 'fallback' ? '文本兜底' : log.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function ModelTurn({
  stream,
  refetching,
  onRefetch,
}: {
  stream: MeetingMessageStream
  refetching: boolean
  onRefetch: () => void
}) {
  const meta = MODEL_META[stream.model]
  return (
    <article style={{ borderLeft: `2px solid ${meta.tone}`, paddingLeft: '1rem', minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '0.7rem', marginBottom: '0.7rem', flexWrap: 'wrap' }}>
        <h3 className="display" style={{ fontSize: 21, color: meta.tone }}>{meta.display}</h3>
        {!stream.complete && <span className="byline" style={{ color: meta.tone }}>发言中</span>}
        {stream.complete && (
          <button type="button" className="ghost" onClick={onRefetch} disabled={refetching} style={{ padding: '0.35rem 0.55rem' }}>
            {refetching ? '抓取中' : '重新抓取'}
          </button>
        )}
      </header>
      <div className="prose">
        {stream.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.content}</ReactMarkdown>
        ) : (
          <p className="faint" style={{ fontStyle: 'italic' }}>等待发言...</p>
        )}
      </div>
    </article>
  )
}
