import { useEffect, useState } from 'react'
import type { MeetingModelName } from '../lib/models.ts'

export interface MeetingMessageStream {
  agendaId: number | null
  turnIndex: number
  roundIndex: number
  role: string
  model: MeetingModelName
  content: string
  complete: boolean
}

export interface MeetingLogEntry {
  id?: number
  kind: 'model_status' | 'file_delivery' | string
  model?: MeetingModelName | null
  filename?: string | null
  status: string
  detail?: string
  created_at?: number
}

export interface HumanNote {
  agendaId: number | null
  content: string
  at: number
}

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

export interface MeetingLiveState {
  currentAgendaId: number | null
  streams: MeetingMessageStream[]
  agendaSummaries: Record<number, string>
  humanNotes: HumanNote[]
  structuredMinutes: StructuredMinutes | null
  finalSummary: string
  archiveDir: string
  summaryPath: string
  jsonPath: string
  logs: MeetingLogEntry[]
  done: boolean
  error: string | null
}

interface MeetingEvent {
  type: 'agenda_started' | 'turn_started' | 'delta' | 'message_complete' | 'model_status' | 'file_delivery' | 'agenda_summary' | 'final_summary' | 'structured_minutes' | 'human_note' | 'done' | 'error'
  meetingId: string
  agendaId?: number | null
  turnIndex?: number
  roundIndex?: number
  role?: string
  model?: MeetingModelName
  content?: string
  error?: string
  filename?: string
  status?: string
  detail?: string
  archiveDir?: string
  summaryPath?: string
  jsonPath?: string
  actionItems?: ActionItem[]
  openProblems?: OpenProblem[]
}

const INITIAL: MeetingLiveState = {
  currentAgendaId: null,
  streams: [],
  agendaSummaries: {},
  humanNotes: [],
  structuredMinutes: null,
  finalSummary: '',
  archiveDir: '',
  summaryPath: '',
  jsonPath: '',
  logs: [],
  done: false,
  error: null,
}

export function useMeetingSocket(meetingId: string | undefined, liveMode: boolean) {
  const [state, setState] = useState<MeetingLiveState>(INITIAL)

  useEffect(() => {
    if (!meetingId || !liveMode) return
    const ws = new WebSocket(`ws://localhost:3001/ws/meetings/${meetingId}`)
    ws.onmessage = ev => setState(prev => applyEvent(prev, JSON.parse(ev.data)))
    ws.onerror = () => setState(prev => ({ ...prev, error: 'WebSocket connection error' }))
    return () => ws.close()
  }, [meetingId, liveMode])

  return state
}

function applyEvent(prev: MeetingLiveState, ev: MeetingEvent): MeetingLiveState {
  if (ev.type === 'agenda_started') {
    return { ...prev, currentAgendaId: ev.agendaId ?? null }
  }
  if (ev.type === 'turn_started') {
    if (ev.turnIndex == null || !ev.model || !ev.role) return prev
    const exists = prev.streams.some(s => s.turnIndex === ev.turnIndex)
    if (exists) return prev
    return {
      ...prev,
      streams: [...prev.streams, {
        agendaId: ev.agendaId ?? null,
        turnIndex: ev.turnIndex,
        roundIndex: ev.roundIndex ?? 0,
        role: ev.role,
        model: ev.model,
        content: '',
        complete: false,
      }],
    }
  }
  if (ev.type === 'delta' || ev.type === 'message_complete') {
    if (ev.turnIndex == null || !ev.model || !ev.role) return prev
    const streams = [...prev.streams]
    const idx = streams.findIndex(s => s.turnIndex === ev.turnIndex)
    const nextContent = ev.type === 'message_complete'
      ? (ev.content ?? streams[idx]?.content ?? '')
      : `${streams[idx]?.content ?? ''}${ev.content ?? ''}`
    const next = {
      agendaId: ev.agendaId ?? null,
      turnIndex: ev.turnIndex,
      roundIndex: ev.roundIndex ?? streams[idx]?.roundIndex ?? 0,
      role: ev.role,
      model: ev.model,
      content: nextContent,
      complete: ev.type === 'message_complete',
    }
    if (idx >= 0) streams[idx] = next
    else streams.push(next)
    return { ...prev, streams }
  }
  if (ev.type === 'agenda_summary' && ev.agendaId != null) {
    return { ...prev, agendaSummaries: { ...prev.agendaSummaries, [ev.agendaId]: ev.content ?? '' } }
  }
  if (ev.type === 'structured_minutes') {
    return {
      ...prev,
      structuredMinutes: {
        actionItems: ev.actionItems ?? [],
        openProblems: ev.openProblems ?? [],
      },
    }
  }
  if (ev.type === 'human_note') {
    return {
      ...prev,
      humanNotes: [...prev.humanNotes, { agendaId: ev.agendaId ?? null, content: ev.content ?? '', at: Date.now() }],
    }
  }
  if (ev.type === 'model_status' || ev.type === 'file_delivery') {
    return {
      ...prev,
      logs: [...prev.logs, {
        kind: ev.type,
        model: ev.model ?? null,
        filename: ev.filename ?? null,
        status: ev.status ?? '',
        detail: ev.detail ?? '',
        created_at: Date.now(),
      }],
    }
  }
  if (ev.type === 'final_summary') {
    return {
      ...prev,
      finalSummary: ev.content ?? '',
      archiveDir: ev.archiveDir ?? prev.archiveDir,
      summaryPath: ev.summaryPath ?? prev.summaryPath,
      jsonPath: ev.jsonPath ?? prev.jsonPath,
    }
  }
  if (ev.type === 'done') return { ...prev, done: true }
  if (ev.type === 'error') return { ...prev, error: ev.error ?? 'Unknown error' }
  return prev
}
