import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PhaseStrip from '../components/PhaseStrip.tsx'
import PhaseFooterNav from '../components/PhaseFooterNav.tsx'
import {
  PhaseTwoView, PhaseThreeView, PhaseFourView, PhaseFiveView, PhaseSixView,
} from '../components/phases/index.ts'
import { useDebateSocket, type ModelStream } from '../hooks/useDebateSocket.ts'
import { useRefetchMessage } from '../hooks/useRefetchMessage.ts'
import { MODELS, type DebateModelName } from '../lib/models.ts'
import type { DebatePhase } from '../lib/phases.ts'
import { displayTitle, topicBody } from '../lib/displayTopic.ts'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface StoredMessage {
  phase: number
  model: DebateModelName
  content: string
}

interface StoredSummary {
  comparison: string
  final_proposal: string
  dissent?: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: '排版中',
  running: '即时印行',
  done: '已成稿',
  error: '终止付印',
}

type ByPhase = Record<DebatePhase, Partial<Record<DebateModelName, ModelStream | null>>>

function transposeByPhase(streams: Record<DebateModelName, ModelStream[]>): ByPhase {
  const out: ByPhase = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }
  for (const model of MODELS) {
    for (const s of streams[model] ?? []) {
      out[s.phase][model] = s
    }
  }
  return out
}

