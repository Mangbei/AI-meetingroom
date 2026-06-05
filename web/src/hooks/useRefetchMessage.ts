import type { DebateModelName } from '../lib/models.ts'
import type { DebatePhase } from '../lib/phases.ts'
import type { ModelStream } from './useDebateSocket.ts'

// Server-side row shapes returned by GET /api/debates/:id.
interface StoredMessage { phase: number; model: DebateModelName; content: string }
interface StoredSummary { comparison: string; final_proposal: string; dissent?: string }

interface ApplyArgs {
  streams: Record<DebateModelName, ModelStream[]>
  summary: { comparison: string; finalProposal: string; dissent?: string } | null
}

/**
 * Returns a function that asks the server to re-read a model's live tab for
 * one (phase, model) cell, then re-pulls the whole debate detail and hands
 * the freshly-deserialized data to `apply` (typically setStaticStreams +
 * setStaticSummary in DebateView).
 *
 * Centralised so DebateView doesn't have to know the response shape and so
 * any future caller (e.g. a bulk-retry button) can share the parsing.
 */
export function useRefetchMessage(
  debateId: string | undefined,
  apply: (args: ApplyArgs) => void,
) {
  return async function refetch(phase: DebatePhase, model: DebateModelName): Promise<void> {
    if (!debateId) return
    try {
      const res = await fetch(`/api/debates/${debateId}/messages/refetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase, model }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        alert(`重新获取失败: ${err.error ?? res.statusText}`)
        return
      }
      const detail = await fetch(`/api/debates/${debateId}`).then(r => r.json()) as {
        messages: StoredMessage[]; summary?: StoredSummary
      }
      const streams: Record<DebateModelName, ModelStream[]> = { claude: [], chatgpt: [], deepseek: [] }
      for (const msg of detail.messages) {
        streams[msg.model].push({
          phase: msg.phase as DebatePhase,
          content: msg.content,
          complete: true,
        })
      }
      apply({
        streams,
        summary: detail.summary ? {
          comparison: detail.summary.comparison,
          finalProposal: detail.summary.final_proposal,
          dissent: detail.summary.dissent ?? '',
        } : null,
      })
    } catch (err) {
      alert(`重新获取出错: ${err}`)
    }
  }
}
