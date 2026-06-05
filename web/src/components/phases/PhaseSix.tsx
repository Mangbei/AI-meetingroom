import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DebateModelName } from '../../lib/models.ts'
import type { ModelStream } from '../../hooks/useDebateSocket.ts'
import { MODELS, MODEL_META } from '../../lib/models.ts'
import { parseVerdict } from '../../lib/parseDebateOutput.ts'
import PhaseHeader from './PhaseHeader.tsx'
import RefetchButton from '../RefetchButton.tsx'

// Phase VI — 终稿复核. Synthesizer doesn't review own work; the other two
// each get a card with a RATIFY/VETO badge parsed from the stream.

interface Badge { text: string; tone: string; reason: string }

// Returns null while the verdict line hasn't been emitted yet.
function verdictBadge(content: string | undefined): Badge | null {
  if (!content) return null
  const { verdict, reason } = parseVerdict(content)
  if (verdict === 'RATIFY') return { text: '批准', tone: 'var(--paper)', reason: '' }
  if (verdict === 'VETO')   return { text: '否决', tone: 'var(--vermilion)', reason }
  return null
}

export default function PhaseSixView(props: {
  panels: Partial<Record<DebateModelName, ModelStream | null>>
  synthesizer: DebateModelName | undefined
  isActivePhase: boolean
  isAborted: boolean
  onRefetch?: (model: DebateModelName) => void
}) {
  const { panels, synthesizer, isActivePhase, isAborted, onRefetch } = props
  const reviewers = MODELS.filter(m => m !== synthesizer)

  return (
    <section className="fade-up">
      <PhaseHeader phase={6} isActive={isActivePhase} isAborted={isAborted} />

      {synthesizer && (
        <p style={{
          fontFamily: 'var(--serif-body)',
          fontStyle: 'italic',
          fontSize: 13.5,
          color: 'var(--paper-mute)',
          marginBottom: '1.4rem',
          paddingBottom: '0.7rem',
          borderBottom: '1px dashed var(--rule)',
        }}>
          综合者 <em style={{
            fontFamily: 'var(--serif-display)',
            fontStyle: 'italic',
            color: MODEL_META[synthesizer].tone,
            fontWeight: 500,
          }}>{synthesizer}</em> 不参与本环节复核；以下两位以独立审稿人身份给出 ≤200 字判断。
        </p>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '1.4rem',
      }}>
        {reviewers.map(m => (
          <ReviewerCard
            key={m}
            model={m}
            stream={panels[m] ?? null}
            isActivePhase={isActivePhase}
            onRefetch={onRefetch ? () => onRefetch(m) : undefined}
          />
        ))}
      </div>
    </section>
  )
}

function ReviewerCard({ model, stream, isActivePhase, onRefetch }: {
  model: DebateModelName
  stream: ModelStream | null
  isActivePhase: boolean
  onRefetch?: () => void
}) {
  const verdict = verdictBadge(stream?.content)
  const tone = MODEL_META[model].tone
  const isWriting = !!stream && !stream.complete && isActivePhase
  // VERDICT line is surfaced as a badge; strip it from the body markdown.
  const body = stream?.content?.replace(/\n?VERDICT:.*$/i, '').trim() ?? ''

  return (
    <article style={{
      borderLeft: `1px solid ${isWriting ? tone : 'var(--rule)'}`,
      paddingLeft: '1.2rem',
      paddingRight: '0.6rem',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      transition: 'border-color 0.4s',
    }}>
      <header style={{
        paddingBottom: '0.6rem',
        marginBottom: '0.9rem',
        borderBottom: '1px solid var(--rule)',
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.7rem',
      }}>
        <h4 style={{
          fontFamily: 'var(--serif-display)',
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: 20,
          color: tone,
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}>{model}</h4>
        {verdict && (
          <span style={{
            marginLeft: 'auto',
            padding: '0.18rem 0.55rem',
            border: `1px solid ${verdict.tone}`,
            color: verdict.tone,
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>{verdict.text}</span>
        )}
        {!verdict && isWriting && (
          <span style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: tone,
          }}>
            <span className="writing-pulse" style={{ background: tone }} />
            落笔中
          </span>
        )}
        {onRefetch && !isActivePhase && (
          <RefetchButton onClick={onRefetch} hasNeighborOnRight={!!verdict} />
        )}
      </header>

      <div className="prose" style={{ minWidth: 0 }}>
        {body ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        ) : (
          <p style={{
            fontFamily: 'var(--serif-body)',
            fontStyle: 'italic',
            fontSize: 14,
            color: 'var(--paper-faint)',
          }}>
            {isActivePhase ? '执笔待书…' : '尚未发言。'}
          </p>
        )}
        {verdict?.reason && (
          <p style={{
            marginTop: '0.8rem',
            paddingTop: '0.6rem',
            borderTop: '1px dashed var(--rule)',
            fontFamily: 'var(--serif-body)',
            fontSize: 13,
            color: 'var(--paper-mute)',
            fontStyle: 'italic',
          }}>
            否决理由：{verdict.reason}
          </p>
        )}
      </div>
    </article>
  )
}