export default function DebateView() {
  const { id } = useParams<{ id: string }>()
  const [debate, setDebate] = useState<any>(null)
  const [liveMode, setLiveMode] = useState(false)
  const [staticStreams, setStaticStreams] = useState<Record<DebateModelName, ModelStream[]>>({
    claude: [], chatgpt: [], deepseek: [],
  })
  const [staticSummary, setStaticSummary] = useState<
    { comparison: string; finalProposal: string; dissent?: string } | null
  >(null)
  const [topicExpanded, setTopicExpanded] = useState(false)

  const liveState = useDebateSocket(id, liveMode)

  useEffect(() => {
    if (!id) return
    fetch(`/api/debates/${id}`)
      .then(r => r.json())
      .then((data: { debate: any; messages: StoredMessage[]; summary?: StoredSummary }) => {
        setDebate(data.debate)
        const isActive = data.debate.status === 'pending' || data.debate.status === 'running'
        setLiveMode(isActive)

        const streams: Record<DebateModelName, ModelStream[]> = { claude: [], chatgpt: [], deepseek: [] }
        for (const msg of data.messages) {
          if (!streams[msg.model]) streams[msg.model] = []
          streams[msg.model].push({
            phase: msg.phase as DebatePhase, content: msg.content, complete: true,
          })
        }
        setStaticStreams(streams)
        if (data.summary) {
          setStaticSummary({
            comparison: data.summary.comparison,
            finalProposal: data.summary.final_proposal,
            dissent: data.summary.dissent ?? '',
          })
        }
      })
      .catch(console.error)
  }, [id])

  // Merge static (already-stored) + live (streaming) message streams.
  const streams: Record<DebateModelName, ModelStream[]> = liveMode
    ? Object.fromEntries(MODELS.map(m => {
        const stat = staticStreams[m] ?? []
        const live = liveState.streams[m] ?? []
        const merged = [...stat]
        for (const ls of live) {
          const i = merged.findIndex(s => s.phase === ls.phase)
          if (i >= 0) merged[i] = ls
          else merged.push(ls)
        }
        merged.sort((a, b) => a.phase - b.phase)
        return [m, merged]
      })) as Record<DebateModelName, ModelStream[]>
    : staticStreams

  const byPhase = useMemo(() => transposeByPhase(streams), [streams])

  // Where the debate ITSELF is at (vs. what the user is viewing).
  const highestStoredPhase = (Object.values(staticStreams).flat()
    .reduce<number>((m, s) => Math.max(m, s.phase), 2)) as DebatePhase
  const aborted = !liveMode && debate?.status === 'error'
  const debateCurrentPhase: DebatePhase = liveMode ? liveState.phase
                    : aborted   ? (Math.min(highestStoredPhase + 1, 6) as DebatePhase)
                                : 6
  const done = liveMode ? liveState.done : debate?.status === 'done'

  // ---- viewPhase state machine ----
  // Tracks which phase the user is currently looking at.
  // Auto-advance with the debate UNLESS the user has scrolled back manually.
  const [viewPhase, setViewPhase] = useState<DebatePhase>(2)
  const userPinnedRef = useRef(false)

  // Initialize viewPhase once we know where the debate is at.
  const initialized = useRef(false)
  useEffect(() => {
    if (!debate || initialized.current) return
    initialized.current = true
    setViewPhase(debateCurrentPhase)
  }, [debate, debateCurrentPhase])

  // Auto-track live phase progression when user hasn't pinned.
  useEffect(() => {
    if (!liveMode || userPinnedRef.current) return
    if (debateCurrentPhase !== viewPhase) setViewPhase(debateCurrentPhase)
  }, [debateCurrentPhase, liveMode, viewPhase])

  const handleSelectPhase = (p: DebatePhase) => {
    userPinnedRef.current = true
    setViewPhase(p)
  }

  const summary = liveMode ? (liveState.summary ?? staticSummary) : staticSummary
  const wsError = liveMode ? liveState.error : null
  const dbError = debate?.status === 'error' ? '辩论异常终止 · 服务器进程中断' : null
  const error = wsError ?? dbError

  const status = debate?.status ?? 'pending'
  const date = debate?.created_at
    ? new Date(debate.created_at).toLocaleDateString('zh-CN',
        { year: 'numeric', month: 'long', day: 'numeric' })
    : ''
  const synthesizer = debate?.synthesizer as DebateModelName | undefined

  // The URL path itself ends in .md (server accepts an optional :filename
  // segment for cosmetics). Even if the browser strips Content-Disposition
  // and ignores the download attribute (rare extensions / synthetic-click
  // edge cases), the basename — debate-xxxxxxxx.md — is what it falls back
  // to. Most reliable form of download we can produce.
  const exportMd = () => {
    if (!id) return
    const filename = `debate-${id.slice(0, 8)}.md`
    const a = document.createElement('a')
    a.href = `/api/debates/${id}/export/${filename}`
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const refetch = useRefetchMessage(id, ({ streams, summary }) => {
    setStaticStreams(streams)
    setStaticSummary(summary)
  })

  // Is THE PHASE BEING VIEWED currently active in the debate?
  const isViewPhaseActive = liveMode && viewPhase === debateCurrentPhase && !done
  const isViewPhaseAborted = aborted && viewPhase === debateCurrentPhase

  return (
    <div style={{
      margin: '0 auto',
      padding: '2rem 2.4rem 4rem',
    }}>
      {/* Editorial masthead */}
      <header className="fade-up" style={{ marginBottom: '1.6rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '0.7rem',
        }}>
          <Link to="/" className="byline" style={{
            borderBottom: 'none',
            color: 'var(--paper-mute)',
          }}>
            ← 回到广场
          </Link>
          <span className="byline" style={{
            color: status === 'running' ? 'var(--vermilion)' :
                   status === 'done'    ? 'var(--paper)' :
                   status === 'error'   ? 'var(--vermilion)' :
                                          'var(--paper-faint)',
          }}>
            {status === 'running' && <span className="writing-pulse" style={{
              background: 'var(--vermilion)', marginRight: 8,
            }} />}
            {STATUS_LABEL[status] ?? status}
            <span style={{ marginLeft: '0.7rem', color: 'var(--paper-mute)' }}>
              第 {debate?.id?.slice(0, 6) ?? '------'} 期
            </span>
          </span>
        </div>

        <h1 className="display fade-up" style={{
          fontSize: 'clamp(28px, 3.4vw, 44px)',
          fontWeight: 500,
          color: 'var(--paper)',
          marginBottom: '0.6rem',
          lineHeight: 1.12,
          maxWidth: '92%',
        }}>
          {displayTitle(debate?.topic, 160) || '加载中…'}
        </h1>

        <div className="byline" style={{
          color: 'var(--paper-mute)',
          marginBottom: '1.2rem',
          display: 'flex',
          gap: '1.6rem',
          flexWrap: 'wrap',
        }}>
          <span>{date}</span>
          {synthesizer && (
            <span>综合者 · <em style={{
              fontStyle: 'italic',
              color: 'var(--paper)',
              fontFamily: 'var(--serif-display)',
              textTransform: 'none',
              letterSpacing: 0,
              fontSize: 14,
            }}>{synthesizer}</em></span>
          )}
        </div>

        {topicBody(debate?.topic) && (
          <div style={{ marginBottom: '1.2rem', maxWidth: '92%' }}>
            <button
              onClick={() => setTopicExpanded(v => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                padding: '0.3rem 0',
                color: 'var(--paper-mute)',
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                marginBottom: '0.5rem',
              }}
            >
              {topicExpanded ? '收起议题原文 ▴' : '查看议题原文 ▾'}
            </button>
            {topicExpanded && (
              <div className="prose" style={{
                fontFamily: 'var(--serif-body)',
                fontSize: 14,
                color: 'var(--paper-mute)',
                borderLeft: '2px solid var(--rule)',
                paddingLeft: '0.9rem',
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {topicBody(debate?.topic)}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {debate?.principles && (
          <p style={{
            fontFamily: 'var(--serif-body)',
            fontStyle: 'italic',
            fontSize: 15,
            color: 'var(--paper-mute)',
            borderLeft: '2px solid var(--rule)',
            paddingLeft: '0.9rem',
            marginBottom: '1.2rem',
            maxWidth: '92%',
          }}>
            {debate.principles}
          </p>
        )}

        {error && (
          <div style={{
            color: 'var(--vermilion)',
            fontSize: 13,
            fontStyle: 'italic',
            fontFamily: 'var(--serif-body)',
            marginBottom: '0.9rem',
            paddingLeft: '0.7rem',
            borderLeft: '2px solid var(--vermilion)',
          }}>
            {error}
          </div>
        )}
      </header>

      <PhaseStrip
        viewPhase={viewPhase}
        debateCurrentPhase={debateCurrentPhase}
        done={!!done}
        aborted={aborted}
        onSelect={handleSelectPhase}
      />

      {/* One phase visible at a time */}
      <main style={{ marginTop: '2rem' }} key={viewPhase}>
        {viewPhase === 2 && (
          <PhaseTwoView
            panels={byPhase[2]}
            isActivePhase={isViewPhaseActive}
            isAborted={isViewPhaseAborted}
            onRefetch={m => refetch(2, m)}
          />
        )}
        {viewPhase === 3 && (
          <PhaseThreeView
            panels={byPhase[3]}
            anonOrder={MODELS}
            isActivePhase={isViewPhaseActive}
            isAborted={isViewPhaseAborted}
          />
        )}
        {viewPhase === 4 && (
          <PhaseFourView
            panels={byPhase[4]}
            isActivePhase={isViewPhaseActive}
            isAborted={isViewPhaseAborted}
            onRefetch={m => refetch(4, m)}
          />
        )}
        {viewPhase === 5 && (
          <PhaseFiveView
            synthesizer={synthesizer}
            stream={synthesizer ? byPhase[5][synthesizer] : null}
            summary={summary}
            isActivePhase={isViewPhaseActive}
            isAborted={isViewPhaseAborted}
          />
        )}
        {viewPhase === 6 && (
          <PhaseSixView
            panels={byPhase[6]}
            synthesizer={synthesizer}
            isActivePhase={isViewPhaseActive}
            isAborted={isViewPhaseAborted}
            onRefetch={m => refetch(6, m)}
          />
        )}
      </main>

      <PhaseFooterNav
        viewPhase={viewPhase}
        onPrev={() => handleSelectPhase(Math.max(2, viewPhase - 1) as DebatePhase)}
        onNext={() => handleSelectPhase(Math.min(6, viewPhase + 1) as DebatePhase)}
        onExport={exportMd}
        canExport={!!done || !!summary}
      />
    </div>
  )
}
