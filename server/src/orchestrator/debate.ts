import { CDPSession } from '../browser/cdp.js'
import type { SiteAdapter, ModelConfig } from '../browser/adapters/base.js'
import { MODELS, makeAdapters, DEFAULT_MODEL_CONFIGS } from '../browser/adapters/index.js'
import type { DebateModelName, ModelConfigs } from '../browser/adapters/index.js'
import {
  PHASE2_PROMPT, PHASE3_PROMPT, PHASE4_PROMPT, PHASE5_PROMPT, PHASE6_PROMPT,
} from './prompts.js'
import {
  anonymizeProposals, aggregateRankings,
} from './anon.js'
import type { AnonLabel } from './anon.js'
import {
  parseRanking, parsePhase5Output, parseVerdict,
} from './parsers.js'
import { debates, messages, summaries } from '../storage/repository.js'
import type { DebatePhase, DebateStatus } from '../storage/repository.js'

export { DEFAULT_MODEL_CONFIGS }
export type { DebatePhase, DebateStatus, ModelConfigs }

export interface WSEvent {
  type: 'phase_started' | 'delta' | 'message_complete' | 'summary' | 'done' | 'error'
  debateId: string
  phase?: DebatePhase
  model?: DebateModelName
  content?: string
  error?: string
}

type EventEmitter = (event: WSEvent) => void

