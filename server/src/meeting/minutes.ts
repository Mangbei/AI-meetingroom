/**
 * Structured meeting minutes extracted from the discussion: concrete action
 * items and the problems the meeting could not resolve (carry-forward
 * candidates for a follow-up meeting). Web AIs emit free-form text, so the
 * extraction turn is asked for strict JSON and parsed defensively here — any
 * malformed output degrades to empty rather than breaking the meeting.
 */

export interface ActionItem {
  task: string
  owner: string
  due: string
  source: string
}

export interface OpenProblem {
  problem: string
  why: string
}

export interface StructuredMinutes {
  actionItems: ActionItem[]
  openProblems: OpenProblem[]
}

export const EMPTY_MINUTES: StructuredMinutes = { actionItems: [], openProblems: [] }

function str(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  if (typeof value === 'string') return value.trim()
  return String(value).trim()
}

/** Pull the first balanced JSON object out of arbitrary model text. */
function extractJsonObject(raw: string): string | null {
  const withoutFences = raw.replace(/```(?:json)?/gi, '')
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return withoutFences.slice(start, end + 1)
}

export function parseStructuredMinutes(raw: string): StructuredMinutes {
  const json = extractJsonObject(raw ?? '')
  if (!json) return { ...EMPTY_MINUTES }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ...EMPTY_MINUTES }
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>

  const rawActions = Array.isArray(obj.actionItems) ? obj.actionItems : []
  const actionItems: ActionItem[] = rawActions
    .map(item => {
      const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return {
        task: str(o.task),
        owner: str(o.owner) || '待定',
        due: str(o.due),
        source: str(o.source),
      }
    })
    .filter(a => a.task.length > 0)

  const rawProblems = Array.isArray(obj.openProblems) ? obj.openProblems : []
  const openProblems: OpenProblem[] = rawProblems
    .map(item => {
      const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return { problem: str(o.problem), why: str(o.why) }
    })
    .filter(p => p.problem.length > 0)

  return { actionItems, openProblems }
}

export function safeParseMinutes(structuredJson: string | null | undefined): StructuredMinutes {
  if (!structuredJson) return { ...EMPTY_MINUTES }
  try {
    const obj = JSON.parse(structuredJson) as Partial<StructuredMinutes>
    return {
      actionItems: Array.isArray(obj.actionItems) ? obj.actionItems : [],
      openProblems: Array.isArray(obj.openProblems) ? obj.openProblems : [],
    }
  } catch {
    return { ...EMPTY_MINUTES }
  }
}
