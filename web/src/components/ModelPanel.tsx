import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DebateModelName } from '../lib/models.ts'
import type { ModelStream } from '../hooks/useDebateSocket.ts'
import { MODEL_META } from '../lib/models.ts'
import RefetchButton from './RefetchButton.tsx'

// Fixed height for the content area in all states EXCEPT user-expanded.
// During writing the container becomes its own scroll viewport so 3 columns
// growing at different rates no longer reflow the page (was causing the
// "screen-keeps-shaking" jitter). When complete and collapsed, overflow is
// hidden + a fade gradient hints there's more content.
const CONTENT_MAX_PX = 560

interface Props {
  model: DebateModelName
  stream: ModelStream | null
  isActivePhase: boolean
  /** When true, render this column as "本环节不参与" (e.g., synthesizer in Phase 6 review). */
  abstain?: boolean
  /** Optional label rendered in the column header (e.g., a verdict badge). */
  badge?: { text: string; tone: 'paper' | 'vermilion' | 'mute' }
  /** When provided, render a small "重新获取 ↻" link in the header. */
  onRefetch?: () => void
}

// One model's output inside one phase. Caps height when complete + content
// exceeds COLLAPSED_MAX_PX, with a fade-out and "展开 ▾" toggle — so three
// columns of unequal length no longer leave the short ones swimming in
// whitespace. Auto-scrolls the tail during live writing.
export default function ModelPanel({
  model, stream, isActivePhase, abstain, badge, onRefetch,
}: Props) {
  const meta = MODEL_META[model]
  const contentRef = useRef<HTMLDivElement>(null)
  const [userExpanded, setUserExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  const isWriting = !!stream && !stream.complete && isActivePhase && !abstain

  // Re-measure on every content change. scrollHeight is the natural height
  // ignoring max-height — when it exceeds the cap, we have overflowing content.
  useLayoutEffect(() => {
    if (!contentRef.current || abstain) {
      setOverflows(false)
      return
    }
    setOverflows(contentRef.current.scrollHeight > CONTENT_MAX_PX + 32)
  }, [stream?.content, abstain])

  // Keep the streaming tail visible by scrolling INSIDE the content container
  // (not the page). scrollTop assignment instead of scrollIntoView({smooth})
  // avoids fighting between 3 simultaneously streaming columns.
  useEffect(() => {
    if (isWriting && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [stream?.content, isWriting])

  // Toggle only appears once the phase finishes — during writing the
  // container scrolls internally, so the user has access to all the text
  // already; toggling would just reflow the page and bring back jitter.
  const showToggle = overflows && !isActivePhase && !abstain

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      borderLeft: `1px solid ${isWriting ? meta.tone : 'var(--rule)'}`,
      paddingLeft: '1.1rem',
      paddingRight: '0.6rem',
      transition: 'border-color 0.4s',
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
          fontSize: 18,
          color: meta.tone,
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}>
          {meta.display}
        </h4>
        <span style={{
          fontFamily: 'var(--mono)',
          fontSize: 9.5,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--paper-faint)',
        }}>
          {meta.latin}
        </span>
        {isWriting && (
          <span style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: meta.tone,
          }}>
            <span className="writing-pulse" style={{ background: meta.tone }} />
            落笔中
          </span>
        )}
        {badge && !isWriting && (
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: badge.tone === 'vermilion' ? 'var(--vermilion)'
                  : badge.tone === 'mute'      ? 'var(--paper-mute)'
                                               : 'var(--paper)',
          }}>
            {badge.text}
          </span>
        )}
        {onRefetch && !isActivePhase && !abstain && (
          <RefetchButton onClick={onRefetch} hasNeighborOnRight={!!badge} />
        )}
      </header>

      <div style={{ position: 'relative', minWidth: 0 }}>
        <div
          ref={contentRef}
          className="prose"
          style={{
            minWidth: 0,
            // During an active phase we LOCK the height across all 3 columns
            // (height: fixed) so the page does not reflow as columns grow at
            // different rates. Once the phase ends we drop to maxHeight only,
            // letting shorter columns shrink to their natural height.
            height: isActivePhase && !userExpanded ? CONTENT_MAX_PX : undefined,
            maxHeight: !userExpanded ? CONTENT_MAX_PX : 'none',
            overflow: isActivePhase ? 'auto'
                     : !userExpanded && overflows ? 'hidden'
                                                  : 'visible',
          }}
        >
          {abstain ? (
            <p style={{
              fontFamily: 'var(--serif-body)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--paper-faint)',
            }}>
              综合者本环节不参与复核。
            </p>
          ) : !stream || stream.content.length === 0 ? (
            <p style={{
              fontFamily: 'var(--serif-body)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--paper-faint)',
            }}>
              {isActivePhase ? '执笔待书…' : '尚未发言。'}
            </p>
          ) : (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {stream.content}
              </ReactMarkdown>
              {isWriting && <span className="caret" style={{ background: meta.tone }} />}
            </>
          )}
        </div>

        {/* Fade-out gradient when the phase is done + collapsed + overflowing.
            Hidden while the phase is active because the container scrolls
            internally there. */}
        {!isActivePhase && !userExpanded && overflows && (
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 110,
            pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(20,18,16,0) 0%, var(--ink) 90%)',
          }} />
        )}
      </div>

      {showToggle && (
        <button
          onClick={() => setUserExpanded(v => !v)}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: '0.5rem 0',
            marginTop: '0.5rem',
            color: 'var(--paper-mute)',
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--paper)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--paper-mute)')}
        >
          {userExpanded ? '收起 ▴' : '展开全文 ▾'}
        </button>
      )}
    </div>
  )
}
