import type { DebateModelName } from '../../lib/models.ts'
import type { ModelStream } from '../../hooks/useDebateSocket.ts'
import { MODELS } from '../../lib/models.ts'
import ModelPanel from '../ModelPanel.tsx'

// Generic 3-column grid used by Phase II and Phase IV.
// Each ModelPanel inside self-caps height and provides per-column expand.
export default function ThreeColumns({ panels, isActivePhase, onRefetch }: {
  panels: Partial<Record<DebateModelName, ModelStream | null>>
  isActivePhase: boolean
  onRefetch?: (model: DebateModelName) => void
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 0,
    }}>
      {MODELS.map(m => (
        <ModelPanel
          key={m}
          model={m}
          stream={panels[m] ?? null}
          isActivePhase={isActivePhase}
          onRefetch={onRefetch ? () => onRefetch(m) : undefined}
        />
      ))}
    </div>
  )
}
