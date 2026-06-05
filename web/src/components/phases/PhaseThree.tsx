import { useMemo } from 'react'
import type { DebateModelName } from '../../lib/models.ts'
import type { ModelStream } from '../../hooks/useDebateSocket.ts'
import { MODELS, MODEL_META, MODEL_ABBR } from '../../lib/models.ts'
import {
  parseCritiquesByTarget,
  aggregateRankings,
  ANON_LABELS,
  type AnonLabel,
  type CritiqueSection,
  type CritiquesByTarget,
} from '../../lib/parseDebateOutput.ts'
import PhaseHeader from './PhaseHeader.tsx'

// Phase III — 匿名互评 transposed by target proposal.
// Each anonymous label (甲/乙/丙) gets one card aggregating critiques from
// all three reviewers, with the original author revealed for reading.

const SECTIONS: { id: CritiqueSection; label: string; tone: string }[] = [
  { id: '决定性缺陷', label: '决定性缺陷', tone: 'var(--vermilion)' },
  { id: '可救的洞见', label: '可救的洞见', tone: 'var(--ochre)' },
  { id: '具体改动',   label: '具体改动',   tone: 'var(--sage)' },
]

export default function PhaseThreeView(props: {
  panels: Partial<Record<DebateModelName, ModelStream | null>>
  /** Fixed mapping: Phase 2 order → anon label. anonOrder[i] is the author of 甲/乙/丙. */
  anonOrder: DebateModelName[]
  isActivePhase: boolean
  isAborted: boolean
}) {
  const { panels, anonOrder, isActivePhase, isAborted } = props

  // Re-parse on every render — cheap at this content size, stays live as
  // streaming columns grow.
  const { byTarget, ranks } = useMemo(() => {
    const phase3 = MODELS
      .map(m => ({ reviewer: m, content: panels[m]?.content ?? '' }))
      .filter(p => p.content.length > 0)
    return {
      byTarget: parseCritiquesByTarget(phase3),
      ranks: aggregateRankings(phase3),
    }
  }, [panels.claude?.content, panels.chatgpt?.content, panels.deepseek?.content])

  return (
    <section className="fade-up">
      <PhaseHeader phase={3} isActive={isActivePhase} isAborted={isAborted} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '0.6rem',
      }}>
        {ANON_LABELS.map((label, i) => (
          <TargetCard
            key={label}
            label={label}
            author={anonOrder[i]}
            rank={ranks[label]}
            sections={byTarget[label]}
          />
        ))}
      </div>
      <p style={{
        marginTop: '1.2rem',
        fontFamily: 'var(--serif-body)',
        fontStyle: 'italic',
        fontSize: 13,
        color: 'var(--paper-faint)',
      }}>
        三位评审者在此阶段独立写作，不知道方案作者身份。作者身份 (
        {ANON_LABELS.map((l, i) => `方案${l}=${anonOrder[i] ?? '-'}`).join(' · ')}
        ) 仅在此处揭示，供阅读对照。
      </p>
    </section>
  )
}

function TargetCard({ label, author, rank, sections }: {
  label: AnonLabel
  author: DebateModelName | undefined
  rank: number | null
  sections: CritiquesByTarget[AnonLabel]
}) {
  const isWinner = rank !== null && rank < 1.5

  return (
    <div style={{
      borderLeft: '1px solid var(--rule)',
      paddingLeft: '1.1rem',
      paddingRight: '0.6rem',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
    }}>
      <header style={{
        paddingBottom: '0.55rem',
        marginBottom: '0.9rem',
        borderBottom: '1px solid var(--rule)',
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.6rem',
      }}>
        <h4 style={{
          fontFamily: 'var(--serif-display)',
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: 20,
          color: 'var(--paper)',
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}>
          方案{label}
        </h4>
        {author && (
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 9.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MODEL_META[author].tone,
          }}>
            {author}
          </span>
        )}
        {rank !== null && (
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            color: isWinner ? 'var(--paper)' : 'var(--paper-mute)',
          }}>
            盲审 #{rank.toFixed(2)}
          </span>
        )}
      </header>

      {SECTIONS.map(sec => {
        const points = sections[sec.id]
        return (
          <div key={sec.id} style={{ marginBottom: '1rem', minWidth: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.5rem',
              marginBottom: '0.4rem',
            }}>
              <span style={{
                width: 4,
                height: 14,
                background: sec.tone,
                display: 'inline-block',
                alignSelf: 'center',
              }} />
              <span style={{
                fontFamily: 'var(--serif-display)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--paper)',
                letterSpacing: 0,
              }}>{sec.label}</span>
              <span style={{
                fontFamily: 'var(--mono)',
                fontSize: 9,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--paper-faint)',
                marginLeft: 'auto',
              }}>{points.length}/3</span>
            </div>

            {points.length === 0 ? (
              <p style={{
                fontFamily: 'var(--serif-body)',
                fontStyle: 'italic',
                fontSize: 12,
                color: 'var(--paper-faint)',
                paddingLeft: '0.9rem',
              }}>等待评审…</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {points.map((p, i) => (
                  <li key={i} style={{
                    paddingLeft: '0.9rem',
                    marginBottom: '0.5rem',
                    position: 'relative',
                    fontFamily: 'var(--serif-body)',
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: 'var(--paper)',
                  }}>
                    <span style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 9.5,
                      letterSpacing: '0.12em',
                      color: MODEL_META[p.reviewer as DebateModelName].tone,
                      marginRight: '0.4rem',
                      fontWeight: 600,
                    }}>
                      {MODEL_ABBR[p.reviewer as DebateModelName] ?? p.reviewer}
                    </span>
                    {p.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
