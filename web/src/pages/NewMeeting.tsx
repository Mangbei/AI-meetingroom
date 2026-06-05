import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MEETING_MODELS, MODEL_META, type MeetingModelName } from '../lib/models.ts'

type MeetingMode = 'relay' | 'parallel'

interface UploadFile {
  filename: string
  kind: 'txt' | 'md'
  content: string
}

interface RuntimeStatus {
  loggedIn: boolean
  requestedModel?: string
  detectedModel?: string
  configured: boolean
  needsManualConfirmation: boolean
  warning?: string
}

const TARGET_MODEL: Record<MeetingModelName, string> = {
  chatgpt: '最高 Thinking / Reasoning 模型',
  gemini: 'Gemini Pro / 最高 Pro 模型',
  deepseek: 'DeepSeek R1 + 深度思考',
}

export default function NewMeeting() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('文章选题会议')
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<MeetingMode>('relay')
  const [participants] = useState<MeetingModelName[]>([...MEETING_MODELS])
  const [moderator, setModerator] = useState<MeetingModelName>('chatgpt')
  const [agenda, setAgenda] = useState<string[]>([''])
  const [files, setFiles] = useState<UploadFile[]>([])
  const [confirmations, setConfirmations] = useState<Record<MeetingModelName, boolean>>({
    chatgpt: false,
    gemini: false,
    deepseek: false,
  })
  const [runtimeStatus, setRuntimeStatus] = useState<Partial<Record<MeetingModelName, RuntimeStatus>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [openingTabs, setOpeningTabs] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setRuntimeStatus(d.runtimeStatus ?? {}))
      .catch(() => setRuntimeStatus({}))
  }, [])

  const canSubmit = useMemo(() => {
    return title.trim() && goal.trim() && agenda.some(q => q.trim()) &&
      participants.every(m => confirmations[m])
  }, [agenda, confirmations, goal, participants, title])

  const readFiles = async (list: FileList | null) => {
    if (!list) return
    setError('')
    const next: UploadFile[] = []
    for (const file of Array.from(list)) {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith('.txt') && !lower.endsWith('.md')) {
        setError('首版仅支持 .txt / .md。PDF 和 DOCX 下一版接入。')
        continue
      }
      const content = await file.text()
      next.push({ filename: file.name, kind: lower.endsWith('.md') ? 'md' : 'txt', content })
    }
    setFiles(prev => [...prev, ...next])
  }

  const openMeetingTabs = async () => {
    setOpeningTabs(true)
    setError('')
    try {
      const res = await fetch('/api/browser/open-meeting-tabs', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      const status = await fetch('/api/status').then(r => r.json())
      setRuntimeStatus(status.runtimeStatus ?? {})
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setOpeningTabs(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          goal: goal.trim(),
          mode,
          participants,
          moderator,
          agenda: agenda.map(q => q.trim()).filter(Boolean),
          files,
          confirmations,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      navigate(`/meetings/${data.id}`)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '3rem 2.4rem 4rem' }}>
      <header className="fade-up" style={{ borderBottom: '1.5px solid var(--paper)', paddingBottom: '1.4rem', marginBottom: '2.2rem' }}>
        <Link to="/" className="byline" style={{ borderBottom: 'none', color: 'var(--paper-mute)' }}>← 返回广场</Link>
        <h1 className="display" style={{ fontSize: 'clamp(36px, 5vw, 58px)', marginTop: '0.8rem', color: 'var(--paper)' }}>
          新建多模型会议
        </h1>
      </header>

      <form onSubmit={submit}>
        <div className="field">
          <label>会议标题</label>
          <input value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>会议目标</label>
          <textarea
            rows={4}
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="例如：基于我的简历、现有总结和研究兴趣，帮我确定最适合写文章的选题方向。"
          />
        </div>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>上传资料（.txt / .md）</label>
          <input
            type="file"
            multiple
            accept=".txt,.md,text/plain,text/markdown"
            onChange={e => readFiles(e.target.files)}
            style={{ border: '1px solid var(--rule)', padding: '0.8rem', background: 'var(--ink-2)' }}
          />
          <p className="byline faint" style={{ marginTop: '0.6rem', textTransform: 'none', letterSpacing: 0 }}>
            PDF / DOCX 下一版支持；首版请先转成文本或 Markdown。
          </p>
          {files.length > 0 && (
            <ul style={{ marginTop: '0.8rem', color: 'var(--paper-mute)' }}>
              {files.map((f, i) => (
                <li key={`${f.filename}-${i}`}>{f.filename} · {Math.round(f.content.length / 1000)}k 字符</li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>议程问题</label>
          {agenda.map((q, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.8rem', marginBottom: '0.8rem' }}>
              <textarea
                rows={2}
                value={q}
                onChange={e => setAgenda(prev => prev.map((x, idx) => idx === i ? e.target.value : x))}
                placeholder={`议程 ${i + 1}`}
              />
              <button type="button" className="ghost" onClick={() => setAgenda(prev => prev.filter((_, idx) => idx !== i))}>删除</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setAgenda(prev => [...prev, ''])}>添加议程</button>
        </section>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>讨论模式</label>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <button type="button" className={mode === 'relay' ? 'primary' : 'ghost'} onClick={() => setMode('relay')}>接力模式</button>
            <button type="button" className={mode === 'parallel' ? 'primary' : 'ghost'} onClick={() => setMode('parallel')}>并行模式</button>
          </div>
        </section>

        <section style={{ margin: '2rem 0', paddingTop: '1.2rem', borderTop: '1px solid var(--rule)' }}>
          <label>入会模型与最高模型确认</label>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.8rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <button type="button" className="ghost" onClick={openMeetingTabs} disabled={openingTabs}>
              {openingTabs ? '正在打开…' : '打开/聚焦三家网页'}
            </button>
            <span className="byline faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
              打开后请在受控浏览器里登录，并手动切到最高模型。
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {participants.map(model => {
              const meta = MODEL_META[model]
              const status = runtimeStatus[model]
              return (
                <div key={model} style={{ borderLeft: `2px solid ${meta.tone}`, paddingLeft: '1rem' }}>
                  <h3 className="display" style={{ fontSize: 22, color: meta.tone }}>{meta.display}</h3>
                  <p className="byline" style={{ textTransform: 'none', letterSpacing: 0 }}>{TARGET_MODEL[model]}</p>
                  <p style={{ color: status?.loggedIn ? 'var(--paper-mute)' : 'var(--vermilion)', fontStyle: 'italic', fontSize: 14 }}>
                    {status?.loggedIn ? '已检测到登录或需人工确认' : '未确认登录，请先在浏览器登录'}
                  </p>
                  {status?.warning && <p className="faint" style={{ fontSize: 13 }}>{status.warning}</p>}
                  <label style={{ marginTop: '0.8rem', letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--serif-body)', fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={confirmations[model]}
                      onChange={e => setConfirmations(prev => ({ ...prev, [model]: e.target.checked }))}
                      style={{ width: 14, marginRight: 8 }}
                    />
                    我已确认该网页使用最高可用模型
                  </label>
                </div>
              )
            })}
          </div>
          <div className="field" style={{ marginTop: '1.4rem' }}>
            <label>主持人 / 最终归纳者</label>
            <select value={moderator} onChange={e => setModerator(e.target.value as MeetingModelName)}>
              {participants.map(m => <option key={m} value={m}>{MODEL_META[m].display}</option>)}
            </select>
          </div>
        </section>

        {error && <p style={{ color: 'var(--vermilion)', marginBottom: '1rem' }}>{error}</p>}
        <button type="submit" className="primary" disabled={!canSubmit || submitting}>
          {submitting ? '正在开会…' : '开始会议'}
        </button>
      </form>
    </div>
  )
}