// Drive one (phase, model) cell of the debate.
// `startNew` true → open a fresh conversation and apply model config.
// `startNew` false → continue in whatever conversation this adapter is on
// (intended use: Phase 2 opens, Phases 3-6 continue, so each model has a
// single chat thread per debate). Continuation also gives the model its own
// prior phases in context, so the per-phase prompts can be terser.
async function runModel(
  debateId: string,
  phase: DebatePhase,
  model: DebateModelName,
  adapter: SiteAdapter,
  prompt: string,
  emit: EventEmitter,
  startNew: boolean,
  config?: ModelConfig
): Promise<string> {
  emit({ type: 'phase_started', debateId, phase, model })
  try {
    if (startNew) {
      await adapter.newConversation()
      if (config && adapter.configure) {
        await adapter.configure(config)
      }
    }
    await adapter.sendMessage(prompt)
    const content = await adapter.streamResponse(delta => {
      emit({ type: 'delta', debateId, phase, model, content: delta })
    })
    emit({ type: 'message_complete', debateId, phase, model, content })
    messages.insert(debateId, phase, model, content)
    return content
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[debate] ${model} phase ${phase} failed:`, error)
    emit({ type: 'error', debateId, phase, model, error })
    messages.insert(debateId, phase, model, `[ERROR: ${error}]`)
    return ''
  }
}

export async function runDebate(
  debateId: string,
  topic: string,
  principles: string,
  synthesizer: DebateModelName,
  cdp: CDPSession,
  emit: EventEmitter,
  modelConfigs: ModelConfigs = DEFAULT_MODEL_CONFIGS
): Promise<void> {
  debates.setStatus(debateId, 'running')

  const adapters = makeAdapters()

  for (const model of MODELS) {
    const page = await cdp.ensurePage(model)
    adapters[model].setPage(page)
    await adapters[model].ensureReady()
  }

  // -------------------------------------------------------------------------
  // Phase 2 — 各自方案 (parallel, opens a FRESH conversation per model).
  // All later phases continue in this same conversation for each model.
  // -------------------------------------------------------------------------
  const phase2Results: { name: DebateModelName; content: string }[] = []
  await Promise.all(MODELS.map(async model => {
    const prompt = PHASE2_PROMPT(topic, principles, model)
    const content = await runModel(
      debateId, 2, model, adapters[model], prompt, emit, true, modelConfigs[model])
    phase2Results.push({ name: model, content })
  }))
  // Re-sort to MODELS order (parallel resolves out-of-order)
  phase2Results.sort((a, b) => MODELS.indexOf(a.name) - MODELS.indexOf(b.name))

  // -------------------------------------------------------------------------
  // Phase 3 — 互评 + 排名 (parallel, continues same conversation).
  // The model has its own Phase 2 proposal in context, so the prompt does
  // not pretend full anonymity — it tells the model "one of these is yours,
  // evaluate fairly anyway".
  // -------------------------------------------------------------------------
  const anonymized = anonymizeProposals(phase2Results)
  const labelByName: Record<DebateModelName, AnonLabel> = Object.fromEntries(
    anonymized.map(a => [a.originalName, a.label])
  ) as Record<DebateModelName, AnonLabel>

  const phase3Results: { name: DebateModelName; content: string; ranking: AnonLabel[] | null }[] = []
  await Promise.all(MODELS.map(async model => {
    const prompt = PHASE3_PROMPT(anonymized, labelByName[model])
    const content = await runModel(
      debateId, 3, model, adapters[model], prompt, emit, false)
    const ranking = parseRanking(content)
    phase3Results.push({ name: model, content, ranking })
    if (ranking) {
      console.log(`[debate] ${model} ranking:`, ranking.map(l => `方案${l}`).join(' > '))
    } else {
      console.warn(`[debate] ${model} did not produce a parseable FINAL RANKING`)
    }
  }))
  phase3Results.sort((a, b) => MODELS.indexOf(a.name) - MODELS.indexOf(b.name))

  const aggregated = aggregateRankings(anonymized, phase3Results.map(r => r.ranking))
  console.log('[debate] aggregated ranking:',
    aggregated.map(a => `${a.originalName}(${a.label})=${a.avgRank.toFixed(2)}`).join(', '))

  // -------------------------------------------------------------------------
  // Phase 4 — 作者修订 (parallel, continues same conversation).
  // The author's own original proposal AND its own Phase 3 critique are in
  // context, so the prompt only needs to hand over the OTHER reviewers'
  // critiques + the aggregated ranking.
  // -------------------------------------------------------------------------
  const phase4Results: { name: DebateModelName; content: string }[] = []
  await Promise.all(MODELS.map(async model => {
    const myLabel = labelByName[model]
    const otherCritiques = phase3Results
      .filter(r => r.name !== model)
      .map(r => ({ reviewer: r.name, content: r.content }))
    const prompt = PHASE4_PROMPT(model, myLabel, otherCritiques, aggregated)
    const content = await runModel(
      debateId, 4, model, adapters[model], prompt, emit, false)
    phase4Results.push({ name: model, content })
  }))
  phase4Results.sort((a, b) => MODELS.indexOf(a.name) - MODELS.indexOf(b.name))

  // -------------------------------------------------------------------------
  // Phase 5 — 综合 + 裁决 + 少数派意见 (synthesizer only, continues same chat).
  // Its own Phase 2-4 are in context; the prompt provides only the OTHER 2
  // models' revisions + critiques.
  // -------------------------------------------------------------------------
  const synthAdapter = adapters[synthesizer]
  const otherRevisions = phase4Results.filter(r => r.name !== synthesizer)
  const otherCritiquesForSynth = phase3Results
    .filter(r => r.name !== synthesizer)
    .map(r => ({ reviewer: r.name, content: r.content }))
  const synthPrompt = PHASE5_PROMPT(
    synthesizer, topic, principles,
    otherRevisions,
    otherCritiquesForSynth,
    aggregated,
  )
  const summaryContent = await runModel(
    debateId, 5, synthesizer, synthAdapter, synthPrompt, emit, false)

  // Defensive: if the synthesizer's stream returned empty / whitespace-only
  // content, do NOT run Phase 6 (reviewers would have nothing to ratify) and
  // do NOT mark the debate as done. Mark it error so the UI surfaces the
  // failure instead of pretending success with an empty summary.
  if (!summaryContent.trim()) {
    const msg = `综合者 ${synthesizer} 在 Phase 5 返回空内容；跳过 Phase 6 复核。`
    console.error(`[debate] ${msg}`)
    emit({ type: 'error', debateId, phase: 5, model: synthesizer, error: msg })
    debates.setStatus(debateId, 'error')
    return
  }

  const { comparison, finalProposal, dissent } = parsePhase5Output(summaryContent)
  summaries.upsert(debateId, comparison, finalProposal, dissent)
  emit({ type: 'summary', debateId, content: JSON.stringify({ comparison, finalProposal, dissent }) })

  // -------------------------------------------------------------------------
  // Phase 6 — 终稿复核 (parallel ratify/veto by non-synthesizers, continues
  // each reviewer's own conversation).
  // -------------------------------------------------------------------------
  const reviewers = MODELS.filter(m => m !== synthesizer)
  await Promise.all(reviewers.map(async model => {
    const prompt = PHASE6_PROMPT(model, synthesizer, comparison, finalProposal, dissent)
    const content = await runModel(
      debateId, 6, model, adapters[model], prompt, emit, false)
    const { verdict, reason } = parseVerdict(content)
    console.log(`[debate] ${model} verdict: ${verdict}${reason ? ` — ${reason}` : ''}`)
  }))

  debates.markDone(debateId)
  emit({ type: 'done', debateId })
}
