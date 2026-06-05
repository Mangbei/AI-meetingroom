import type { DebateModelName } from '../../lib/models.ts'
import type { ModelStream } from '../../hooks/useDebateSocket.ts'
import PhaseHeader from './PhaseHeader.tsx'
import ThreeColumns from './ThreeColumns.tsx'

export default function PhaseFourView(props: {
  panels: Partial<Record<DebateModelName, ModelStream | null>>
  isActivePhase: boolean
  isAborted: boolean
  onRefetch?: (model: DebateModelName) => void
}) {
  return (
    <section className="fade-up">
      <PhaseHeader phase={4} isActive={props.isActivePhase} isAborted={props.isAborted} />
      <ThreeColumns
        panels={props.panels}
        isActivePhase={props.isActivePhase}
        onRefetch={props.onRefetch}
      />
    </section>
  )
}
