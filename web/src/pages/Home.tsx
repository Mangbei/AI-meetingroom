import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MODEL_META, type MeetingModelName } from '../lib/models.ts'

interface MeetingRow {
  id: string
  title: string
  goal: string
  moderator: string
  mode: string
  status: string
  created_at: number
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待开始',
  running: '会议中',
  done: '已完成',
  error: '异常',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--paper-faint)',
  running: 'var(--vermilion)',
  done: 'var(--paper)',
  error: 'var(--vermilion)',
}

// Pretty model name for any of the supported models, falling back to the raw key.
const modelDisplay = (model: string): string =>
  MODEL_META[model as MeetingModelName]?.display ?? model

export default function Home() {
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/meetings')
      .then(r => r.json())
      .then(d => { setMeetings(d); setLoading(false) })
      .catch(err => { console.error(err); setLoading(false) })
  }, [])

  const dateOf = (ts: number) => {
    const d = new Date(ts)
    return {
      day: d.getDate().toString().padStart(2, '0'),
      month: d.toLocaleString('zh-CN', { month: 'long' }),
      year: d.getFullYear(),
      time: d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '3.2rem 2.4rem 4rem' }}>
      <header className="fade-up" style={{
        borderBottom: '1.5px solid var(--paper)',
        paddingBottom: '1.6rem',
        marginBottom: '2.6rem',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '2rem',
        flexWrap: 'wrap',
      }}>
        <div>
          <div className="byline" style={{ marginBottom: '0.5rem' }}>
            第 <span style={{ color: 'var(--paper)' }}>{meetings.length || '—'}</span> 场 · 多模型会议记录
          </div>
          <h1 className="display" style={{
            fontSize: 'clamp(40px, 5.5vw, 68px)',
            fontWeight: 600,
            color: 'var(--paper)',
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.3em',
          }}>
            AI Meeting Room
            <span style={{
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: '0.5em',
              color: 'var(--paper-mute)',
              letterSpacing: 0,
            }}>
              Local Council
            </span>
          </h1>
          <p style={{
            fontFamily: 'var(--serif-body)',
            fontSize: 16,
            fontStyle: 'italic',
            color: 'var(--paper-mute)',
            marginTop: '0.7rem',
            maxWidth: 560,
            lineHeight: 1.55,
          }}>
            ChatGPT、Gemini、DeepSeek 围绕你的资料和议程开会讨论，最后生成可保存、可导出的会议纪要。
          </p>
        </div>

        <button className="primary" onClick={() => navigate('/meetings/new')}>
          新建会议
        </button>
      </header>

      {loading ? (
        <p className="byline faint">载入中…</p>
      ) : meetings.length === 0 ? (
        <div className="fade-up" style={{ textAlign: 'center', padding: '5rem 1rem' }}>
          <div className="display" style={{
            fontSize: 56,
            fontStyle: 'italic',
            color: 'var(--paper-faint)',
            marginBottom: '1rem',
            fontWeight: 300,
          }}>
            空白页
          </div>
          <p className="byline" style={{ marginBottom: '1.6rem' }}>
            尚无会议记录
          </p>
          <button className="primary" onClick={() => navigate('/meetings/new')}>
            新建会议
          </button>
        </div>
      ) : (
        <section>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 130px 100px',
            gap: '1.5rem',
            alignItems: 'baseline',
            paddingBottom: '0.7rem',
            borderBottom: '1px solid var(--rule)',
            marginBottom: '0.5rem',
          }}>
            <div className="byline">日期</div>
            <div className="byline">会议</div>
            <div className="byline">主持人</div>
            <div className="byline" style={{ textAlign: 'right' }}>状态</div>
          </div>
          {meetings.map(m => {
            const dt = dateOf(m.created_at)
            return (
              <article
                key={m.id}
                className="archive-row fade-up"
                onClick={() => navigate(`/meetings/${m.id}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr 130px 100px',
                  gap: '1.5rem',
                  alignItems: 'baseline',
                  padding: '1.2rem 0',
                  borderBottom: '1px solid var(--rule-soft)',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div className="display" style={{ fontSize: 30, color: 'var(--paper)', lineHeight: 1 }}>
                    {dt.day}
                  </div>
                  <div className="byline faint" style={{ marginTop: 4 }}>
                    {dt.month} · {dt.time}
                  </div>
                </div>
                <div>
                  <h3 className="display" style={{ fontSize: 20, color: 'var(--paper)', marginBottom: '0.2rem' }}>
                    {m.title}
                  </h3>
                  <p style={{ color: 'var(--paper-mute)', fontSize: 14, lineHeight: 1.45 }}>
                    {m.goal.slice(0, 120)}{m.goal.length > 120 ? '…' : ''}
                  </p>
                </div>
                <div className="display" style={{ fontSize: 15, fontStyle: 'italic', color: 'var(--paper-mute)' }}>
                  {modelDisplay(m.moderator)}
                </div>
                <div className="byline" style={{ textAlign: 'right', color: STATUS_COLOR[m.status] ?? 'var(--paper-mute)' }}>
                  {STATUS_LABEL[m.status] ?? m.status}
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
