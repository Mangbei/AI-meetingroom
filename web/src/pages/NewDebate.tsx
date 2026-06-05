import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MODEL_META } from '../lib/models.ts'
import type { DebateModelName } from '../lib/models.ts'

type LoginStatus = Record<DebateModelName, boolean>
type ClaudeModel = 'sonnet-4-6' | 'opus-4-7'
type DeepSeekMode = 'fast' | 'expert'

export default function NewDebate() {
  const [topic, setTopic] = useState('')
  const [principles, setPrinciples] = useState('')
  const [synthesizer, setSynthesizer] = useState<DebateModelName>('claude')
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>('sonnet-4-6')
  const [deepseekMode, setDeepseekMode] = useState<DeepSeekMode>('fast')
  const [deepseekSmartSearch, setDeepseekSmartSearch] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [loginStatus, setLoginStatus] = useState<LoginStatus | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setLoginStatus(d.loginStatus ?? null))
      .catch(() => setLoginStatus(null))
  }, [])

  const allLoggedIn = loginStatus
    ? Object.values(loginStatus).every(Boolean)
    : false

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!topic.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/debates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          principles: principles.trim(),
          synthesizer,
          claudeConfig: { model: claudeModel },
          deepseekConfig: {
            mode: deepseekMode,
            deepThink: deepseekMode === 'expert',
            smartSearch: deepseekSmartSearch,
          },
        }),
      })
      const { id } = await res.json()
      navigate(`/debates/${id}`)
    } catch (err) {
      console.error(err)
      setSubmitting(false)
    }
  }

  // Pill toggle button
  const Pill = ({ active, children, onClick, tone = 'var(--vermilion)' }:
    { active: boolean; children: React.ReactNode; onClick: () => void; tone?: string }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0.5rem 1.1rem',
        background: 'transparent',
        border: `1px solid ${active ? tone : 'var(--rule)'}`,
        color: active ? tone : 'var(--paper-mute)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        borderRadius: 0,
      }}
    >
      {children}
    </button>
  )

  return (
    <div style={{
      maxWidth: 760,
      margin: '0 auto',
      padding: '3rem 2.4rem 4rem',
    }}>
      {/* Editorial masthead */}
      <header className="fade-up" style={{
        marginBottom: '2.6rem',
        borderBottom: '1.5px solid var(--paper)',
        paddingBottom: '1.4rem',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '0.8rem',
        }}>
          <Link to="/" className="byline" style={{ borderBottom: 'none', color: 'var(--paper-mute)' }}>
            ← 回到广场
          </Link>
          <span className="byline">投稿登记</span>
        </div>
        <h1 className="display" style={{
          fontSize: 'clamp(34px, 4vw, 48px)',
          fontWeight: 500,
          fontStyle: 'italic',
          color: 'var(--paper)',
          letterSpacing: '-0.02em',
        }}>
          拟订新议题
        </h1>
      </header>

      {/* Login status banner */}
      {loginStatus && (
        <div className="fade-up" style={{
          marginBottom: '2.4rem',
          padding: '0.9rem 0',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          gap: '2rem',
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}>
          <span className="byline">论辩参与方就绪状况</span>
          <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
            {(['claude', 'chatgpt', 'deepseek'] as DebateModelName[]).map(m => (
              <span key={m} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'var(--serif-display)',
                fontSize: 14,
                fontStyle: 'italic',
                color: loginStatus[m] ? 'var(--paper)' : 'var(--paper-faint)',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: loginStatus[m] ? MODEL_META[m].tone : 'var(--paper-faint)',
                }} />
                {MODEL_META[m].display}
              </span>
            ))}
          </div>
          {!allLoggedIn && (
            <p style={{
              fontFamily: 'var(--serif-body)',
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--vermilion)',
              flexBasis: '100%',
            }}>
              请先在浏览器中完成三方登录后再开始论辩。
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Topic */}
        <div className="field fade-up">
          <label>第 一 项 · 议题</label>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            rows={5}
            placeholder="描述你想让三方论辩的方案、设计或问题…"
            required
            style={{
              fontFamily: 'var(--serif-body)',
              fontSize: 16,
              lineHeight: 1.7,
            }}
          />
        </div>

        {/* Principles */}
        <div className="field fade-up">
          <label>第 二 项 · 设计原则（可空）</label>
          <textarea
            value={principles}
            onChange={e => setPrinciples(e.target.value)}
            rows={3}
            placeholder="例如：奥卡姆剃刀、低运维、面向初学者…"
            style={{
              fontFamily: 'var(--serif-body)',
              fontSize: 15,
              lineHeight: 1.7,
            }}
          />
        </div>

        {/* Synthesizer */}
        <div className="field fade-up">
          <label>第 三 项 · 综合者</label>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            {(['claude', 'chatgpt', 'deepseek'] as DebateModelName[]).map(m => (
              <Pill key={m} active={synthesizer === m} onClick={() => setSynthesizer(m)} tone={MODEL_META[m].tone}>
                {MODEL_META[m].display}
              </Pill>
            ))}
          </div>
          <p className="byline faint" style={{ marginTop: '0.55rem', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--serif-body)', fontStyle: 'italic', fontSize: 13 }}>
            由该模型负责最终综合迭代成稿。
          </p>
        </div>

        {/* Section divider */}
        <div style={{
          margin: '2.6rem 0 1.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}>
          <span className="byline" style={{ color: 'var(--paper-mute)' }}>参 与 方 配 置</span>
          <div style={{ flex: 1, borderTop: '1px solid var(--rule)' }} />
        </div>

        {/* Claude config */}
        <div className="field fade-up">
          <label style={{ color: 'var(--ochre)' }}>Claude · 模型</label>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <Pill active={claudeModel === 'sonnet-4-6'} onClick={() => setClaudeModel('sonnet-4-6')} tone="var(--ochre)">
              Sonnet 4.6
            </Pill>
            <Pill active={claudeModel === 'opus-4-7'} onClick={() => setClaudeModel('opus-4-7')} tone="var(--ochre)">
              Opus 4.7
            </Pill>
          </div>
        </div>

        {/* DeepSeek config */}
        <div className="field fade-up">
          <label style={{ color: 'var(--azure)' }}>DeepSeek · 模式</label>
          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.85rem' }}>
            <Pill active={deepseekMode === 'fast'} onClick={() => setDeepseekMode('fast')} tone="var(--azure)">
              快速
            </Pill>
            <Pill active={deepseekMode === 'expert'} onClick={() => setDeepseekMode('expert')} tone="var(--azure)">
              专家 · 深度思考
            </Pill>
          </div>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            color: 'var(--paper-mute)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            margin: 0,
          }}>
            <input
              type="checkbox"
              checked={deepseekSmartSearch}
              onChange={e => setDeepseekSmartSearch(e.target.checked)}
              style={{
                width: 14, height: 14,
                accentColor: 'var(--azure)',
                cursor: 'pointer',
              }}
            />
            智能搜索
          </label>
        </div>

        {/* CTA */}
        <div style={{
          marginTop: '2.6rem',
          paddingTop: '1.4rem',
          borderTop: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          gap: '1.2rem',
        }}>
          <button
            type="submit"
            className="primary"
            disabled={submitting || !topic.trim()}
            style={{ padding: '0.7rem 1.8rem' }}
          >
            {submitting ? '正 在 排 版 …' : '开 始 论 辩'}
          </button>
          <span className="byline faint" style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--serif-body)', fontStyle: 'italic', fontSize: 13 }}>
            提交后约需 3–5 分钟完成全部四阶段。
          </span>
        </div>
      </form>
    </div>
  )
}
