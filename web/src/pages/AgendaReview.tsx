import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MODEL_META, type MeetingModelName } from '../lib/models.ts'

interface AgendaDraft {
  id: string
  title: string
  goal: string
  mode: 'relay' | 'parallel'
  agendaRounds: number
  participants: MeetingModelName[]
  moderator: MeetingModelName
  modelPostures: Partial<Record<MeetingModelName, string>>
  suggestedAgenda: string[]
  raw: string
  warning: string
  createdAt: number
  files: { filename: string; kind: string; size: number }[]
}

interface RuntimeStatus {
  loggedIn: boolean
  warning?: string
}

function postureLabel(value: string | undefined): string {
  if (value === 'cooperative') return '协作'
  if (value === 'critical') return '反骨'
  return '默认'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export default function AgendaReview() {
  const { draftId } = useParams<{ draftId: string }>()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<AgendaDraft | null>(null)
  const [agenda, setAgenda] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/meetings/agenda-drafts/${draftId}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok) throw new Error(data.error ?? '议程草案不存在或已过期')
        setDraft(data)
        setAgenda((data.suggestedAgenda ?? ['']).length ? data.suggestedAgenda : [''])
      })
      .catch(err => {
        if (!cancelled) setError(String(err instanceof Error ? err.message : err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [draftId])

  const moveAgenda = (index: number, direction: -1 | 1) => {
    setAgenda(prev => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      const item = next[index]
      next[index] = next[target]
      next[target] = item
      return next
    })
  }

  const confirmConnectivity = async (currentDraft: AgendaDraft): Promise<boolean> => {
    try {
      const query = currentDraft.participants.join(',')
      const status = await fetch(`/api/status?models=${query}`).then(r => r.json())
      const runtime = (status.runtimeStatus ?? {}) as Partial<Record<MeetingModelName, RuntimeStatus>>
      const notReady = currentDraft.participants.filter(model => runtime[model]?.loggedIn === false)
      if (!notReady.length) return true

      const remaining = currentDraft.participants.length - notReady.length
      const names = notReady.map(model => MODEL_META[model].display).join('、')
      return window.confirm(
        remaining >= 2
          ? `${names} 当前未检测到登录或连通。继续后系统会尝试让它入会，失败则自动缺席。是否继续？`
          : `${names} 当前未检测到登录或连通。当前可能不足 2 位模型可用，是否仍然尝试开始？`,
      )
    } catch {
      return window.confirm('连通性检查失败。仍然可以尝试开始会议，如果模型无法进入会自动记录错误。是否继续？')
    }
  }

  const startMeeting = async () => {
    if (!draftId || !draft) return
    const confirmedAgenda = agenda.map(item => item.trim()).filter(Boolean)
    if (!confirmedAgenda.length) {
      setError('至少需要保留一个议程')
      return
    }

    setStarting(true)
    setError('')
    try {
      const ok = await confirmConnectivity(draft)
      if (!ok) {
        setStarting(false)
        return
      }

      const res = await fetch(`/api/meetings/agenda-drafts/${draftId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda: confirmedAgenda }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      navigate(`/meetings/${data.id}`)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStarting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '3rem 2.4rem' }}>
        <p className="faint">正在读取议程草案...</p>
      </div>
    )
  }

  if (!draft) {
    return (
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '3rem 2.4rem' }}>
        <Link to="/meetings/new" className="byline" style={{ borderBottom: 'none' }}>返回新建会议</Link>
        <p style={{ color: 'var(--vermilion)', marginTop: '1rem' }}>{error || '议程草案不可用'}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '3rem 2.4rem 4rem' }}>
      <header style={{ borderBottom: '1.5px solid var(--paper)', paddingBottom: '1.4rem', marginBottom: '2rem' }}>
        <Link to="/meetings/new" className="byline" style={{ borderBottom: 'none', color: 'var(--paper-mute)' }}>返回新建会议</Link>
        <h1 className="display" style={{ fontSize: 'clamp(36px, 5vw, 58px)', marginTop: '0.8rem', color: 'var(--paper)' }}>
          确认会议议程
        </h1>
        <p style={{ color: 'var(--paper-mute)', maxWidth: 820, marginTop: '0.8rem' }}>{draft.goal}</p>
        <div className="byline" style={{ marginTop: '0.9rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <span>{draft.mode === 'parallel' ? '并行' : '接力'} · 每议程 {draft.agendaRounds} 轮</span>
          <span>主持人 · {MODEL_META[draft.moderator].display}</span>
          {draft.participants.map(model => (
            <span key={model} style={{ color: MODEL_META[model].tone }}>
              {MODEL_META[model].display} · {postureLabel(draft.modelPostures[model])}
            </span>
          ))}
        </div>
      </header>

      {draft.warning && (
        <p style={{ color: 'var(--vermilion)', marginBottom: '1rem' }}>{draft.warning}</p>
      )}

      {draft.files.length > 0 && (
        <section style={{ marginBottom: '2rem', borderBottom: '1px solid var(--rule)', paddingBottom: '1.2rem' }}>
          <div className="byline">资料包</div>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            {draft.files.map(file => (
              <span key={file.filename} className="faint">
                {file.filename} · {file.kind.toUpperCase()} · {formatBytes(file.size)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="byline">主持人拟定的议程</div>
        {agenda.map((item, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.8rem', marginTop: '0.8rem', alignItems: 'stretch' }}>
            <textarea
              rows={2}
              value={item}
              onChange={e => setAgenda(prev => prev.map((value, idx) => idx === index ? e.target.value : value))}
              placeholder={`议程 ${index + 1}`}
            />
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <button type="button" className="ghost" onClick={() => moveAgenda(index, -1)} disabled={index === 0}>上移</button>
              <button type="button" className="ghost" onClick={() => moveAgenda(index, 1)} disabled={index === agenda.length - 1}>下移</button>
              <button type="button" className="ghost" onClick={() => setAgenda(prev => prev.filter((_, idx) => idx !== index))}>删除</button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="button" className="ghost" onClick={() => setAgenda(prev => [...prev, ''])}>添加议程</button>
          <button type="button" className="ghost" onClick={() => setAgenda(draft.suggestedAgenda)}>恢复主持人草案</button>
        </div>
      </section>

      {error && <p style={{ color: 'var(--vermilion)', marginTop: '1.2rem' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '2rem' }}>
        <button className="primary" onClick={startMeeting} disabled={starting}>
          {starting ? '正在启动会议...' : '确认议程并开始会议'}
        </button>
        <button type="button" className="ghost" onClick={() => navigate('/meetings/new')}>取消</button>
      </div>
    </div>
  )
}
