// Parsers for model output formats produced by the orchestrator's prompts.
//
// Source of truth for the EMITTED formats is server/src/orchestrator/prompts.ts.
// These functions deliberately mirror the server-side parseRanking /
// parseVerdict / parseCritiquesByTarget so the web can re-derive structured
// signals from raw stream content (the server doesn't push the parsed forms
// over the wire — it stores the raw markdown and the web slices it as needed).
//
// If you change a prompt's output schema in server/prompts.ts, update both:
//  - server/src/orchestrator/parsers.ts (or the parser that lives next to
//    the prompt definition)
//  - this file

import type { DebateModelName } from './models.ts'

// -------- Anonymous labels ------------------------------------------------

export const ANON_LABELS = ['甲', '乙', '丙'] as const
export type AnonLabel = typeof ANON_LABELS[number]

// -------- Critique sub-section taxonomy (Phase 3) -------------------------

export const CRITIQUE_SECTIONS = [
  '决定性缺陷', '可救的洞见', '具体改动',
] as const
export type CritiqueSection = typeof CRITIQUE_SECTIONS[number]

export interface CritiquePoint {
  reviewer: string
  text: string
}

export type CritiquesByTarget = Record<
  AnonLabel,
  Record<CritiqueSection, CritiquePoint[]>
>

export function emptyCritiquesByTarget(): CritiquesByTarget {
  return Object.fromEntries(
    ANON_LABELS.map(l => [
      l,
      Object.fromEntries(CRITIQUE_SECTIONS.map(s => [s, [] as CritiquePoint[]])),
    ])
  ) as CritiquesByTarget
}

// Transpose Phase 3 outputs from "by reviewer" → "by target proposal".
// The prompt enforces:
//   ### 对方案X      (or ####)
//   - **决定性缺陷**：...
//   - **可救的洞见**：...
//   - **具体改动**：...
// All three reviewers follow the same template, which makes the transpose
// reliable. Tolerates H2–H4 headers and full-width / half-width colons.
export function parseCritiquesByTarget(
  phase3: { reviewer: string; content: string }[]
): CritiquesByTarget {
  const result = emptyCritiquesByTarget()

  for (const { reviewer, content } of phase3) {
    const text = content.replace(/\\\./g, '.')
    const re = /#{2,4}\s*对方案\s*([甲乙丙])\s*\n([\s\S]*?)(?=#{2,4}\s*对方案\s*[甲乙丙]|FINAL RANKING|$)/g
    let m
    while ((m = re.exec(text)) !== null) {
      const label = m[1] as AnonLabel
      const block = m[2]
      for (const section of CRITIQUE_SECTIONS) {
        const secRe = new RegExp(
          `\\*\\*${section}\\*\\*\\s*[：:]\\s*([\\s\\S]+?)(?=\\n\\s*-\\s*\\*\\*|\\n\\s*#{2,}|\\n\\s*---|$)`,
          'm'
        )
        const sm = block.match(secRe)
        if (sm) {
          result[label][section].push({
            reviewer,
            text: sm[1].trim().replace(/\s*\n\s*/g, ' '),
          })
        }
      }
    }
  }

  return result
}

// -------- FINAL RANKING: parser (Phase 3) ---------------------------------

// Returns ordered labels (best→worst) or null if the block isn't present.
// Turndown escapes "1." → "1\." inside paragraphs — undo that first.
export function parseRanking(text: string): AnonLabel[] | null {
  const idx = text.indexOf('FINAL RANKING')
  if (idx < 0) return null
  const tail = text.slice(idx).replace(/\\\./g, '.')
  const matches = Array.from(tail.matchAll(/\d+\.\s*方案\s*([甲乙丙])/g))
  if (matches.length === 0) return null
  const labels = matches.map(m => m[1] as AnonLabel)
  const seen = new Set<AnonLabel>()
  return labels.filter(l => (seen.has(l) ? false : (seen.add(l), true)))
}

// Aggregate per-reviewer rankings into average rank per anonymous label.
// Lower avgRank = better; never produced=null entries are skipped.
export function aggregateRankings(
  phase3: { reviewer: DebateModelName; content: string }[]
): Record<AnonLabel, number | null> {
  const sums: Record<AnonLabel, { sum: number; count: number }> = {
    甲: { sum: 0, count: 0 }, 乙: { sum: 0, count: 0 }, 丙: { sum: 0, count: 0 },
  }
  for (const { content } of phase3) {
    const r = parseRanking(content)
    if (!r) continue
    r.forEach((l, i) => { sums[l].sum += i + 1; sums[l].count += 1 })
  }
  return {
    甲: sums.甲.count ? sums.甲.sum / sums.甲.count : null,
    乙: sums.乙.count ? sums.乙.sum / sums.乙.count : null,
    丙: sums.丙.count ? sums.丙.sum / sums.丙.count : null,
  }
}

// -------- Verdict parser (Phase 6) ----------------------------------------

export type Verdict = 'RATIFY' | 'VETO' | 'UNKNOWN'

export interface VerdictResult {
  verdict: Verdict
  reason: string
}

export function parseVerdict(text: string): VerdictResult {
  const cleaned = text.replace(/\\\./g, '.')
  const m = cleaned.match(/VERDICT:\s*(RATIFY|VETO)\s*(?:[—\-:]\s*(.+))?/i)
  if (!m) return { verdict: 'UNKNOWN', reason: '' }
  return {
    verdict: m[1].toUpperCase() as Verdict,
    reason: (m[2] ?? '').trim(),
  }
}
