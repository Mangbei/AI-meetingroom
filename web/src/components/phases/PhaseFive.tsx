import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DebateModelName } from '../../lib/models.ts'
import type { ModelStream } from '../../hooks/useDebateSocket.ts'
import { MODEL_META } from '../../lib/models.ts'
import PhaseHeader from './PhaseHeader.tsx'

// Phase V — synthesizer's four-section output rendered as three explicit
// cards (一/二 are merged into "comparison" by the server-side parser).
// During streaming we show the raw markdown as a progress fallback.

interface Summary {
  comparison: string
  finalProposal: string
  dissent?: string
}

export default function PhaseFiveView(props: {
  synthesizer: DebateModelName | undefined
  stream: ModelStream | null | undefined
  summary: Summary | null
  isActivePhase: boolean
  isAborted: boolean
}) {
  const { synthesizer, stream, summary, isActivePhase, isAborted } = props
  const hasSummary = summary && (summary.comparison || summary.finalProposal || summary.dissent)

  return (
    <section className="fade-up">
      <PhaseHeader phase={5} isActive={isActivePhase} isAborted={isAborted} />

      {synthesizer && (
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.7rem',
          marginBottom: '1.4rem',
          paddingBottom: '0.6rem',
          borderBottom: '1px solid var(--rule)',
        }}>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--paper-mute)',
          }}>综合者</span>
          <span style={{
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            fontSize: 18,
            color: MODEL_META[synthesizer].tone,
            fontWeight: 500,
          }}>{synthesizer}</span>
          {isActivePhase && (
            <span style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--vermilion)',
            }}>
              <span className="writing-pulse" style={{ background: 'var(--vermilion)' }} />
              落笔中
            </span>
          )}
        </div>
      )}

      {!hasSummary && stream && stream.content && (
        <div className="prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.content}</ReactMarkdown>
        </div>
      )}

      {!hasSummary && (!stream || !stream.content) && (
        <p style={{
          fontFamily: 'var(--serif-body)',
          fontStyle: 'italic',
          color: 'var(--paper-faint)',
        }}>
          {isActivePhase ? '综合者执笔待书…' : '尚未综合。'}
        </p>
      )}

      {hasSummary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem' }}>
          <SummaryCard kind="comparison" body={summary!.comparison} />
          <SummaryCard kind="proposal"   body={summary!.finalProposal} />
          {summary!.dissent && <SummaryCard kind="dissent" body={summary!.dissent} />}
        </div>
      )}
    </section>
  )
}

const CARD_META = {
  comparison: { label: '异同对照 · 关键分歧裁决', tone: 'var(--paper-mute)' },
  proposal:   { label: '迭代后的综合方案',        tone: 'var(--paper)' },
  dissent:    { label: '少数派意见',              tone: 'var(--ochre)' },
} as const

function SummaryCard({ kind, body }: {
  kind: keyof typeof CARD_META
  body: string
}) {
  const meta = CARD_META[kind]
  return (
    <article style={{
      borderLeft: `2px solid ${meta.tone}`,
      paddingLeft: '1.2rem',
      paddingRight: '0.4rem',
    }}>
      <h3 style={{
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: meta.tone,
        marginBottom: '0.8rem',
        fontWeight: 600,
      }}>
        {meta.label}
      </h3>
      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    </article>
  )
}
